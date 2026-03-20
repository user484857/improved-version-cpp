#!/usr/bin/env python3
"""
Standalone OPC UA Simulator for the Fischertechnik learning factory.

Reads recorded events from factory.db and replays them through an OPC UA server
with the same namespace and variable structure as the real TwinCAT PLC.
This allows the dashboard to connect via opcua_client.py without any code changes.

Usage:
    python opcua_simulator.py                    # Default: localhost:4840, 1x speed
    python opcua_simulator.py --speed 2.0        # 2x replay speed
    python opcua_simulator.py --port 4841        # Custom port
    python opcua_simulator.py --db path/to/db    # Custom database path
"""

import argparse
import signal
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

from opcua import Server, ua

from config import VARIABLES

# Gap compression: gaps > MAX_GAP_SEC are shrunk to MAX_GAP_SEC
MAX_GAP_SEC = 2.0

SCRIPT_DIR = Path(__file__).parent
DEFAULT_DB = SCRIPT_DIR / "data" / "factory.db"


def parse_value(raw):
    """Convert stored string value to Python type."""
    if raw in ("True", "true"):
        return True
    if raw in ("False", "false"):
        return False
    try:
        return int(raw)
    except (ValueError, TypeError):
        pass
    try:
        return float(raw)
    except (ValueError, TypeError):
        pass
    return raw


def load_events(db_path):
    """Load all events from SQLite, sorted chronologically.

    Returns list of (compressed_offset_sec, node_string, value) tuples
    where node_string is e.g. "gvl_MS.bMotor_MS_Saw".
    """
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT timestamp, gvl, variable, value FROM events ORDER BY timestamp ASC"
    ).fetchall()
    conn.close()

    if not rows:
        print("No events found in database.")
        return []

    # First pass: parse timestamps
    raw_events = []
    for row in rows:
        ts_str = row["timestamp"]
        gvl = row["gvl"]
        variable = row["variable"]
        value = parse_value(row["value"])
        node_string = f"{gvl}.{variable}"

        try:
            dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S.%f")
            epoch = dt.timestamp()
        except ValueError:
            try:
                dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
                epoch = dt.timestamp()
            except ValueError:
                continue

        raw_events.append((epoch, node_string, value))

    if not raw_events:
        return []

    # Second pass: build compressed timeline
    compressed = []
    compressed_offset = 0.0
    prev_epoch = raw_events[0][0]

    for epoch, node_string, value in raw_events:
        gap = epoch - prev_epoch
        if gap > MAX_GAP_SEC:
            compressed_offset += MAX_GAP_SEC
        else:
            compressed_offset += gap
        prev_epoch = epoch
        compressed.append((compressed_offset, node_string, value))

    original_duration = raw_events[-1][0] - raw_events[0][0]
    skipped = original_duration - compressed_offset
    print(f"Loaded {len(compressed)} events, "
          f"{compressed_offset:.0f}s compressed duration "
          f"(skipped {skipped:.0f}s idle time)")

    return compressed


def build_node_id_to_string():
    """Build mapping from config.py node IDs to the string part.

    e.g. "ns=4;s=gvl_MS.bMotor_MS_Saw" -> "gvl_MS.bMotor_MS_Saw"
    """
    mapping = {}
    for station, groups in VARIABLES.items():
        for group_name, vars_dict in groups.items():
            for node_id, (label, var_type) in vars_dict.items():
                # Extract the string identifier after "s="
                s_part = node_id.split(";s=", 1)[1]
                mapping[s_part] = (node_id, var_type)
    return mapping


def setup_server(port):
    """Create and configure OPC UA server with all factory variables."""
    server = Server()
    server.set_endpoint(f"opc.tcp://0.0.0.0:{port}")
    server.set_server_name("Fischertechnik Factory Simulator")

    # Register namespace 4 (TwinCAT default)
    # opcua library assigns namespace indices sequentially starting from 2.
    # We need ns=4, so register 3 namespaces: idx2, idx3, idx4
    server.register_namespace("placeholder_ns2")
    server.register_namespace("placeholder_ns3")
    ns_idx = server.register_namespace("urn:fischertechnik:factory")
    # ns_idx should be 4

    if ns_idx != 4:
        print(f"WARNING: Expected namespace index 4, got {ns_idx}")

    objects = server.get_objects_node()

    # Create folder structure matching GVL layout and add variables
    # We need nodes addressable as "ns=4;s=gvl_MS.bMotor_MS_Saw"
    node_map = {}  # node_string -> server node object

    type_map = {
        "bool": (ua.VariantType.Boolean, False),
        "int": (ua.VariantType.Int32, 0),
        "enum": (ua.VariantType.Int32, 0),
        "array": (ua.VariantType.String, "[]"),
        "float": (ua.VariantType.Float, 0.0),
        "str": (ua.VariantType.String, ""),
    }

    for station, groups in VARIABLES.items():
        for group_name, vars_dict in groups.items():
            for node_id_str, (label, var_type) in vars_dict.items():
                # node_id_str is e.g. "ns=4;s=gvl_MS.bMotor_MS_Saw"
                s_part = node_id_str.split(";s=", 1)[1]  # "gvl_MS.bMotor_MS_Saw"

                vtype, default = type_map.get(var_type, (ua.VariantType.String, ""))
                node = objects.add_variable(
                    ua.NodeId(s_part, ns_idx),
                    s_part,
                    ua.Variant(default, vtype),
                )
                node.set_writable()
                node_map[s_part] = node

    print(f"Created {len(node_map)} OPC UA variables in namespace {ns_idx}")
    return server, node_map


