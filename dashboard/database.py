"""
SQLite storage for factory event data.

All data collection is event-based — OPC UA subscriptions and polling
write directly to this database.

Usage:
    from database import FactoryDB

    db = FactoryDB()                          # default: dashboard/data/factory.db
    db.insert("2026-03-19 17:35:35.998", "gvl_MS", "bMotor_MS_Saw", True, "poll")
    db.insert_batch([...])                    # bulk insert

    # Query
    rows = db.query(station="Crane", limit=100)
    rows = db.query(variable="bMotor%", since="2026-03-19 17:30:00")
    runs = db.list_runs()
"""

import os
import sqlite3
from datetime import datetime


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data")
DEFAULT_DB_PATH = os.path.join(DATA_DIR, "factory.db")

# GVL → station mapping
GVL_TO_STATION = {
    "gvl_MS": "MS",
    "gvl_C": "Crane",
    "gvl_SL": "SL",
    "gvl_HBW": "HBW",
    "gvl_PM": "PM",
    "LocalVariables": "State",
}


class FactoryDB:
    def __init__(self, db_path=None):
        self.db_path = db_path or DEFAULT_DB_PATH
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=DELETE")  # single portable file
        self._create_tables()

    def _create_tables(self):
        self._conn.executescript("""
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
            CREATE INDEX IF NOT EXISTS idx_events_station ON events(station);
            CREATE INDEX IF NOT EXISTS idx_events_variable ON events(variable);
            CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);

            CREATE TABLE IF NOT EXISTS runs (
                run_id TEXT PRIMARY KEY,
                started_at TEXT,
                ended_at TEXT,
                event_count INTEGER DEFAULT 0
            );
        """)
        self._conn.commit()

    def _resolve_station(self, gvl):
        return GVL_TO_STATION.get(gvl, gvl)

    def insert(self, timestamp, gvl, variable, value, source="poll", run_id=None):
        station = self._resolve_station(gvl)
        self._conn.execute(
            "INSERT INTO events (timestamp, gvl, variable, value, source, station, run_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (timestamp, gvl, variable, str(value), source, station, run_id),
        )

    def insert_batch(self, rows, run_id=None, commit=True):
        """Insert multiple rows efficiently. Each row: (timestamp, gvl, variable, value, source)."""
        data = [
            (ts, gvl, var, str(val), src, self._resolve_station(gvl), run_id)
            for ts, gvl, var, val, src in rows
        ]
        self._conn.executemany(
            "INSERT INTO events (timestamp, gvl, variable, value, source, station, run_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            data,
        )
        if commit:
            self._conn.commit()

    def commit(self):
        self._conn.commit()

    def register_run(self, run_id):
        """Register a new data collection run."""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._conn.execute(
            "INSERT OR IGNORE INTO runs (run_id, started_at) VALUES (?, ?)",
            (run_id, now),
        )
        self._conn.commit()

    def finish_run(self, run_id):
        """Mark a run as finished and update event count."""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        count = self._conn.execute(
            "SELECT COUNT(*) FROM events WHERE run_id = ?", (run_id,)
        ).fetchone()[0]
        self._conn.execute(
            "UPDATE runs SET ended_at = ?, event_count = ? WHERE run_id = ?",
            (now, count, run_id),
        )
        self._conn.commit()

    def query(self, station=None, variable=None, since=None, until=None,
              run_id=None, limit=1000):
        """Query events with optional filters. Variable supports LIKE patterns (%)."""
        sql = "SELECT timestamp, gvl, variable, value, source, station, run_id FROM events WHERE 1=1"
        params = []

        if station:
            sql += " AND station = ?"
            params.append(station)
        if variable:
            sql += " AND variable LIKE ?"
            params.append(variable)
        if since:
            sql += " AND timestamp >= ?"
            params.append(since)
        if until:
            sql += " AND timestamp <= ?"
            params.append(until)
        if run_id:
            sql += " AND run_id = ?"
            params.append(run_id)

        sql += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)

        return [dict(row) for row in self._conn.execute(sql, params).fetchall()]

    def list_runs(self):
        """List all recorded runs."""
        return [
            dict(row)
            for row in self._conn.execute(
                "SELECT * FROM runs ORDER BY started_at DESC"
            ).fetchall()
        ]

    def timeseries(self, variable, station=None, since=None, until=None,
                   run_id=None, limit=500):
        """Return time-series data for a variable (for trend charts).

        Returns list of {timestamp, value} sorted chronologically.
        """
        sql = ("SELECT timestamp, value FROM events "
               "WHERE variable LIKE ?")
        params = [variable]

        if station:
            sql += " AND station = ?"
            params.append(station)
        if since:
            sql += " AND timestamp >= ?"
            params.append(since)
        if until:
            sql += " AND timestamp <= ?"
            params.append(until)
        if run_id:
            sql += " AND run_id = ?"
            params.append(run_id)

        sql += " ORDER BY timestamp ASC LIMIT ?"
        params.append(limit)

        rows = self._conn.execute(sql, params).fetchall()
        result = []
        for row in rows:
            val_raw = row["value"]
            # Try to parse numeric values for charting
            if val_raw in ("True", "true"):
                val = 1
            elif val_raw in ("False", "false"):
                val = 0
            else:
                try:
                    val = float(val_raw)
                except (ValueError, TypeError):
                    val = val_raw
            result.append({"timestamp": row["timestamp"], "value": val})
        return result

    def activity(self, station=None, limit=50):
        """Return recent station activity summary — state changes grouped by time.

        Returns list of {timestamp, station, variable, value, source}.
        Only includes actuator/motor/valve/lamp changes (not sensor noise).
        """
        sql = ("SELECT timestamp, station, variable, value, source FROM events "
               "WHERE (variable LIKE 'bMotor_%' OR variable LIKE 'bValve_%' "
               "OR variable LIKE 'bLamp_%' OR variable LIKE 'bCompressor_%')")
        params = []

        if station:
            sql += " AND station = ?"
            params.append(station)

        sql += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)

        return [dict(row) for row in self._conn.execute(sql, params).fetchall()]

    def changes(self, variable, limit=20):
        """Return last N state changes for a specific variable.

        Returns list of {timestamp, value, source, station} sorted newest first.
        """
        sql = ("SELECT timestamp, value, source, station FROM events "
               "WHERE variable = ? ORDER BY timestamp DESC LIMIT ?")
        rows = self._conn.execute(sql, (variable, limit)).fetchall()
        return [dict(row) for row in rows]

    def variables_list(self):
        """Return all known variable names grouped by station."""
        rows = self._conn.execute(
            "SELECT station, variable, COUNT(*) as cnt "
            "FROM events GROUP BY station, variable ORDER BY station, variable"
        ).fetchall()
        result = {}
        for row in rows:
            st = row["station"]
            if st not in result:
                result[st] = []
            result[st].append({"variable": row["variable"], "count": row["cnt"]})
        return result

    def stats(self):
        """Return summary statistics."""
        total = self._conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        runs = self._conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
        stations = self._conn.execute(
            "SELECT station, COUNT(*) as cnt FROM events GROUP BY station ORDER BY cnt DESC"
        ).fetchall()
        first_ts = self._conn.execute(
            "SELECT MIN(timestamp) FROM events"
        ).fetchone()[0]
        last_ts = self._conn.execute(
            "SELECT MAX(timestamp) FROM events"
        ).fetchone()[0]
        return {
            "total_events": total,
            "total_runs": runs,
            "by_station": {row["station"]: row["cnt"] for row in stations},
            "first_event": first_ts,
            "last_event": last_ts,
        }

    def close(self):
        self._conn.close()


