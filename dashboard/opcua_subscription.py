from opcua import ua, Client
import time
import sys
import csv
import os
from datetime import datetime
from threading import Thread
from queue import Queue

# =============================================================================
# OPC UA Client for Fischertechnik Factory
# Collects ALL variable changes with timestamps and saves to CSV
# Server runs on Beckhoff CX2030 PLC
#
# Modes:
#   python opcua_subscription.py              → events + periodic polling (default)
#   python opcua_subscription.py --events     → event-based only (changes)
#   python opcua_subscription.py --poll       → periodic polling only
#   python opcua_subscription.py --browse     → browse server node tree
#   python opcua_subscription.py --snapshot   → one-time read of all values
#
# Options:
#   --interval 500   → polling interval in ms (default: 500)
# =============================================================================

SERVER_URL = "opc.tcp://169.254.100.11:4840"

# CSV output directory (same folder as this script)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data")


class CsvWriterThread:
    """
    Non-blocking CSV + SQLite writer: events go into a queue,
    a background thread writes them to both CSV and SQLite.
    No Lock contention in the OPC UA callback.
    """

    def __init__(self, csv_path, run_id=None):
        self.queue = Queue()
        self.csv_path = csv_path
        self.row_count = 0
        self.run_id = run_id
        self._running = True
        self._thread = Thread(target=self._write_loop, daemon=True)
        self._thread.start()

    def _write_loop(self):
        # Initialize SQLite alongside CSV
        db = None
        try:
            from database import FactoryDB
            db = FactoryDB()
            if self.run_id:
                db.register_run(self.run_id, source_file=os.path.basename(self.csv_path))
            print(f"  [DB] SQLite storage active: {db.db_path}")
        except Exception as e:
            print(f"  [DB] SQLite not available ({e}), CSV-only mode")

        db_batch = []

        with open(self.csv_path, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["timestamp", "gvl", "variable", "value", "source"])
            while self._running or not self.queue.empty():
                try:
                    row = self.queue.get(timeout=0.5)
                    # Write to CSV
                    writer.writerow(row)
                    self.row_count += 1

                    # Batch for SQLite
                    if db:
                        db_batch.append(tuple(row))

                    # Flush every 50 rows
                    if self.row_count % 50 == 0:
                        f.flush()
                        # Also flush SQLite batch
                        if db and db_batch:
                            db.insert_batch(db_batch, run_id=self.run_id)
                            db_batch = []
                except Exception:
                    pass
            f.flush()

        # Final SQLite flush
        if db:
            if db_batch:
                db.insert_batch(db_batch, run_id=self.run_id)
            if self.run_id:
                db.finish_run(self.run_id)
            db.close()

    def write(self, timestamp, gvl, variable, value, source="event"):
        self.queue.put([timestamp, gvl, variable, value, source])

    def stop(self):
        self._running = False
        self._thread.join(timeout=5)


class QueueSubHandler(object):
    """
    Subscription Handler that pushes data changes into a queue
    instead of writing directly — no blocking in the callback.
    """

    def __init__(self, csv_writer, node_map):
        self.csv_writer = csv_writer
        self.node_map = node_map

    def datachange_notification(self, node, val, data):
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        node_key = node.nodeid.to_string()
        var_name, gvl_name = self.node_map.get(node_key, (str(node.nodeid), "unknown"))
        self.csv_writer.write(timestamp, gvl_name, var_name, val, "event")
        print(f"  [EVT] {timestamp} | {gvl_name}.{var_name} = {val}")


def browse_node(node, level=0, max_depth=3):
    """Recursively browse OPC UA nodes to discover available variables."""
    if level >= max_depth:
        return
    indent = "  " * level
    try:
        for child in node.get_children():
            name = child.get_browse_name().Name
            node_class = child.get_node_class()
            if node_class == ua.NodeClass.Variable:
                try:
                    val = child.get_value()
                    print(f"{indent}[VAR] {name} = {val}  (NodeId: {child.nodeid})")
                except Exception:
                    print(f"{indent}[VAR] {name}  (NodeId: {child.nodeid})")
            else:
                print(f"{indent}[DIR] {name}")
                browse_node(child, level + 1, max_depth)
    except Exception as e:
        print(f"{indent}  Error browsing: {e}")


def browse_server(client):
    """Browse the server to find all available GVL variables."""
    print("=" * 60)
    print("Browsing OPC UA Server...")
    print("=" * 60)
    objects = client.get_objects_node()
    browse_node(objects, max_depth=5)


def find_gvl_nodes(client):
    """
    Find all GVL variable nodes on the server.
    TwinCAT exposes them under: Objects > PLC1 > gvl_xxx > variable
    Returns dict: node_id_string -> (var_name, gvl_name)
    and list of (node, var_name, gvl_name) tuples.
    """
    node_map = {}
    var_nodes = []

    objects = client.get_objects_node()
    for child in objects.get_children():
        try:
            for plc_child in child.get_children():
                plc_name = plc_child.get_browse_name().Name
                if plc_name.lower().startswith("gvl") or plc_name.lower().startswith("localvariables"):
                    for var_node in plc_child.get_children():
                        if var_node.get_node_class() == ua.NodeClass.Variable:
                            var_name = var_node.get_browse_name().Name
                            node_key = var_node.nodeid.to_string()
                            node_map[node_key] = (var_name, plc_name)
                            var_nodes.append((var_node, var_name, plc_name))
        except Exception:
            pass

    return node_map, var_nodes


