"""
Real-time Dashboard for Fischertechnik Factory.

Reads PLC variables via OPC UA over LAN and displays them in a web dashboard.
Open http://localhost:8050 in your browser.
"""

import datetime
from collections import deque

import dash
from dash import html, dcc
from dash.dependencies import Input, Output
import plotly.graph_objs as go

from opcua_client import PLCConnection
from config import VARIABLES, DASHBOARD_HOST, DASHBOARD_PORT, UPDATE_INTERVAL_MS

# --- History buffer for time-series plots ---
MAX_HISTORY = 300  # ~2.5 min at 500ms interval
history = {
    "timestamps": deque(maxlen=MAX_HISTORY),
    "MS | Oven Lamp (Burn)": deque(maxlen=MAX_HISTORY),
    "MS | Saw": deque(maxlen=MAX_HISTORY),
    "MS | Compressor MS": deque(maxlen=MAX_HISTORY),
    "SL | Color Sensor": deque(maxlen=MAX_HISTORY),
    "State | MS Process Step": deque(maxlen=MAX_HISTORY),
}

# --- PLC Connection ---
plc = PLCConnection()

# --- Dash App ---
app = dash.Dash(__name__)
app.title = "Fischertechnik Factory Dashboard"

# Color scheme
COLORS = {
    "bg": "#1a1a2e",
    "card": "#16213e",
    "accent": "#0f3460",
    "text": "#e0e0e0",
    "on": "#00e676",
    "off": "#455a64",
    "error": "#ff5252",
}


def make_station_card(station_name: str, groups: dict):
    """Create a dashboard card for one station."""
    children = [html.H3(station_name, style={"color": "#64b5f6", "marginBottom": "10px"})]

    for group_name, vars_dict in groups.items():
        children.append(html.H4(group_name.capitalize(), style={"color": "#90a4ae", "fontSize": "12px", "marginTop": "8px"}))
        for symbol, (label, var_type) in vars_dict.items():
            indicator_id = f"ind-{station_name}-{label}".replace(" ", "-").replace("|", "")
            children.append(
                html.Div(
                    [
                        html.Span("●", id=indicator_id, style={
                            "color": COLORS["off"],
                            "fontSize": "16px",
                            "marginRight": "8px",
                        }),
                        html.Span(label, style={"color": COLORS["text"], "fontSize": "13px"}),
                        html.Span("--", id=f"val-{indicator_id}", style={
                            "color": COLORS["text"],
                            "fontSize": "13px",
                            "marginLeft": "auto",
                            "fontFamily": "monospace",
                        }),
                    ],
                    style={"display": "flex", "alignItems": "center", "padding": "2px 0"},
                )
            )

    return html.Div(
        children,
        style={
            "backgroundColor": COLORS["card"],
            "borderRadius": "8px",
            "padding": "15px",
            "margin": "8px",
            "minWidth": "280px",
            "flex": "1",
        },
    )


def build_layout():
    station_cards = []
    for station_name, groups in VARIABLES.items():
        station_cards.append(make_station_card(station_name, groups))

    return html.Div(
        [
            # Header
            html.Div(
                [
                    html.H1("Fischertechnik Factory — Live Dashboard", style={"margin": "0", "color": "#64b5f6"}),
                    html.Div(id="connection-status", style={"color": COLORS["on"], "fontSize": "14px"}),
                    html.Div(id="last-update", style={"color": "#90a4ae", "fontSize": "12px"}),
                ],
                style={"padding": "15px 25px", "backgroundColor": COLORS["accent"]},
            ),

            # Station cards
            html.Div(
                station_cards,
                style={"display": "flex", "flexWrap": "wrap", "padding": "10px"},
            ),

            # Time-series graph
            html.Div(
                [
                    html.H3("Process Timeline", style={"color": "#64b5f6", "marginBottom": "10px"}),
                    dcc.Graph(id="timeline-graph", style={"height": "300px"}),
                ],
                style={
                    "backgroundColor": COLORS["card"],
                    "borderRadius": "8px",
                    "padding": "15px",
                    "margin": "8px",
                },
            ),

            # Auto-refresh interval
            dcc.Interval(id="interval", interval=UPDATE_INTERVAL_MS, n_intervals=0),

            # Hidden data store
            dcc.Store(id="plc-data"),
        ],
        style={"backgroundColor": COLORS["bg"], "minHeight": "100vh", "fontFamily": "Segoe UI, sans-serif"},
    )


