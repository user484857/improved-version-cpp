"""
SQLite Replay Engine for factory demo mode.

Replays events from the SQLite database in real-time (scaled by speed multiplier),
making it look like a live production run. Loops continuously.

Idle gaps > MAX_GAP_SEC are compressed so the replay feels like continuous production
instead of waiting through long pauses between runs.

Interface: current_state(), get_config(), get_progress(), start(), stop().
"""

import copy
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path

# GVL → station mapping
GVL_TO_STATION = {
    "gvl_MS": "MS",
    "gvl_C": "Crane",
    "gvl_SL": "SL",
    "gvl_HBW": "HBW",
    "gvl_PM": "PM",
    "LocalVariables": "State",
}

# Classify variables as sensor or actuator by prefix
SENSOR_PREFIXES = ("bReferenceSwitch_", "bLightBarrier_", "bEncoderImpulse_",
                   "bPulseCounter_", "iColorSensor_", "bTrailSensor_")
ACTUATOR_PREFIXES = ("bMotor_", "bValve_", "bLamp_", "bCompressor_")


def classify_variable(name):
    """Return 'sensors', 'actuators', or 'state' based on variable name."""
    for prefix in SENSOR_PREFIXES:
        if name.startswith(prefix):
            return "sensors"
    for prefix in ACTUATOR_PREFIXES:
        if name.startswith(prefix):
            return "actuators"
    return "state"


def parse_value(raw):
    """Convert string value to Python type."""
    if raw == "True":
        return True
    if raw == "False":
        return False
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        pass
    return raw


def make_label(variable_name):
    """Create a human-readable label from the raw PLC variable name."""
    station_codes = {"MS", "C", "SL", "HBW", "PM"}

    name = variable_name
    if name[0] in "bife" and name[1].isupper():
        name = name[1:]

    parts = name.split("_")
    filtered = []
    for i, part in enumerate(parts):
        if part in station_codes and i <= 2:
            continue
        filtered.append(part)

    if not filtered:
        return variable_name

    label = " ".join(p.capitalize() for p in filtered)
    label = label.replace("Conveyorbelt", "Conveyor Belt")
    label = label.replace("Stackercrane", "Stacker Crane")
    label = label.replace("Transferunit", "Transfer Unit")
    label = label.replace("Ovenslider", "Oven Slider")
    label = label.replace("Colorsensor", "Color Sensor")
    label = label.replace("Lightbarrier", "Light Barrier")
    label = label.replace("Referenceswitch", "Ref Switch")
    label = label.replace("Encoderimpulse", "Encoder")
    label = label.replace("Pulsecounter", "Pulse Counter")
    label = label.replace("Trailsensor", "Trail Sensor")
    label = label.replace("Atturntable", "@ Turntable")
    label = label.replace("Atoven", "@ Oven")
    label = label.replace("Atsaw", "@ Saw")
    label = label.replace("Attransferunit", "@ Transfer Unit")
    label = label.replace("Atconveyorbelt", "@ Conveyor Belt")
    label = label.replace("Tooven", "→ Oven")
    label = label.replace("Toturntable", "→ Turntable")
    label = label.replace("Torack", "→ Rack")
    label = label.replace("Toconveyorbelt", "→ Conv Belt")
    label = label.replace("Movein", "Move In")
    label = label.replace("Moveout", "Move Out")
    label = label.replace("Beforecolor", "Before Color")
    label = label.replace("Aftercolor", "After Color")
    return label

# Gaps between events longer than this (in original seconds) get compressed
# down to MAX_GAP_SEC. This eliminates dead time between runs.
MAX_GAP_SEC = 2.0