if __name__ == "__main__":
    import sys

    if "--stats" in sys.argv:
        db = FactoryDB()
        s = db.stats()
        print(f"Total events: {s['total_events']}")
        print(f"Total runs:   {s['total_runs']}")
        print(f"By station:   {s['by_station']}")
        for run in db.list_runs():
            print(f"  {run['run_id']}: {run['event_count']} events "
                  f"({run['started_at']} → {run['ended_at'] or 'ongoing'})")
    elif "--query" in sys.argv:
        db = FactoryDB()
        # Example: python database.py --query --station Crane --limit 20
        station = None
        variable = None
        limit = 20
        for i, arg in enumerate(sys.argv):
            if arg == "--station" and i + 1 < len(sys.argv):
                station = sys.argv[i + 1]
            if arg == "--variable" and i + 1 < len(sys.argv):
                variable = sys.argv[i + 1]
            if arg == "--limit" and i + 1 < len(sys.argv):
                limit = int(sys.argv[i + 1])
        rows = db.query(station=station, variable=variable, limit=limit)
        for r in rows:
            print(f"  {r['timestamp']} | {r['station']:6} | {r['variable']:40} | {r['value']}")
    else:
        # Default: show stats + all variables by station
        db = FactoryDB()
        s = db.stats()
        print(f"Total events: {s['total_events']}")
        print(f"Total runs:   {s['total_runs']}")
        print(f"By station:   {s['by_station']}")
        print()
        for run in db.list_runs():
            print(f"  {run['run_id']}: {run['event_count']} events "
                  f"({run['started_at']} → {run['ended_at'] or 'ongoing'})")
        print()
        # All variables grouped by station
        rows = db._conn.execute(
            "SELECT station, variable, COUNT(*) as cnt, "
            "MIN(timestamp) as first_seen, MAX(timestamp) as last_seen "
            "FROM events GROUP BY station, variable ORDER BY station, variable"
        ).fetchall()
        current_station = None
        for r in rows:
            if r["station"] != current_station:
                current_station = r["station"]
                print(f"\n── {current_station} ──")
            print(f"  {r['variable']:45} {r['cnt']:>6} events  ({r['first_seen']} → {r['last_seen']})")