app.layout = build_layout()


# --- Collect all indicator IDs ---
all_outputs = []
for station_name, groups in VARIABLES.items():
    for group_name, vars_dict in groups.items():
        for symbol, (label, var_type) in vars_dict.items():
            indicator_id = f"ind-{station_name}-{label}".replace(" ", "-").replace("|", "")
            all_outputs.append(Output(indicator_id, "style"))
            all_outputs.append(Output(f"val-{indicator_id}", "children"))


@app.callback(
    [
        Output("connection-status", "children"),
        Output("last-update", "children"),
        Output("timeline-graph", "figure"),
    ] + all_outputs,
    [Input("interval", "n_intervals")],
)
def update_dashboard(n):
    now = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]

    # Read PLC data
    try:
        if not plc.is_connected:
            plc.connect()
        data = plc.read_all()
        conn_status = f"● Connected to PLC"
    except Exception as e:
        conn_status = f"● Disconnected: {e}"
        data = {}

    # Build indicator outputs
    indicator_outputs = []
    for station_name, groups in VARIABLES.items():
        for group_name, vars_dict in groups.items():
            for symbol, (label, var_type) in vars_dict.items():
                # Get value from read data
                value = None
                if station_name in data and group_name in data[station_name]:
                    value = data[station_name][group_name].get(label)

                # Indicator color
                if value is None or isinstance(value, str):
                    color = COLORS["error"]
                    display_val = "ERR"
                elif var_type == "bool":
                    color = COLORS["on"] if value else COLORS["off"]
                    display_val = "ON" if value else "OFF"
                else:
                    color = COLORS["text"]
                    display_val = str(value)

                indicator_outputs.append({"color": color, "fontSize": "16px", "marginRight": "8px"})
                indicator_outputs.append(display_val)

    # Update history for timeline
    history["timestamps"].append(now)
    for key in history:
        if key == "timestamps":
            continue
        station, label = key.split(" | ", 1)
        value = None
        if station in data:
            for group in data[station].values():
                if label in group:
                    value = group[label]
                    break
        if isinstance(value, bool):
            value = int(value)
        history[key].append(value if value is not None else 0)

    # Build timeline figure
    fig = go.Figure()
    colors = ["#00e676", "#ff9800", "#2196f3", "#e91e63", "#9c27b0"]
    for i, (key, values) in enumerate(history.items()):
        if key == "timestamps":
            continue
        fig.add_trace(go.Scatter(
            x=list(history["timestamps"]),
            y=list(values),
            mode="lines",
            name=key,
            line=dict(color=colors[i % len(colors)], width=2),
        ))
    fig.update_layout(
        plot_bgcolor=COLORS["bg"],
        paper_bgcolor=COLORS["card"],
        font_color=COLORS["text"],
        margin=dict(l=40, r=20, t=10, b=30),
        legend=dict(orientation="h", y=-0.2),
        xaxis=dict(showgrid=False),
        yaxis=dict(showgrid=True, gridcolor="#263238"),
    )

    return [conn_status, f"Last update: {now}", fig] + indicator_outputs


if __name__ == "__main__":
    print(f"\n{'='*60}")
    print(f"  Fischertechnik Factory Dashboard")
    print(f"  Open http://localhost:{DASHBOARD_PORT} in your browser")
    print(f"{'='*60}\n")
    app.run(host=DASHBOARD_HOST, port=DASHBOARD_PORT, debug=False)
