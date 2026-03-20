"""
OPC UA Event Collector — subscription-based, no polling.

Subscribes to all PLC variables via OPC UA and writes every
data-change event to a portable SQLite database (DELETE journal mode,
no WAL — single .db file, always uploadable).

Usage:
    python collect.py                  → connect and collect events
    python collect.py --browse         → browse server node tree
    python collect.py --snapshot       → one-time read of all values
    python collect.py --simulate 5     → simulate 5 factory runs (no PLC needed)
"""

import os
import sys
import sqlite3
import time
from datetime import datetime, timedelta
from threading import Thread
from queue import Queue, Empty

SERVER_URL = "opc.tcp://169.254.100.11:4840"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(SCRIPT_DIR, "data", "factory.db")

GVL_TO_STATION = {
    "gvl_MS": "MS",
    "gvl_C": "Crane",
    "gvl_SL": "SL",
    "gvl_HBW": "HBW",
    "gvl_PM": "PM",
    "LocalVariables": "State",
}


# ---------------------------------------------------------------------------
# Database (DELETE journal — single portable file, no -wal/-shm)
# ---------------------------------------------------------------------------

def open_db(path=DB_PATH):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=DELETE")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            gvl TEXT NOT NULL,
            variable TEXT NOT NULL,
            value TEXT,
            source TEXT,
            station TEXT,
            run_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
        CREATE INDEX IF NOT EXISTS idx_events_station   ON events(station);
        CREATE INDEX IF NOT EXISTS idx_events_variable  ON events(variable);
        CREATE INDEX IF NOT EXISTS idx_events_run_id    ON events(run_id);

        CREATE TABLE IF NOT EXISTS runs (
            run_id TEXT PRIMARY KEY,
            started_at TEXT,
            ended_at TEXT,
            event_count INTEGER DEFAULT 0
        );
    """)
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Background writer — events queue → SQLite (batched)
# ---------------------------------------------------------------------------

class EventWriter:
    def __init__(self, conn, run_id):
        self.conn = conn
        self.run_id = run_id
        self.queue = Queue()
        self.count = 0
        self._running = True
        self._thread = Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self):
        batch = []
        while self._running or not self.queue.empty():
            try:
                row = self.queue.get(timeout=0.5)
                batch.append(row)
                self.count += 1
                if len(batch) >= 50:
                    self._flush(batch)
                    batch = []
            except Empty:
                if batch:
                    self._flush(batch)
                    batch = []
        if batch:
            self._flush(batch)

    def _flush(self, batch):
        self.conn.executemany(
            "INSERT INTO events (timestamp, gvl, variable, value, source, station, run_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)", batch
        )
        self.conn.commit()

    def write(self, timestamp, gvl, variable, value, source="event"):
        station = GVL_TO_STATION.get(gvl, gvl)
        self.queue.put((timestamp, gvl, variable, str(value), source, station, self.run_id))

    def stop(self):
        self._running = False
        self._thread.join(timeout=5)


# ---------------------------------------------------------------------------
# OPC UA subscription handler
# ---------------------------------------------------------------------------

class ChangeHandler:
    def __init__(self, writer, node_map):
        self.writer = writer
        self.node_map = node_map

    def datachange_notification(self, node, val, data):
        if val is None:
            return
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        node_key = node.nodeid.to_string()
        var_name, gvl = self.node_map.get(node_key, (str(node.nodeid), "unknown"))
        self.writer.write(ts, gvl, var_name, val)
        print(f"  {ts} | {gvl}.{var_name} = {val}")


# ---------------------------------------------------------------------------
# OPC UA helpers
# ---------------------------------------------------------------------------

def find_gvl_nodes(client):
    from opcua import ua
    node_map = {}
    var_nodes = []
    for child in client.get_objects_node().get_children():
        try:
            for plc_child in child.get_children():
                name = plc_child.get_browse_name().Name
                if name.lower().startswith("gvl") or name.lower().startswith("localvariables"):
                    for var_node in plc_child.get_children():
                        if var_node.get_node_class() == ua.NodeClass.Variable:
                            vn = var_node.get_browse_name().Name
                            nk = var_node.nodeid.to_string()
                            node_map[nk] = (vn, name)
                            var_nodes.append((var_node, vn, name))
        except Exception:
            pass
    return node_map, var_nodes


def browse_node(node, level=0, max_depth=3):
    from opcua import ua
    if level >= max_depth:
        return
    indent = "  " * level
    try:
        for child in node.get_children():
            name = child.get_browse_name().Name
            if child.get_node_class() == ua.NodeClass.Variable:
                try:
                    val = child.get_value()
                    print(f"{indent}[VAR] {name} = {val}  ({child.nodeid})")
                except Exception:
                    print(f"{indent}[VAR] {name}  ({child.nodeid})")
            else:
                print(f"{indent}[DIR] {name}")
                browse_node(child, level + 1, max_depth)
    except Exception as e:
        print(f"{indent}  Error: {e}")


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_collect():
    """Connect to PLC, subscribe to all variables, write changes to SQLite."""
    from opcua import Client
    conn = open_db()
    run_id = f"factory_run_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    conn.execute("INSERT OR IGNORE INTO runs (run_id, started_at) VALUES (?, ?)",
                 (run_id, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
    conn.commit()

    client = Client(SERVER_URL)
    try:
        print(f"Connecting to {SERVER_URL} ...")
        client.connect()
        print("Connected.\n")

        node_map, var_nodes = find_gvl_nodes(client)
        print(f"Found {len(var_nodes)} variables.")

        writer = EventWriter(conn, run_id)
        handler = ChangeHandler(writer, node_map)
        sub = client.create_subscription(100, handler)

        subscribed = 0
        for var_node, vn, gvl in var_nodes:
            try:
                sub.subscribe_data_change(var_node)
                subscribed += 1
            except Exception as e:
                print(f"  skip {gvl}.{vn}: {e}")

        print(f"Subscribed to {subscribed} variables (event-based, no polling).")
        print(f"Collecting... Ctrl+C to stop.\n")

        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        print("\nStopping...")
    except Exception as e:
        print(f"\nError: {e}")
        print("Check that you're on the factory LAN via Ethernet.")
    finally:
        writer.stop()
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute("UPDATE runs SET ended_at = ?, event_count = ? WHERE run_id = ?",
                     (now, writer.count, run_id))
        conn.commit()
        try:
            sub.delete()
        except Exception:
            pass
        try:
            client.disconnect()
        except Exception:
            pass
        conn.close()
        print(f"Done. {writer.count} events saved to {DB_PATH}")


def cmd_browse():
    from opcua import Client
    client = Client(SERVER_URL)
    try:
        client.connect()
        print("Browsing OPC UA Server...\n")
        browse_node(client.get_objects_node(), max_depth=5)
    finally:
        client.disconnect()


def cmd_snapshot():
    from opcua import Client
    conn = open_db()
    run_id = f"snapshot_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    conn.execute("INSERT OR IGNORE INTO runs (run_id, started_at) VALUES (?, ?)",
                 (run_id, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))

    client = Client(SERVER_URL)
    try:
        client.connect()
        _, var_nodes = find_gvl_nodes(client)
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        rows = []
        for var_node, vn, gvl in var_nodes:
            try:
                val = var_node.get_value()
                station = GVL_TO_STATION.get(gvl, gvl)
                rows.append((now, gvl, vn, str(val), "snapshot", station, run_id))
                print(f"  {gvl}.{vn} = {val}")
            except Exception as e:
                print(f"  {gvl}.{vn} error: {e}")

        conn.executemany(
            "INSERT INTO events (timestamp, gvl, variable, value, source, station, run_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)", rows
        )
        now2 = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute("UPDATE runs SET ended_at = ?, event_count = ? WHERE run_id = ?",
                     (now2, len(rows), run_id))
        conn.commit()
        print(f"\nSnapshot: {len(rows)} variables saved.")
    finally:
        client.disconnect()
        conn.close()


def cmd_simulate(num_runs=3):
    """Generate simulated factory data (no PLC needed)."""
    import random

    conn = open_db()
    run_id = f"sim_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    conn.execute("INSERT OR IGNORE INTO runs (run_id, started_at) VALUES (?, ?)",
                 (run_id, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))

    writer = EventWriter(conn, run_id)

    COLORS = ["white", "red", "blue"]
    COLOR_VALS = {"white": (250, 300), "red": (130, 190), "blue": (40, 60)}

    def emit(t, gvl, var, val):
        ts = t.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        writer.write(ts, gvl, var, val, "sim")

    def sim_hbw(t):
        g = "gvl_HBW"
        emit(t, g, "bMotor_HBW_StackerCrane_torack", True)
        t += timedelta(seconds=1.5); emit(t, g, "bReferenceSwitch_HBW_horizontal", False)
        t += timedelta(seconds=2.0); emit(t, g, "bMotor_HBW_StackerCrane_torack", False)
        emit(t, g, "bMotor_HBW_StackerCrane_downward", True)
        t += timedelta(seconds=1.0); emit(t, g, "bReferenceSwitch_HBW_vertical", False)
        t += timedelta(seconds=0.5); emit(t, g, "bMotor_HBW_StackerCrane_downward", False)
        emit(t, g, "bMotor_HBW_Cantilever_forward", True)
        t += timedelta(seconds=0.8); emit(t, g, "bReferenceSwitch_HBW_Cantilever_front", True)
        emit(t, g, "bMotor_HBW_Cantilever_forward", False)
        t += timedelta(seconds=0.3); emit(t, g, "bMotor_HBW_Cantilever_backward", True)
        t += timedelta(seconds=0.8); emit(t, g, "bReferenceSwitch_HBW_Cantilever_back", True)
        emit(t, g, "bReferenceSwitch_HBW_Cantilever_front", False)
        emit(t, g, "bMotor_HBW_Cantilever_backward", False)
        emit(t, g, "bMotor_HBW_StackerCrane_toconveyorbelt", True)
        emit(t, g, "bMotor_HBW_StackerCrane_upward", True)
        t += timedelta(seconds=2.0); emit(t, g, "bReferenceSwitch_HBW_horizontal", True)
        emit(t, g, "bReferenceSwitch_HBW_vertical", True)
        emit(t, g, "bMotor_HBW_StackerCrane_toconveyorbelt", False)
        emit(t, g, "bMotor_HBW_StackerCrane_upward", False)
        emit(t, g, "bMotor_HBW_Cantilever_forward", True)
        t += timedelta(seconds=0.8); emit(t, g, "bMotor_HBW_Cantilever_forward", False)
        emit(t, g, "bMotor_HBW_Cantilever_backward", True)
        t += timedelta(seconds=0.8); emit(t, g, "bMotor_HBW_Cantilever_backward", False)
        emit(t, g, "bMotor_HBW_ConveyorBelt_forward", True)
        emit(t, g, "bLightBarrier_HBW_inside", True)
        t += timedelta(seconds=1.5); emit(t, g, "bLightBarrier_HBW_inside", False)
        emit(t, g, "bLightBarrier_HBW_outside", True)
        emit(t, g, "bMotor_HBW_ConveyorBelt_forward", False)
        return t

    def sim_crane_pick(t):
        g = "gvl_C"
        emit(t, g, "bCompressor_C", True)
        t += timedelta(seconds=0.5)
        emit(t, g, "bMotor_C_clockwise", True)
        t += timedelta(seconds=1.2); emit(t, g, "bReferenceSwitch_C_rotate", False)
        t += timedelta(seconds=1.0); emit(t, g, "bMotor_C_clockwise", False)
        emit(t, g, "bMotor_C_forward", True)
        t += timedelta(seconds=1.5); emit(t, g, "bReferenceSwitch_C_horizontal", False)
        emit(t, g, "bMotor_C_forward", False)
        emit(t, g, "bMotor_C_downward", True)
        t += timedelta(seconds=1.0); emit(t, g, "bReferenceSwitch_C_vertical", False)
        emit(t, g, "bMotor_C_downward", False)
        emit(t, g, "bValve_C", True)
        t += timedelta(seconds=0.5)
        emit(t, g, "bMotor_C_upward", True)
        t += timedelta(seconds=1.0); emit(t, g, "bReferenceSwitch_C_vertical", True)
        emit(t, g, "bMotor_C_upward", False)
        emit(t, g, "bMotor_C_backward", True)
        t += timedelta(seconds=1.5); emit(t, g, "bReferenceSwitch_C_horizontal", True)
        emit(t, g, "bMotor_C_backward", False)
        return t

    def sim_crane_place(t):
        g = "gvl_C"
        emit(t, g, "bMotor_C_counterclockwise", True)
        t += timedelta(seconds=1.5); emit(t, g, "bMotor_C_counterclockwise", False)
        emit(t, g, "bMotor_C_forward", True)
        t += timedelta(seconds=1.5); emit(t, g, "bMotor_C_forward", False)
        emit(t, g, "bMotor_C_downward", True)
        t += timedelta(seconds=1.0); emit(t, g, "bMotor_C_downward", False)
        emit(t, g, "bValve_C", False)
        t += timedelta(seconds=0.3)
        emit(t, g, "bMotor_C_upward", True)
        t += timedelta(seconds=1.0); emit(t, g, "bMotor_C_upward", False)
        emit(t, g, "bMotor_C_backward", True)
        t += timedelta(seconds=1.5); emit(t, g, "bMotor_C_backward", False)
        emit(t, g, "bMotor_C_clockwise", True)
        t += timedelta(seconds=1.0); emit(t, g, "bReferenceSwitch_C_rotate", True)
        emit(t, g, "bMotor_C_clockwise", False)
        emit(t, g, "bCompressor_C", False)
        return t

    def sim_ms_burn(t):
        g = "gvl_MS"
        emit(t, g, "bLightBarrier_MS_conveyorbelt", True)
        emit(t, g, "bMotor_MS_ConveyorBelt_forward", True)
        t += timedelta(seconds=1.0); emit(t, g, "bMotor_MS_ConveyorBelt_forward", False)
        emit(t, g, "bLightBarrier_MS_conveyorbelt", False)
        emit(t, g, "bMotor_MS_Turntable_clockwise", True)
        t += timedelta(seconds=1.2); emit(t, g, "bReferenceSwitch_MS_Turntable_attransferunit", True)
        emit(t, g, "bReferenceSwitch_MS_Turntable_atconveyorbelt", False)
        emit(t, g, "bMotor_MS_Turntable_clockwise", False)
        emit(t, g, "bCompressor_MS", True)
        t += timedelta(seconds=0.3); emit(t, g, "bValve_MS_Vacuum", True)
        emit(t, g, "bValve_MS_TransferUnit", True)
        t += timedelta(seconds=0.5); emit(t, g, "bMotor_MS_TransferUnit_tooven", True)
        t += timedelta(seconds=1.5); emit(t, g, "bReferenceSwitch_MS_TransferUnit_atoven", True)
        emit(t, g, "bReferenceSwitch_MS_TransferUnit_atturntable", False)
        emit(t, g, "bMotor_MS_TransferUnit_tooven", False)
        emit(t, g, "bValve_MS_Vacuum", False)
        emit(t, g, "bValve_MS_TransferUnit", False)
        t += timedelta(seconds=0.3); emit(t, g, "bLightBarrier_MS_oven", True)
        emit(t, g, "bValve_MS_OvenDoor", True)
        t += timedelta(seconds=0.8); emit(t, g, "bMotor_MS_OvenSlider_movein", True)
        t += timedelta(seconds=1.5); emit(t, g, "bReferenceSwitch_MS_OvenSlider_inside", True)
        emit(t, g, "bReferenceSwitch_MS_OvenSlider_outside", False)
        emit(t, g, "bMotor_MS_OvenSlider_movein", False)
        emit(t, g, "bValve_MS_OvenDoor", False)
        t += timedelta(seconds=0.5); emit(t, g, "bLamp_MS", True)
        t += timedelta(seconds=3.0); emit(t, g, "bLamp_MS", False)
        emit(t, g, "bValve_MS_OvenDoor", True)
        t += timedelta(seconds=0.5); emit(t, g, "bMotor_MS_OvenSlider_moveout", True)
        t += timedelta(seconds=1.5); emit(t, g, "bReferenceSwitch_MS_OvenSlider_outside", True)
        emit(t, g, "bReferenceSwitch_MS_OvenSlider_inside", False)
        emit(t, g, "bMotor_MS_OvenSlider_moveout", False)
        emit(t, g, "bValve_MS_OvenDoor", False)
        emit(t, g, "bValve_MS_Vacuum", True)
        emit(t, g, "bValve_MS_TransferUnit", True)
        t += timedelta(seconds=0.5); emit(t, g, "bLightBarrier_MS_oven", False)
        emit(t, g, "bMotor_MS_TransferUnit_toturntable", True)
        t += timedelta(seconds=1.5); emit(t, g, "bReferenceSwitch_MS_TransferUnit_atturntable", True)
        emit(t, g, "bReferenceSwitch_MS_TransferUnit_atoven", False)
        emit(t, g, "bMotor_MS_TransferUnit_toturntable", False)
        emit(t, g, "bValve_MS_Vacuum", False)
        emit(t, g, "bValve_MS_TransferUnit", False)
        return t

    def sim_ms_saw(t):
        g = "gvl_MS"
        emit(t, g, "bMotor_MS_Turntable_counterclockwise", True)
        t += timedelta(seconds=1.0); emit(t, g, "bReferenceSwitch_MS_Turntable_atsaw", True)
        emit(t, g, "bReferenceSwitch_MS_Turntable_attransferunit", False)
        emit(t, g, "bMotor_MS_Turntable_counterclockwise", False)
        emit(t, g, "bMotor_MS_Saw", True)
        t += timedelta(seconds=2.5); emit(t, g, "bMotor_MS_Saw", False)
        emit(t, g, "bMotor_MS_Turntable_clockwise", True)
        t += timedelta(seconds=1.5); emit(t, g, "bReferenceSwitch_MS_Turntable_atconveyorbelt", True)
        emit(t, g, "bReferenceSwitch_MS_Turntable_atsaw", False)
        emit(t, g, "bMotor_MS_Turntable_clockwise", False)
        emit(t, g, "bValve_MS_Ejector", True)
        t += timedelta(seconds=0.5); emit(t, g, "bValve_MS_Ejector", False)
        emit(t, g, "bCompressor_MS", False)
        return t

    def sim_punch(t):
        g = "gvl_PM"
        emit(t, g, "bLightBarrier_PM_entry", True)
        emit(t, g, "bMotor_PM_ConveyorBelt_forward", True)
        t += timedelta(seconds=1.5); emit(t, g, "bLightBarrier_PM_entry", False)
        emit(t, g, "bLightBarrier_PM_tool", True)
        emit(t, g, "bMotor_PM_ConveyorBelt_forward", False)
        emit(t, g, "bMotor_PM_Tool_downward", True)
        emit(t, g, "bReferenceSwitch_PM_top", False)
        t += timedelta(seconds=1.0); emit(t, g, "bReferenceSwitch_PM_bottom", True)
        emit(t, g, "bMotor_PM_Tool_downward", False)
        t += timedelta(seconds=0.3); emit(t, g, "bMotor_PM_Tool_upward", True)
        emit(t, g, "bReferenceSwitch_PM_bottom", False)
        t += timedelta(seconds=1.0); emit(t, g, "bReferenceSwitch_PM_top", True)
        emit(t, g, "bMotor_PM_Tool_upward", False)
        emit(t, g, "bMotor_PM_ConveyorBelt_forward", True)
        t += timedelta(seconds=1.0); emit(t, g, "bLightBarrier_PM_tool", False)
        emit(t, g, "bMotor_PM_ConveyorBelt_forward", False)
        return t

    def sim_sort(t, color):
        g = "gvl_SL"
        cv = random.randint(*COLOR_VALS[color])
        emit(t, g, "bMotor_SL_ConveyorBelt", True)
        emit(t, g, "bCompressor_SL", True)
        t += timedelta(seconds=1.0)
        emit(t, g, "bLightBarrier_SL_beforecolor", True)
        t += timedelta(seconds=0.3); emit(t, g, "iColorSensor_SL", cv)
        t += timedelta(seconds=0.5); emit(t, g, "bLightBarrier_SL_beforecolor", False)
        emit(t, g, "bLightBarrier_SL_aftercolor", True)
        t += timedelta(seconds=0.3); emit(t, g, "bLightBarrier_SL_aftercolor", False)
        emit(t, g, "iColorSensor_SL", 0)
        delay = {"white": 1.5, "red": 2.5, "blue": 3.5}
        t += timedelta(seconds=delay[color])
        emit(t, g, f"bValve_SL_{color}", True)
        t += timedelta(seconds=0.3); emit(t, g, f"bLightBarrier_SL_{color}", True)
        t += timedelta(seconds=0.5); emit(t, g, f"bValve_SL_{color}", False)
        emit(t, g, f"bLightBarrier_SL_{color}", False)
        emit(t, g, "bMotor_SL_ConveyorBelt", False)
        emit(t, g, "bCompressor_SL", False)
        return t

    colors = [COLORS[i % 3] for i in range(num_runs)]
    random.shuffle(colors)

    print(f"Simulating {num_runs} runs: {', '.join(colors)}")
    t = datetime.now()
    for i, c in enumerate(colors):
        print(f"  Run {i+1}/{num_runs}: {c}")
        t = sim_hbw(t);           t += timedelta(seconds=0.5)
        t = sim_crane_pick(t);    t += timedelta(seconds=0.5)
        t = sim_crane_place(t);   t += timedelta(seconds=0.5)
        t = sim_ms_burn(t);       t += timedelta(seconds=0.5)
        t = sim_ms_saw(t);        t += timedelta(seconds=0.5)
        t = sim_punch(t);         t += timedelta(seconds=0.5)
        t = sim_sort(t, c);       t += timedelta(seconds=2.0)

    writer.stop()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute("UPDATE runs SET ended_at = ?, event_count = ? WHERE run_id = ?",
                 (now, writer.count, run_id))
    conn.commit()
    conn.close()
    print(f"\nDone. {writer.count} events → {DB_PATH}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if "--browse" in sys.argv:
        cmd_browse()
    elif "--snapshot" in sys.argv:
        cmd_snapshot()
    elif "--simulate" in sys.argv:
        n = 3
        for i, a in enumerate(sys.argv):
            if a == "--simulate" and i + 1 < len(sys.argv):
                try:
                    n = int(sys.argv[i + 1])
                except ValueError:
                    pass
        cmd_simulate(n)
    else:
        cmd_collect()