class DemoDBPlayer:
    """Replays SQLite events as fake real-time data."""

    def __init__(self, db_path, speed=2.0, loop=True):
        self.db_path = Path(db_path)
        self.speed = speed
        self.loop = loop
        self._state = {}        # {station: {group: {label: value}}}
        self._config = {}       # {station: {group: {label: var_type}}}
        self._events = []       # [(replay_offset, station, group, label, value), ...]
        self._event_index = 0
        self._running = False
        self._thread = None
        self._lock = threading.Lock()
        self._progress = 0.0
        self._total_duration = 0.0  # compressed duration in seconds

        self._load_db()

    def _load_db(self):
        """Load all events from SQLite, sorted chronologically.

        Compresses idle gaps so replay feels continuous.
        """
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT timestamp, gvl, variable, value FROM events ORDER BY timestamp ASC"
        ).fetchall()
        conn.close()

        # First pass: parse all events with original timestamps
        raw_events = []
        for row in rows:
            ts_str = row["timestamp"]
            gvl = row["gvl"]
            variable = row["variable"]
            value = parse_value(row["value"])

            station = GVL_TO_STATION.get(gvl, gvl)
            group = classify_variable(variable) if station != "State" else "state"
            label = make_label(variable) if station != "State" else variable

            # Register config
            if station not in self._config:
                self._config[station] = {}
            if group not in self._config[station]:
                self._config[station][group] = {}
            var_type = "bool" if isinstance(value, bool) else "int" if isinstance(value, int) else "str"
            self._config[station][group][label] = var_type

            # Initialize state
            if station not in self._state:
                self._state[station] = {}
            if group not in self._state[station]:
                self._state[station][group] = {}
            if label not in self._state[station][group]:
                self._state[station][group][label] = value

            try:
                dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S.%f")
                epoch = dt.timestamp()
            except ValueError:
                continue

            raw_events.append((epoch, station, group, label, value))

        if not raw_events:
            return

        # Second pass: build compressed timeline (skip idle gaps)
        compressed_offset = 0.0
        prev_epoch = raw_events[0][0]

        for epoch, station, group, label, value in raw_events:
            gap = epoch - prev_epoch
            # Compress gaps longer than threshold
            if gap > MAX_GAP_SEC:
                compressed_offset += MAX_GAP_SEC
            else:
                compressed_offset += gap
            prev_epoch = epoch

            self._events.append((compressed_offset, station, group, label, value))

        self._total_duration = compressed_offset
        original_duration = raw_events[-1][0] - raw_events[0][0]
        skipped = original_duration - self._total_duration
        if skipped > 0:
            print(f"  Demo: {len(self._events)} events, "
                  f"{self._total_duration:.0f}s compressed "
                  f"(skipped {skipped:.0f}s idle time)")

    def current_state(self):
        """Return current variable state (thread-safe)."""
        with self._lock:
            return copy.deepcopy(self._state)

    def get_config(self):
        """Return variable configuration for the frontend."""
        return self._config

    def get_progress(self):
        """Return replay progress 0.0-1.0."""
        return self._progress

    def start(self):
        """Start replay in background thread."""
        if self._running:
            return
        self._running = True
        self._event_index = 0
        self._thread = threading.Thread(target=self._replay_loop, daemon=True)
        self._thread.start()

    def stop(self):
        """Stop replay."""
        self._running = False

    def _replay_loop(self):
        """Main replay loop — events fire at compressed timing scaled by speed."""
        while self._running:
            if not self._events:
                break

            self._event_index = 0
            replay_start = time.time()

            while self._event_index < len(self._events) and self._running:
                offset, station, group, label, value = self._events[self._event_index]

                # When should this event fire (wall-clock)?
                target_time = offset / self.speed
                elapsed = time.time() - replay_start

                if elapsed < target_time:
                    time.sleep(min(target_time - elapsed, 0.05))
                    continue

                # Apply event
                with self._lock:
                    self._state[station][group][label] = value

                self._event_index += 1
                self._progress = self._event_index / len(self._events)

            if not self.loop:
                break

            # Reset state for next loop
            self._progress = 0.0
            with self._lock:
                for station in self._state:
                    for group in self._state[station]:
                        for label in self._state[station][group]:
                            val = self._state[station][group][label]
                            if isinstance(val, bool):
                                self._state[station][group][label] = False
                            elif isinstance(val, int):
                                self._state[station][group][label] = 0

        self._running = False