def poll_all(var_nodes, csv_writer):
    """Read all variables once and write to CSV as 'poll' entries."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    for var_node, var_name, gvl_name in var_nodes:
        try:
            val = var_node.get_value()
            csv_writer.write(timestamp, gvl_name, var_name, val, "poll")
        except Exception:
            pass


def collect_data(client, mode="both", poll_interval_ms=500):
    """
    Collect factory data and save to CSV.

    mode:
        "events" — subscription-based, only records changes
        "poll"   — periodic polling, reads ALL variables every interval
        "both"   — events + polling (default, best coverage)
    """
    os.makedirs(DATA_DIR, exist_ok=True)

    run_time = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_id = f"factory_run_{run_time}"
    csv_path = os.path.join(DATA_DIR, f"{run_id}.csv")

    print(f"Finding all GVL variables...")
    node_map, var_nodes = find_gvl_nodes(client)
    print(f"Found {len(var_nodes)} variables.\n")

    # Start non-blocking CSV + SQLite writer
    csv_writer = CsvWriterThread(csv_path, run_id=run_id)

    # Subscribe to events
    if mode in ("events", "both"):
        handler = QueueSubHandler(csv_writer, node_map)
        sub = client.create_subscription(100, handler)  # 100ms interval

        subscribed = 0
        for var_node, var_name, gvl_name in var_nodes:
            try:
                sub.subscribe_data_change(var_node)
                subscribed += 1
            except Exception as e:
                print(f"  - {gvl_name}.{var_name} (failed: {e})")

        print(f"Subscribed to {subscribed} variables (event-based).")

    if mode in ("poll", "both"):
        print(f"Polling all variables every {poll_interval_ms}ms.")

    print(f"Saving to: {csv_path}")
    print(f"\nCollecting data... (Ctrl+C to stop)\n")
    print("-" * 60)

    poll_interval_s = poll_interval_ms / 1000.0
    poll_count = 0

    try:
        while True:
            if mode in ("poll", "both"):
                poll_all(var_nodes, csv_writer)
                poll_count += 1
                if poll_count % 10 == 0:
                    print(f"  [POLL] {datetime.now().strftime('%H:%M:%S')} | "
                          f"poll #{poll_count}, {csv_writer.row_count} total rows")
            time.sleep(poll_interval_s)
    except KeyboardInterrupt:
        pass

    csv_writer.stop()

    print(f"\n{'=' * 60}")
    print(f"Data collection finished.")
    print(f"Total rows recorded: {csv_writer.row_count}")
    print(f"CSV saved to: {csv_path}")
    print(f"{'=' * 60}")


def snapshot(client):
    """Take a single snapshot of all variable values and save to CSV."""
    os.makedirs(DATA_DIR, exist_ok=True)

    run_time = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = os.path.join(DATA_DIR, f"snapshot_{run_time}.csv")

    print(f"Taking snapshot of all variables...")
    node_map, var_nodes = find_gvl_nodes(client)

    with open(csv_path, "w", newline="") as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(["timestamp", "gvl", "variable", "value", "source"])

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        for var_node, var_name, gvl_name in var_nodes:
            try:
                val = var_node.get_value()
                writer.writerow([now, gvl_name, var_name, val, "snapshot"])
                print(f"  {gvl_name}.{var_name} = {val}")
            except Exception as e:
                print(f"  {gvl_name}.{var_name} (error: {e})")

    print(f"\nSnapshot saved to: {csv_path}")


if __name__ == "__main__":
    # Parse polling interval
    poll_interval = 500
    for i, arg in enumerate(sys.argv):
        if arg == "--interval" and i + 1 < len(sys.argv):
            poll_interval = int(sys.argv[i + 1])

    # Determine mode
    if "--events" in sys.argv:
        mode = "events"
    elif "--poll" in sys.argv:
        mode = "poll"
    else:
        mode = "both"

    print(f"""
{'=' * 60}
  Fischertechnik Factory - OPC UA Data Collector
{'=' * 60}

Modes:
  python opcua_subscription.py              → events + polling (default)
  python opcua_subscription.py --events     → event-based only (changes)
  python opcua_subscription.py --poll       → periodic polling only
  python opcua_subscription.py --browse     → browse server node tree
  python opcua_subscription.py --snapshot   → one-time read of all values

Options:
  --interval 500   → polling interval in ms (default: 500)

Server: {SERVER_URL}
Output: {DATA_DIR}/
""")

    client = Client(SERVER_URL)

    try:
        print(f"Connecting to {SERVER_URL} ...")
        client.connect()
        print("Connected!\n")

        if "--browse" in sys.argv:
            browse_server(client)
        elif "--snapshot" in sys.argv:
            snapshot(client)
        else:
            collect_data(client, mode=mode, poll_interval_ms=poll_interval)

    except KeyboardInterrupt:
        print("\nStopped by user.")
    except Exception as e:
        print(f"\nConnection error: {e}")
        print("Make sure you are connected to the factory LAN via Ethernet.")
    finally:
        try:
            client.disconnect()
            print("Disconnected.")
        except Exception:
            pass
