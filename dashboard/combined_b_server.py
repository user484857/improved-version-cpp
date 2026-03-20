"""
Combined Dashboard B — Standalone Flask Server (port 8061)

Modes:
  - Demo (default): Replays factory.db events via DemoDBPlayer
  - Live: Reads from PLC via OPC UA (when available)

Analytics/history endpoints always read from factory.db.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DASH_DIR = os.path.join(BASE_DIR, "dashboards", "combined-b")
DASHBOARDS_DIR = os.path.join(BASE_DIR, "dashboards")
DB_PATH = os.path.join(BASE_DIR, "data", "factory.db")

data_source = None
mode = "demo"


def init_demo():
    global data_source, mode
    if not os.path.exists(DB_PATH):
        print(f"  WARNING: {DB_PATH} not found")
        return
    from demo_db_player import DemoDBPlayer
    data_source = DemoDBPlayer(DB_PATH, speed=2.0, loop=True)
    data_source.start()
    mode = "demo"
    print(f"  Demo: replaying {len(data_source._events)} events from factory.db")


# ── Page routes ──────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(DASH_DIR, "index.html")

@app.route("/dashboards/combined-b/<path:path>")
def dash_files(path):
    return send_from_directory(DASH_DIR, path)

@app.route("/dashboards/shared.css")
def shared_css():
    return send_from_directory(DASHBOARDS_DIR, "shared.css")


# ── Live data ────────────────────────────────────────────────

@app.route("/api/data")
def api_data():
    if data_source is None:
        return jsonify({"status": "no-source", "mode": mode, "data": {}})
    state = data_source.current_state()
    progress = data_source.get_progress()
    connected = data_source.is_connected if hasattr(data_source, "is_connected") else True
    resp = {
        "status": "connected" if connected else "disconnected",
        "mode": mode,
        "progress": progress,
        "data": state,
    }
    if hasattr(data_source, "last_error") and data_source.last_error:
        resp["error"] = data_source.last_error
    return jsonify(resp)

@app.route("/api/config")
def api_config():
    if data_source and hasattr(data_source, "get_config"):
        return jsonify(data_source.get_config())
    return jsonify({})

@app.route("/api/status")
def api_status():
    info = {"mode": mode}
    if mode == "demo" and data_source:
        info["source"] = "sqlite"
        info["progress"] = data_source.get_progress()
        info["events"] = len(data_source._events)
    return jsonify(info)

@app.route("/api/switch-mode", methods=["POST"])
def api_switch_mode():
    global data_source, mode
    target = request.json.get("mode")
    if target == "demo":
        if data_source and hasattr(data_source, "stop"):
            data_source.stop()
        init_demo()
        return jsonify({"mode": mode, "source": "sqlite"})
    elif target == "live":
        try:
            from live_plc_player import LivePLCPlayer
            if data_source and hasattr(data_source, "stop"):
                data_source.stop()
            data_source = LivePLCPlayer(poll_interval=0.5)
            data_source.start()
            mode = "live"
            return jsonify({"mode": mode, "source": "opcua"})
        except Exception as e:
            return jsonify({"error": f"Cannot connect to PLC: {e}"}), 500
    return jsonify({"error": "Invalid mode"}), 400


# ── Analytics API ────────────────────────────────────────────

@app.route("/api/analytics/cycle-times")
def api_ct():
    import analytics
    return jsonify(analytics.get_cycle_times())

@app.route("/api/analytics/quality-grades")
def api_qg():
    import analytics
    return jsonify(analytics.get_quality_grades())

@app.route("/api/analytics/throughput")
def api_tp():
    import analytics
    return jsonify(analytics.get_throughput())

@app.route("/api/analytics/oee")
def api_oee():
    import analytics
    return jsonify(analytics.get_oee())

@app.route("/api/analytics/summary")
def api_sum():
    import analytics
    return jsonify(analytics.get_summary())

@app.route("/api/analytics/bottleneck")
def api_bn():
    import analytics
    return jsonify(analytics.get_bottleneck())


# ── History / DB ─────────────────────────────────────────────

@app.route("/api/history/activity")
def api_activity():
    try:
        from database import FactoryDB
        db = FactoryDB()
        rows = db.activity(station=request.args.get("station"), limit=int(request.args.get("limit", 50)))
        return jsonify(rows)
    except Exception:
        return jsonify([])

@app.route("/api/db-stats")
def api_stats():
    try:
        from database import FactoryDB
        db = FactoryDB()
        return jsonify(db.stats())
    except Exception:
        return jsonify({"error": "DB not available"})


def init_live():
    global data_source, mode
    from live_plc_player import LivePLCPlayer
    data_source = LivePLCPlayer(poll_interval=0.5)
    data_source.start()
    mode = "live"
    print("  Live: OPC UA background polling started")


# ── Main ─────────────────────────────────────────────────────

if __name__ == "__main__":
    if "--live" in sys.argv:
        init_live()
    else:
        init_demo()
    print(f"\n  Combined Dashboard B — http://localhost:8061\n")
    app.run(host="0.0.0.0", port=8061, debug=False)
