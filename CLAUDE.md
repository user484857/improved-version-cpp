# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Real-time dashboard system for a **Fischertechnik learning factory** (TUM CPPS seminar). Two parts:
- **`FischertechnikAnlage/`** — TwinCAT 3 PLC project (Windows-only, Structured Text). Controls the physical factory.
- **`dashboard/`** — Python Flask server + vanilla JS frontends. Visualizes factory data via OPC UA or recorded replays.

## Running the Server

```bash
cd dashboard/
source venv/bin/activate    # Python 3.14 venv

python server.py                        # Demo mode (auto: SQLite DB → CSV fallback)
python server.py --live                 # Live OPC UA (PLC at 169.254.100.11:4840)
python server.py --demo-db              # Force SQLite replay
python server.py --csv data/file.csv    # Force CSV replay
python server.py --speed 2.0            # Replay speed multiplier
```

Server runs on **port 8050**. Dashboards at `http://localhost:8050/cockpit-a`, `/twin-a`, `/quality-a`, `/kpi-a`, etc.

## Architecture

### Data Flow
```
TwinCAT PLC ──OPC UA──→ opcua_client.py ──→ Flask /api/data ──→ Frontend (400ms polling)
                         OR
factory.db / CSV ──→ demo_db_player.py / demo_player.py ──→ Flask /api/data ──→ Frontend
```

Live and demo modes expose the same `current_state()` dict interface — dashboards don't know the difference.

### Backend Modules
| File | Role |
|------|------|
| `server.py` | Flask app, all routes, mode switching |
| `config.py` | OPC UA variable mapping (5 stations × sensors/actuators) |
| `database.py` | `FactoryDB` class — SQLite event storage and queries |
| `analytics.py` | KPI engine — cycle times, OEE, quality grades, bottleneck, SPC |
| `demo_player.py` | CSV replay engine (thread-based, real-time playback) |
| `demo_db_player.py` | SQLite replay engine (same interface as CSV player) |
| `opcua_client.py` | Live OPC UA connection to PLC |

### Frontend Structure
Each dashboard is a standalone `{index.html, app.js, style.css}` triple in `dashboard/dashboards/<name>/`. No build step, no frameworks — vanilla JS + Chart.js 4.4.7.

All dashboards import `dashboards/shared.css` — the centralized design system (glassmorphism, dark/light themes, iOS color palette).

Dashboard variants exist as `-a` and `-b` pairs: `cockpit-a/b`, `twin-a/b`, `quality-a/b`, `kpi-a/b`, `production-a/b`, `utilization-a/b`, `combined-a/b`.

## Factory Process Flow

Workpiece path through 5 stations (~60s per cycle):

```
HBW (retrieve) → Crane (pick & place) → MS (oven burning + sawing) → PM (punching) → SL (color sort) → Crane (return to HBW)
```

**Color is unknown until SL color measurement** — display as neutral/gray before that point.

## Key Conventions

### OPC UA Variables
Namespace 4, Hungarian notation: `ns=4;s=gvl_MS.bMotor_MS_Saw`
- `b` = BOOL, `i` = INT, `f` = REAL
- GVL-to-station mapping: `gvl_MS`→MS, `gvl_C`→Crane, `gvl_SL`→SL, `gvl_HBW`→HBW, `gvl_PM`→PM, `LocalVariables`→State

### Station Colors (iOS palette, used everywhere)
- MS: `#007AFF` (blue), Crane: `#30D158` (green), SL: `#FF9F0A` (orange)
- HBW: `#AF52DE` (purple), PM: `#FF453A` (red), State: `#5AC8FA` (cyan)

### Design Constraints (from user feedback)
- No donut/pie charts, no gauges, no yellow color schemes
- Use traffic-light indicators (green/yellow/red) for status
- Prefer stacked bar charts for breakdowns
- Animations should be subtle and satisfying (pulsing for active stations)
- Glassmorphism aesthetic with `backdrop-filter: blur(24px)`

## API Endpoints

- `/api/data` — current state of all ~87 variables
- `/api/config` — variable schema for dynamic rendering
- `/api/history`, `/api/history/timeseries`, `/api/history/activity` — event queries
- `/api/analytics/cycle-times`, `/oee`, `/quality-grades`, `/throughput`, `/bottleneck`, `/spc`, `/drift`, `/summary` — computed KPIs
- `/api/runs`, `/api/db-stats` — database metadata

## Dependencies

`dashboard/requirements.txt`: flask, pandas, plotly, pyads, dash (note: Dash/Plotly are listed but unused — dashboards use Chart.js). Actual runtime needs: `flask`, `pandas`, `opcua` (in venv).

## Related Files

- `AGENT_TEAM_PROMPT.md` — detailed multi-agent task breakdown with full factory process documentation
- `dashboard/FEEDBACK_ROUND1.md` — UX feedback from design review (what worked, what to avoid)
- `dashboard/dashboards/_archive/` — older dashboard versions (v1–v3)
