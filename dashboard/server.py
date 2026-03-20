"""
Glassmorphism Dashboard Server for Fischertechnik Factory.

Modes:
  - Demo mode (default): Replays recorded data — no PLC needed
    Prefers SQLite database (factory.db), falls back to CSV
  - Live mode: Reads from PLC via OPC UA

Usage:
  python server.py                           # Demo mode (auto: DB → CSV)
  python server.py --demo-db                 # Force SQLite demo mode
  python server.py --csv path/to/data.csv    # Force CSV demo mode
  python server.py --live                    # Live OPC UA mode
  python server.py --speed 3                 # Replay at 3x speed
"""

import argparse
import glob
import os
import sys

from flask import Flask, jsonify, send_from_directory

app = Flask(__name__, static_folder="static")

DASHBOARD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dashboards")

# Will be set based on mode
data_source = None
mode = "live"


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/twin")
def dashboard_twin():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "twin"), "index.html")

@app.route("/twin-a")
def dashboard_twin_a():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "twin-a"), "index.html")

@app.route("/twin-b")
def dashboard_twin_b():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "twin-b"), "index.html")

@app.route("/quality")
def dashboard_quality():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "quality"), "index.html")

@app.route("/quality-a")
def dashboard_quality_a():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "quality-a"), "index.html")

@app.route("/quality-b")
def dashboard_quality_b():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "quality-b"), "index.html")

@app.route("/kpi")
def dashboard_kpi():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "kpi"), "index.html")

@app.route("/kpi-a")
def dashboard_kpi_a():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "kpi-a"), "index.html")

@app.route("/kpi-b")
def dashboard_kpi_b():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "kpi-b"), "index.html")

@app.route("/cockpit")
def dashboard_cockpit():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "cockpit"), "index.html")

@app.route("/cockpit-a")
def dashboard_cockpit_a():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "cockpit-a"), "index.html")

@app.route("/cockpit-b")
def dashboard_cockpit_b():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "cockpit-b"), "index.html")

@app.route("/production-a")
def dashboard_production_a():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "production-a"), "index.html")

@app.route("/production-b")
def dashboard_production_b():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "production-b"), "index.html")

@app.route("/utilization-a")
def dashboard_utilization_a():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "utilization-a"), "index.html")

@app.route("/utilization-b")
def dashboard_utilization_b():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "utilization-b"), "index.html")



@app.route("/cockpit-v1")
def dashboard_cockpit_v1():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "cockpit-v1"), "index.html")

@app.route("/cockpit-v2")
def dashboard_cockpit_v2():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "cockpit-v2"), "index.html")

@app.route("/cockpit-v3")
def dashboard_cockpit_v3():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "cockpit-v3"), "index.html")

@app.route("/cockpit-r2a")
def dashboard_cockpit_r2a():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "cockpit-r2a"), "index.html")


@app.route("/kpi-r2a")
def dashboard_kpi_r2a():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "kpi-r2a"), "index.html")

@app.route("/kpi-v1")
def dashboard_kpi_v1():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "kpi-v1"), "index.html")

@app.route("/kpi-v2")
def dashboard_kpi_v2():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "kpi-v2"), "index.html")

@app.route("/kpi-v3")
def dashboard_kpi_v3():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "kpi-v3"), "index.html")


@app.route("/quality-v1")
def dashboard_quality_v1():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "quality-v1"), "index.html")

@app.route("/quality-v2")
def dashboard_quality_v2():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "quality-v2"), "index.html")

@app.route("/quality-v3")
def dashboard_quality_v3():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "quality-v3"), "index.html")

@app.route("/quality-r2a")
def dashboard_quality_r2a():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "quality-r2a"), "index.html")


@app.route("/twin-v1")
def dashboard_twin_v1():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "twin-v1"), "index.html")

@app.route("/twin-v2")
def dashboard_twin_v2():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "twin-v2"), "index.html")

@app.route("/twin-v3")
def dashboard_twin_v3():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "twin-v3"), "index.html")

@app.route("/twin-r2a")
def dashboard_twin_r2a():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "twin-r2a"), "index.html")

@app.route("/dashboards/<path:path>")
def dashboard_files(path):
    return send_from_directory(DASHBOARD_DIR, path)