def replay_loop(events, node_map, speed, server):
    """Main replay loop. Replays events continuously with gap compression."""
    loop_count = 0

    while True:
        loop_count += 1
        print(f"\n--- Replay loop {loop_count} (speed {speed}x) ---")

        # Reset all nodes to defaults at loop start
        for node_string, node in node_map.items():
            try:
                dv = node.get_data_value()
                vtype = dv.Value.VariantType
                if vtype == ua.VariantType.Boolean:
                    node.set_value(ua.Variant(False, ua.VariantType.Boolean))
                elif vtype in (ua.VariantType.Int32, ua.VariantType.Int16):
                    node.set_value(ua.Variant(0, vtype))
                elif vtype == ua.VariantType.Float:
                    node.set_value(ua.Variant(0.0, ua.VariantType.Float))
            except Exception:
                pass

        replay_start = time.time()
        events_applied = 0
        events_skipped = 0

        for offset, node_string, value in events:
            # Target wall-clock time for this event
            target_time = replay_start + (offset / speed)
            now = time.time()

            if now < target_time:
                sleep_time = target_time - now
                # Sleep in small increments to allow clean shutdown
                while sleep_time > 0:
                    time.sleep(min(sleep_time, 0.05))
                    sleep_time = target_time - time.time()

            # Apply event to OPC UA node
            node = node_map.get(node_string)
            if node is None:
                events_skipped += 1
                continue

            try:
                dv = node.get_data_value()
                vtype = dv.Value.VariantType

                if vtype == ua.VariantType.Boolean:
                    node.set_value(ua.Variant(bool(value), ua.VariantType.Boolean))
                elif vtype in (ua.VariantType.Int32, ua.VariantType.Int16):
                    node.set_value(ua.Variant(int(value) if not isinstance(value, bool) else int(value), vtype))
                elif vtype == ua.VariantType.Float:
                    node.set_value(ua.Variant(float(value), ua.VariantType.Float))
                else:
                    node.set_value(ua.Variant(str(value), ua.VariantType.String))

                events_applied += 1
            except Exception as e:
                events_skipped += 1

        elapsed = time.time() - replay_start
        print(f"Loop {loop_count} done: {events_applied} applied, "
              f"{events_skipped} skipped, {elapsed:.1f}s elapsed")


def main():
    parser = argparse.ArgumentParser(
        description="OPC UA Simulator — replays factory.db events as a live OPC UA server"
    )
    parser.add_argument("--port", type=int, default=4840,
                        help="OPC UA server port (default: 4840)")
    parser.add_argument("--speed", type=float, default=1.0,
                        help="Replay speed multiplier (default: 1.0)")
    parser.add_argument("--db", type=str, default=str(DEFAULT_DB),
                        help=f"Path to factory.db (default: {DEFAULT_DB})")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"ERROR: Database not found: {db_path}")
        sys.exit(1)

    print(f"Loading events from {db_path}...")
    events = load_events(db_path)
    if not events:
        print("No events to replay. Exiting.")
        sys.exit(1)

    print(f"\nStarting OPC UA server on opc.tcp://0.0.0.0:{args.port}")
    server, node_map = setup_server(args.port)

    # Handle clean shutdown
    def shutdown(signum, frame):
        print("\nShutting down...")
        server.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    server.start()
    print(f"Server running. Connect with: opc.tcp://localhost:{args.port}")
    print(f"Replay speed: {args.speed}x")

    try:
        replay_loop(events, node_map, args.speed, server)
    except KeyboardInterrupt:
        pass
    finally:
        print("\nStopping server...")
        server.stop()
        print("Done.")


if __name__ == "__main__":
    main()
