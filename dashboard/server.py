"""
Glassmorphism Dashboard Server for Fischertechnik Factory.

Serves the static frontend and provides a JSON API for live PLC data.
Open http://localhost:8050 in your browser.
"""

from flask import Flask, jsonify, send_from_directory
from opcua_client import PLCConnection
from config import VARIABLES, DASHBOARD_HOST, DASHBOARD_PORT

app = Flask(__name__, static_folder="static")
plc = PLCConnection()


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/static/<path:path>")
def static_files(path):
    return send_from_directory("static", path)


@app.route("/api/data")
def api_data():
    """Return current PLC data as JSON."""
    try:
        if not plc.is_connected:
            plc.connect()
        data = plc.read_all()
        return jsonify({"status": "connected", "data": data})
    except Exception as e:
        return jsonify({"status": "disconnected", "error": str(e), "data": {}})


@app.route("/api/config")
def api_config():
    """Return variable configuration for the frontend."""
    config = {}
    for station, groups in VARIABLES.items():
        config[station] = {}
        for group_name, vars_dict in groups.items():
            config[station][group_name] = {}
            for node_id, (label, var_type) in vars_dict.items():
                config[station][group_name][label] = var_type
    return jsonify(config)


if __name__ == "__main__":
    print(f"\n  Fischertechnik Factory — Glass Dashboard")
    print(f"  http://localhost:{DASHBOARD_PORT}\n")
    app.run(host=DASHBOARD_HOST, port=DASHBOARD_PORT, debug=False)
