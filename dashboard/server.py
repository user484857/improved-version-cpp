"""
Fischertechnik Factory Dashboard Server.

Dual-mode:
  - /api/data      → Live OPC UA (if --live), else SQLite replay
  - /api/history/* → Always from SQLite (factory.db)
  - /api/analytics/* → Always from analytics engine

Usage:
  python server.py                  # Demo mode (SQLite replay)
  python server.py --live           # Live OPC UA from PLC
  python server.py --speed 3        # Replay at 3x speed
"""

import argparse
import os
import sys

from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder=None)

DASHBOARD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dashboards")

# Real-time data source (OPC UA client or DemoDBPlayer)
data_source = None


# ---------------------------------------------------------------------------
# Routes — only combined-a dashboard + generic file serving
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "combined-a"), "index.html")


@app.route("/combined-a")
def dashboard_combined_a():
    return send_from_directory(os.path.join(DASHBOARD_DIR, "combined-a"), "index.html")


@app.route("/dashboards/<path:path>")
def dashboard_files(path):
    return send_from_directory(DASHBOARD_DIR, path)


# ---------------------------------------------------------------------------
# Real-time data API
# ---------------------------------------------------------------------------

@app.route("/api/data")
def api_data():
    """Return current state of all variables.

    Source: OPC UA (live) or DemoDBPlayer (replay).
    """
    if data_source is None:
        return jsonify({"status": "disconnected", "mode": "demo", "data": {}}), 503

    # DemoDBPlayer / replay source
    if hasattr(data_source, "current_state"):
        state = data_source.current_state()
        return jsonify({"status": "connected", "mode": "demo", "data": state})

    # OPC UA live source
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
    if data_source and hasattr(data_source, "get_config"):
        return jsonify(data_source.get_config())

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
    is_live = data_source is not None and not hasattr(data_source, "current_state")
    return jsonify({
        "mode": "live" if is_live else "demo",
        "connected": data_source is not None,
    })


# ---------------------------------------------------------------------------
# History API — always from SQLite (factory.db)
# ---------------------------------------------------------------------------
_factory_db = None


def _get_db():
    """Lazy-load the factory database."""
    global _factory_db
    if _factory_db is None:
        try:
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
    """
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
    """
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
    """
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
    """Return all known variables grouped by station."""
    db = _get_db()
    if db is None:
        return jsonify({"error": "SQLite database not available"}), 503
    return jsonify(db.variables_list())


# ---------------------------------------------------------------------------
# Analytics API — computed KPIs
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


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

def _find_db():
    """Find the factory SQLite database."""
    base = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(base, "data", "factory.db")
    if os.path.exists(db_path):
        return db_path
    return None


def main():
    global data_source

    parser = argparse.ArgumentParser(description="Fischertechnik Factory Dashboard")
    parser.add_argument("--live", action="store_true", help="Live OPC UA mode (connect to PLC)")
    parser.add_argument("--speed", type=float, default=1.0, help="Replay speed multiplier (default: 1x)")
    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8050)
    args = parser.parse_args()

    print(f"\n  Fischertechnik Factory — Dashboard Server")

    if args.live:
        from opcua_client import PLCConnection
        data_source = PLCConnection()
        print(f"  Mode: LIVE (OPC UA)")
    else:
        db_path = _find_db()
        if db_path:
            from demo_db_player import DemoDBPlayer
            data_source = DemoDBPlayer(db_path, speed=args.speed, loop=True)
            data_source.start()
            print(f"  Mode: DEMO (SQLite replay at {args.speed}x)")
            print(f"  Source: factory.db ({len(data_source._events)} events)")
        else:
            print("  Mode: DEMO (no factory.db found — /api/data will be empty)")

    print(f"  http://localhost:{args.port}\n")
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