@app.route("/static/<path:path>")
def static_files(path):
    return send_from_directory("static", path)


@app.route("/api/data")
def api_data():
    """Return current state of all variables."""
    if hasattr(data_source, "current_state"):
        state = data_source.current_state()
        progress = data_source.get_progress() if hasattr(data_source, "get_progress") else 0
        return jsonify({
            "status": "connected",
            "mode": "live",
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
    if hasattr(data_source, "get_config"):
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
    info = {"mode": "live"}
    return jsonify(info)


@app.route("/api/switch-mode", methods=["POST"])
def api_switch_mode():
    """Switch between demo and live data source at runtime."""
    from flask import request
    global data_source, mode

    target = request.json.get("mode")

    if target == "demo":
        # Stop current source
        if data_source and hasattr(data_source, "stop"):
            data_source.stop()

        # Prefer SQLite, fall back to CSV
        db_path = find_db()
        if db_path:
            from demo_db_player import DemoDBPlayer
            data_source = DemoDBPlayer(db_path, speed=2.0, loop=True)
            data_source.start()
            mode = "live"
            return jsonify({"mode": mode, "source": "sqlite"})

        csv_path = find_csv()
        if not csv_path:
            return jsonify({"error": "No data source found for demo mode"}), 400
        from demo_player import DemoPlayer
        data_source = DemoPlayer(csv_path, speed=2.0, loop=True)
        data_source.start()
        mode = "live"
        return jsonify({"mode": mode, "source": "csv", "file": os.path.basename(csv_path)})

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
    """Lazy-load the factory database.

    Prefers local database.py (in dashboard dir) over tag 6 fallback.
    """
    global _factory_db
    if _factory_db is None:
        try:
            import sys
            # Prefer local database.py (same dir as server.py)
            local_dir = os.path.dirname(os.path.abspath(__file__))
            if local_dir not in sys.path:
                sys.path.insert(0, local_dir)
            try:
                from database import FactoryDB
            except ImportError:
                # Fallback: tag 6 database.py
                db_module = os.path.normpath(os.path.join(local_dir, "..", "..", "..", "tag 6"))
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


@app.route("/api/history/timeseries")
def api_history_timeseries():
    """Return time-series data for a variable (for trend charts).

    Query params: variable (required, supports LIKE %), station, since, until,
                  run_id, limit (default 500)
    Example: /api/history/timeseries?variable=iColorSensor_SL&limit=100
    """
    from flask import request
    db = _get_db()
    if db is None:
        return jsonify({"error": "SQLite database not available"}), 503

    variable = request.args.get("variable")
    if not variable:
        return jsonify({"error": "variable parameter required"}), 400

    rows = db.timeseries(
        variable=variable,
        station=request.args.get("station"),
        since=request.args.get("since"),
        until=request.args.get("until"),
        run_id=request.args.get("run_id"),
        limit=int(request.args.get("limit", 500)),
    )
    return jsonify(rows)


@app.route("/api/history/activity")
def api_history_activity():
    """Return recent actuator activity (state changes) for event log display.

    Query params: station, limit (default 50)
    Only returns actuator/motor/valve/lamp changes — filters out sensor noise.
    """
    from flask import request
    db = _get_db()
    if db is None:
        return jsonify({"error": "SQLite database not available"}), 503

    rows = db.activity(
        station=request.args.get("station"),
        limit=int(request.args.get("limit", 50)),
    )
    return jsonify(rows)


@app.route("/api/history/changes")
def api_history_changes():
    """Return last N state changes for a specific variable.

    Query params: variable (required), limit (default 20)
    Example: /api/history/changes?variable=bMotor_MS_Saw&limit=10
    """
    from flask import request
    db = _get_db()
    if db is None:
        return jsonify({"error": "SQLite database not available"}), 503

    variable = request.args.get("variable")
    if not variable:
        return jsonify({"error": "variable parameter required"}), 400

    rows = db.changes(
        variable=variable,
        limit=int(request.args.get("limit", 20)),
    )
    return jsonify(rows)


@app.route("/api/history/variables")
def api_history_variables():
    """Return all known variables grouped by station (for building queries)."""
    db = _get_db()
    if db is None:
        return jsonify({"error": "SQLite database not available"}), 503
    return jsonify(db.variables_list())


# ---------------------------------------------------------------------------
# Analytics API — computed KPIs from simulated data
# ---------------------------------------------------------------------------

@app.route("/api/analytics/cycle-times")
def api_cycle_times():
    import analytics
    return jsonify(analytics.get_cycle_times())


@app.route("/api/analytics/quality-grades")
def api_quality_grades():
    import analytics
    return jsonify(analytics.get_quality_grades())


@app.route("/api/analytics/temperature")
def api_temperature():
    import analytics
    return jsonify(analytics.get_temperature_curves())


@app.route("/api/analytics/oee")
def api_oee():
    import analytics
    return jsonify(analytics.get_oee())


@app.route("/api/analytics/throughput")
def api_throughput():
    import analytics
    return jsonify(analytics.get_throughput())


@app.route("/api/analytics/alerts")
def api_alerts():
    import analytics
    return jsonify(analytics.get_alerts())


@app.route("/api/analytics/timeline")
def api_timeline():
    import analytics
    return jsonify(analytics.get_station_timeline())


@app.route("/api/analytics/bottleneck")
def api_bottleneck():
    import analytics
    return jsonify(analytics.get_bottleneck())


@app.route("/api/analytics/spc")
def api_spc():
    import analytics
    return jsonify(analytics.get_spc_metrics())


@app.route("/api/analytics/drift")
def api_drift():
    import analytics
    return jsonify(analytics.get_drift_analysis())


@app.route("/api/analytics/summary")
def api_summary():
    import analytics
    return jsonify(analytics.get_summary())


def find_csv():
    """Auto-discover the best CSV — prefer simulated runs over raw sensor dumps."""
    base = os.path.dirname(os.path.abspath(__file__))
    cpp_root = os.path.normpath(os.path.join(base, "..", "..", ".."))

    # Priority 1: simulated runs (have actuator events, good for demo)
    simulated = sorted(
        glob.glob(os.path.join(cpp_root, "tag 6", "data", "simulated_run_*.csv")),
        key=os.path.getsize, reverse=True
    )
    if simulated:
        return simulated[0]

    # Priority 2: any CSV in data dirs (by size)
    search_paths = [
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


def find_db():
    """Find the factory SQLite database."""
    base = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(base, "data", "factory.db")
    if os.path.exists(db_path):
        return db_path
    return None


def main():
    global data_source, mode

    parser = argparse.ArgumentParser(description="Fischertechnik Glass Dashboard")
    parser.add_argument("--live", action="store_true", help="Live OPC UA mode")
    parser.add_argument("--demo-db", action="store_true", help="Force SQLite demo mode")
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
        # Fallback demo mode when not connected to OPC UA
        # Priority: --csv flag > --demo-db flag > auto-detect (DB first, then CSV)
        if args.csv:
            from demo_player import DemoPlayer
            data_source = DemoPlayer(args.csv, speed=args.speed, loop=True)
            data_source.start()
            print(f"\n  Fischertechnik Factory — Glass Dashboard")
            print(f"  Mode: DEMO (CSV replay at {args.speed}x)")
            print(f"  File: {os.path.basename(args.csv)} ({len(data_source._events)} events)")
            print(f"  http://localhost:{args.port}\n")

        else:
            # Try SQLite database first
            db_path = find_db()

            if args.demo_db and not db_path:
                print("No factory.db found in dashboard/data/")
                sys.exit(1)

            if db_path:
                from demo_db_player import DemoDBPlayer
                data_source = DemoDBPlayer(db_path, speed=args.speed, loop=True)
                data_source.start()
                print(f"\n  Fischertechnik Factory — Glass Dashboard")
                print(f"  Mode: DEMO (SQLite replay at {args.speed}x)")
                print(f"  Source: factory.db ({len(data_source._events)} events)")
                print(f"  http://localhost:{args.port}\n")
            else:
                csv_path = find_csv()
                if not csv_path:
                    print("No data source found for demo mode.")
                    print("Use --csv, --demo-db, or --live for OPC UA mode.")
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
