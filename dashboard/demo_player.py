"""
CSV Replay Engine for recorded factory runs.

Replays a CSV event log in real-time (or sped up), maintaining current state
of all variables. The server polls current_state() on each dashboard refresh.
"""

import csv
import threading
import time
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
    """Convert CSV string value to Python type."""
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
    # Remove station prefix (e.g., bMotor_MS_Saw → Saw)
    parts = variable_name.split("_")
    # Find station code position and skip it + prefix
    # e.g. bReferenceSwitch_MS_Turntable_atsaw → Turntable Atsaw
    # e.g. bMotor_C_upward → Upward
    # e.g. iColorSensor_SL → Color Sensor
    station_codes = {"MS", "C", "SL", "HBW", "PM"}

    # Strip the type prefix (b, i, e, f)
    name = variable_name
    if name[0] in "bife" and name[1].isupper():
        name = name[1:]

    # Split and find station code
    parts = name.split("_")
    filtered = []
    skip_next_station = False
    for i, part in enumerate(parts):
        if part in station_codes and i <= 2:
            skip_next_station = True
            continue
        filtered.append(part)

    if not filtered:
        return variable_name

    # Capitalize parts
    label = " ".join(p.capitalize() for p in filtered)
    # Clean up common abbreviations
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


class DemoPlayer:
    """Replays a CSV event log, maintaining current variable state."""

    def __init__(self, csv_path, speed=1.0, loop=True):
        self.csv_path = Path(csv_path)
        self.speed = speed
        self.loop = loop
        self._state = {}        # {station: {group: {label: value}}}
        self._config = {}       # {station: {group: {label: var_type}}}
        self._var_map = {}      # {(gvl, variable): (station, group, label)}
        self._events = []
        self._event_index = 0
        self._running = False
        self._thread = None
        self._lock = threading.Lock()
        self._progress = 0.0    # 0.0 to 1.0

        self._load_csv()

    def _load_csv(self):
        """Parse the CSV and build variable config + event list."""
        events = []
        has_source_col = False

        with open(self.csv_path, newline="") as f:
            reader = csv.DictReader(f)
            has_source_col = "source" in (reader.fieldnames or [])
            for row in reader:
                ts_str = row["timestamp"]
                gvl = row["gvl"]
                variable = row["variable"]
                value = parse_value(row["value"])

                station = GVL_TO_STATION.get(gvl, gvl)
                group = classify_variable(variable) if station != "State" else "state"
                label = make_label(variable) if station != "State" else variable

                # Register in config
                if station not in self._config:
                    self._config[station] = {}
                if group not in self._config[station]:
                    self._config[station][group] = {}

                var_type = "bool" if isinstance(value, bool) else "int" if isinstance(value, int) else "str"
                self._config[station][group][label] = var_type

                # Register mapping
                self._var_map[(gvl, variable)] = (station, group, label)

                # Initialize state
                if station not in self._state:
                    self._state[station] = {}
                if group not in self._state[station]:
                    self._state[station][group] = {}
                if label not in self._state[station][group]:
                    self._state[station][group][label] = value

                # Parse timestamp
                try:
                    ts = self._parse_ts(ts_str)
                except ValueError:
                    continue

                events.append((ts, station, group, label, value))

        self._events = events

    @staticmethod
    def _parse_ts(ts_str):
        """Parse timestamp string to epoch float."""
        # Format: 2026-03-19 17:35:35.998
        from datetime import datetime
        dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S.%f")
        return dt.timestamp()

    def current_state(self):
        """Return current variable state (thread-safe)."""
        with self._lock:
            import copy
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
        """Main replay loop — replays events at original timing (scaled by speed)."""
        while self._running:
            if not self._events:
                break

            self._event_index = 0
            start_ts = self._events[0][0]
            replay_start = time.time()

            while self._event_index < len(self._events) and self._running:
                ts, station, group, label, value = self._events[self._event_index]

                # Calculate when this event should fire
                event_offset = (ts - start_ts) / self.speed
                now = time.time() - replay_start

                if now < event_offset:
                    time.sleep(min(event_offset - now, 0.05))
                    continue

                # Apply event
                with self._lock:
                    self._state[station][group][label] = value

                self._event_index += 1
                self._progress = self._event_index / len(self._events)

            if not self.loop:
                break

            # Reset for loop
            self._progress = 0.0
            with self._lock:
                # Reset all booleans to False for clean restart
                for station in self._state:
                    for group in self._state[station]:
                        for label in self._state[station][group]:
                            val = self._state[station][group][label]
                            if isinstance(val, bool):
                                self._state[station][group][label] = False
                            elif isinstance(val, int):
                                self._state[station][group][label] = 0

        self._running = False
