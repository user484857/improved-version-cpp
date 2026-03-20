"""
Live OPC UA Player — polls PLC variables into RAM via background thread.

Same interface as DemoDBPlayer (current_state, get_config, start, stop)
so the server can swap between demo and live seamlessly.

The background thread reads all variables every poll_interval seconds
and stores them in a thread-safe dict. /api/data just returns the
current RAM snapshot — no blocking OPC UA call per HTTP request.
"""

import copy
import threading
import time

from opcua_client import PLCConnection
from config import VARIABLES


class LivePLCPlayer:
    """Continuously polls OPC UA variables into RAM."""

    def __init__(self, endpoint=None, poll_interval=0.5):
        self.poll_interval = poll_interval
        self._plc = PLCConnection(endpoint)
        self._state = {}        # {station: {group: {label: value}}}
        self._config = {}       # {station: {group: {label: var_type}}}
        self._running = False
        self._connected = False
        self._thread = None
        self._lock = threading.Lock()
        self._error = None
        self._poll_count = 0

        self._build_config()

    def _build_config(self):
        """Build config and initial state from VARIABLES mapping."""
        for station, groups in VARIABLES.items():
            self._config[station] = {}
            self._state[station] = {}
            for group_name, vars_dict in groups.items():
                self._config[station][group_name] = {}
                self._state[station][group_name] = {}
                for node_id, (label, var_type) in vars_dict.items():
                    self._config[station][group_name][label] = var_type
                    # Initial values
                    if var_type == "bool":
                        self._state[station][group_name][label] = False
                    elif var_type == "int":
                        self._state[station][group_name][label] = 0
                    else:
                        self._state[station][group_name][label] = None

    def current_state(self):
        """Return current variable state (thread-safe)."""
        with self._lock:
            return copy.deepcopy(self._state)

    def get_config(self):
        """Return variable configuration for the frontend."""
        return self._config

    def get_progress(self):
        """Return -1 for live mode (no replay progress)."""
        return -1

    @property
    def is_connected(self):
        return self._connected

    @property
    def last_error(self):
        return self._error

    def start(self):
        """Connect to PLC and start background polling."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    def stop(self):
        """Stop polling and disconnect."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)
        if self._connected:
            try:
                self._plc.disconnect()
            except Exception:
                pass
            self._connected = False

    def _poll_loop(self):
        """Background loop: connect, then poll all variables into RAM."""
        # Connect
        try:
            self._plc.connect()
            self._connected = True
            self._error = None
            print(f"  Live: connected to PLC, polling every {self.poll_interval}s")
        except Exception as e:
            self._error = str(e)
            self._connected = False
            print(f"  Live: connection failed — {e}")
            self._running = False
            return

        # Poll loop
        while self._running:
            try:
                raw = self._plc.read_all()
                with self._lock:
                    self._state = raw
                self._poll_count += 1
                self._error = None
            except Exception as e:
                self._error = str(e)
                print(f"  Live: poll error — {e}")
                # Try to reconnect
                try:
                    self._plc.disconnect()
                    time.sleep(1)
                    self._plc.connect()
                    self._connected = True
                except Exception:
                    self._connected = False
                    break

            time.sleep(self.poll_interval)

        self._running = False
        try:
            self._plc.disconnect()
        except Exception:
            pass
        self._connected = False
