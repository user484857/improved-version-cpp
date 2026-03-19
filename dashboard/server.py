"""
Glassmorphism Dashboard Server for Fischertechnik Factory.

Modes:
  - Demo mode (default): Replays recorded CSV data — no PLC needed
  - Live mode: Reads from PLC via OPC UA

Usage:
  python server.py                           # Demo mode (auto-finds CSV)
  python server.py --csv path/to/data.csv    # Demo mode with specific CSV
  python server.py --live                    # Live OPC UA mode
  python server.py --speed 3                 # Replay at 3x speed
"""

import argparse
import glob
import os
import sys

from flask import Flask, jsonify, send_from_directory

app = Flask(__name__, static_folder="static")

# Will be set based on mode
data_source = None
mode = "demo"


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/static/<path:path>")
def static_files(path):
    return send_from_directory("static", path)


@app.route("/api/data")
def api_data():
    """Return current state of all variables."""
    if mode == "demo":
        state = data_source.current_state()
        progress = data_source.get_progress()
        return jsonify({
            "status": "connected",
            "mode": "demo",
            "progress": progress,
            "data": state,
        })
    else:
        try:
            if not data_source.is_connected:
                data_source.connect()
            raw = data_source.read_all()
            return jsonify({"status": "connected", "mode": "live", "data": raw})
        except Exception as e:
            return jsonify({"status": "disconnected", "mode": "live", "error": str(e), "data": {}})


@app.route("/api/config")
def api_config():
    """Return variable configuration for dynamic frontend rendering."""
    if mode == "demo":
        return jsonify(data_source.get_config())
    else:
        from config import VARIABLES
        config = {}
        for station, groups in VARIABLES.items():
            config[station] = {}
            for group_name, vars_dict in groups.items():
                config[station][group_name] = {}
                for node_id, (label, var_type) in vars_dict.items():
                    config[station][group_name][label] = var_type
        return jsonify(config)


@app.route("/api/status")
def api_status():
    """Return server status and mode info."""
    info = {"mode": mode}
    if mode == "demo" and data_source:
        info["csv"] = str(data_source.csv_path.name)
        info["progress"] = data_source.get_progress()
        info["events"] = len(data_source._events)
    return jsonify(info)


@app.route("/api/switch-mode", methods=["POST"])
def api_switch_mode():
    """Switch between demo and live data source at runtime."""
    from flask import request
    global data_source, mode

    target = request.json.get("mode")

    if target == "demo":
        csv_path = find_csv()
        if not csv_path:
            return jsonify({"error": "No CSV file found for demo mode"}), 400
        # Stop current source
        if data_source and hasattr(data_source, "stop"):
            data_source.stop()
        from demo_player import DemoPlayer
        data_source = DemoPlayer(csv_path, speed=2.0, loop=True)
        data_source.start()
        mode = "demo"
        return jsonify({"mode": mode, "csv": os.path.basename(csv_path)})

    elif target == "live":
        try:
            from opcua_client import PLCConnection
            if data_source and hasattr(data_source, "stop"):
                data_source.stop()
            data_source = PLCConnection()
            mode = "live"
            return jsonify({"mode": mode})
        except Exception as e:
            return jsonify({"error": f"Cannot connect to PLC: {e}"}), 500

    return jsonify({"error": "Invalid mode. Use 'demo' or 'live'."}), 400


# ---------------------------------------------------------------------------
# History API — queries SQLite database (if available)
# ---------------------------------------------------------------------------
_factory_db = None


def _get_db():
    """Lazy-load the factory database."""
    global _factory_db
    if _factory_db is None:
        try:
            import sys
            db_module = os.path.normpath(os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "tag 6"
            ))
            if db_module not in sys.path:
                sys.path.insert(0, db_module)
            from database import FactoryDB
            _factory_db = FactoryDB()
        except Exception:
            return None
    return _factory_db


@app.route("/api/history")
def api_history():
    """Query historical events from SQLite.

    Query params: station, variable, since, until, run_id, limit (default 200)
    """
    from flask import request
    db = _get_db()
    if db is None:
        return jsonify({"error": "SQLite database not available"}), 503

    rows = db.query(
        station=request.args.get("station"),
        variable=request.args.get("variable"),
        since=request.args.get("since"),
        until=request.args.get("until"),
        run_id=request.args.get("run_id"),
        limit=int(request.args.get("limit", 200)),
    )
    return jsonify(rows)


@app.route("/api/runs")
def api_runs():
    """List all recorded runs from SQLite."""
    db = _get_db()
    if db is None:
        return jsonify({"error": "SQLite database not available"}), 503
    return jsonify(db.list_runs())


@app.route("/api/db-stats")
def api_db_stats():
    """Return database statistics."""
    db = _get_db()
    if db is None:
        return jsonify({"error": "SQLite database not available"}), 503
    return jsonify(db.stats())


def find_csv():
    """Auto-discover the largest CSV in nearby data directories."""
    base = os.path.dirname(os.path.abspath(__file__))
    # base = dashboard/, ../../../ = cpp/ (up from dashboard → Day5 → tag5 → cpp)
    cpp_root = os.path.normpath(os.path.join(base, "..", "..", ".."))
    search_paths = [
        os.path.join(cpp_root, "tag 6", "data", "factory_run_*.csv"),
        os.path.join(cpp_root, "tag 6", "data", "*.csv"),
        os.path.join(base, "data", "*.csv"),
        os.path.join(base, "*.csv"),
    ]
    best = None
    best_size = 0
    for pattern in search_paths:
        for path in glob.glob(pattern):
            size = os.path.getsize(path)
            if size > best_size:
                best = path
                best_size = size
    return best


def main():
    global data_source, mode

    parser = argparse.ArgumentParser(description="Fischertechnik Glass Dashboard")
    parser.add_argument("--live", action="store_true", help="Live OPC UA mode")
    parser.add_argument("--csv", type=str, help="Path to CSV file for demo replay")
    parser.add_argument("--speed", type=float, default=2.0, help="Replay speed multiplier (default: 2x)")
    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8050)
    args = parser.parse_args()

    if args.live:
        mode = "live"
        from opcua_client import PLCConnection
        data_source = PLCConnection()
        print(f"\n  Fischertechnik Factory — Glass Dashboard")
        print(f"  Mode: LIVE (OPC UA)")
        print(f"  http://localhost:{args.port}\n")
    else:
        mode = "demo"
        csv_path = args.csv or find_csv()
        if not csv_path:
            print("No CSV file found for demo mode.")
            print("Use --csv path/to/data.csv or --live for OPC UA mode.")
            sys.exit(1)

        from demo_player import DemoPlayer
        data_source = DemoPlayer(csv_path, speed=args.speed, loop=True)
        data_source.start()

        print(f"\n  Fischertechnik Factory — Glass Dashboard")
        print(f"  Mode: DEMO (CSV replay at {args.speed}x)")
        print(f"  File: {os.path.basename(csv_path)} ({len(data_source._events)} events)")
        print(f"  http://localhost:{args.port}\n")

    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
