"""
Factory Analytics Engine.

Parses simulated/real CSV data and computes:
- Cycle times per station per run
- Sub-step breakdown for MS (Machining Station)
- OEE (Availability x Performance x Quality)
- Quality grades from color sensor
- Temperature curves from oven burn times
- Anomaly detection
- Throughput metrics
"""

import csv
import math
import os
import glob
from datetime import datetime, timedelta


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TAG6_DATA = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "..", "..", "tag 6", "data"))

GVL_TO_STATION = {
    "gvl_MS": "MS",
    "gvl_C": "Crane",
    "gvl_SL": "SL",
    "gvl_HBW": "HBW",
    "gvl_PM": "PM",
    "LocalVariables": "State",
}

ACTUATOR_PREFIXES = ("bMotor_", "bValve_", "bLamp_", "bCompressor_")
COLOR_RANGES = {"A": (250, 300), "B": (130, 190), "C": (40, 60)}
STATION_ORDER = ["HBW", "Crane", "MS", "PM", "SL"]

# Theoretical cycle times (seconds) from simulator
THEORETICAL_CYCLE = {"HBW": 12.0, "Crane": 12.0, "MS": 18.0, "PM": 5.0, "SL": 6.0}


def parse_ts(ts_str):
    return datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S.%f")


def ts_to_epoch(ts_str):
    return parse_ts(ts_str).timestamp()


def find_simulated_csv():
    """Find the largest simulated CSV in tag 6 data dir."""
    pattern = os.path.join(TAG6_DATA, "simulated_run_*.csv")
    files = glob.glob(pattern)
    if not files:
        return None
    return max(files, key=os.path.getsize)


def load_events(csv_path=None):
    """Load events from CSV, return list of dicts."""
    if csv_path is None:
        csv_path = find_simulated_csv()
    if not csv_path or not os.path.exists(csv_path):
        return []

    events = []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            station = GVL_TO_STATION.get(row["gvl"], row["gvl"])
            val_raw = row["value"]
            if val_raw == "True":
                value = True
            elif val_raw == "False":
                value = False
            else:
                try:
                    value = int(val_raw)
                except ValueError:
                    try:
                        value = float(val_raw)
                    except ValueError:
                        value = val_raw

            events.append({
                "timestamp": row["timestamp"],
                "ts": parse_ts(row["timestamp"]),
                "gvl": row["gvl"],
                "variable": row["variable"],
                "value": value,
                "station": station,
            })
    return events


def is_actuator(variable):
    return any(variable.startswith(p) for p in ACTUATOR_PREFIXES)


def split_into_runs(events):
    """Split event stream into production runs using HBW start marker.

    Each run starts when bMotor_HBW_StackerCrane_torack becomes True.
    """
    if not events:
        return []

    runs = []
    current_run = []

    for e in events:
        if e["variable"] == "bMotor_HBW_StackerCrane_torack" and e["value"] is True:
            if current_run:
                runs.append(current_run)
            current_run = []
        current_run.append(e)

    if current_run:
        runs.append(current_run)

    return runs


def compute_station_cycle_time(run_events, station):
    """Compute cycle time for a station within a run."""
    station_events = [e for e in run_events if e["station"] == station]
    if not station_events:
        return None

    actuator_events = [e for e in station_events if is_actuator(e["variable"])]
    if not actuator_events:
        return None

    first_ts = actuator_events[0]["ts"]
    last_ts = actuator_events[-1]["ts"]
    return (last_ts - first_ts).total_seconds()


def compute_ms_substeps(run_events):
    """Compute sub-step timings within MS (Machining Station)."""
    ms_events = [e for e in run_events if e["station"] == "MS"]
    if not ms_events:
        return None

    def find_event(var, val=True):
        for e in ms_events:
            if e["variable"] == var and e["value"] == val:
                return e["ts"]
        return None

    def find_event_after(var, val, after_ts):
        for e in ms_events:
            if e["variable"] == var and e["value"] == val and e["ts"] >= after_ts:
                return e["ts"]
        return None

    conveyor_start = find_event("bMotor_MS_ConveyorBelt_forward", True)
    conveyor_end = find_event("bMotor_MS_ConveyorBelt_forward", False)

    turntable_start = find_event("bMotor_MS_Turntable_clockwise", True)
    transfer_start = find_event("bMotor_MS_TransferUnit_tooven", True)
    transfer_at_oven = find_event("bReferenceSwitch_MS_TransferUnit_atoven", True)

    burn_start = find_event("bLamp_MS", True)
    burn_end = find_event("bLamp_MS", False)

    saw_start = find_event("bMotor_MS_Saw", True)
    saw_end = find_event("bMotor_MS_Saw", False)

    ejector_start = find_event("bValve_MS_Ejector", True)
    ejector_end = find_event("bValve_MS_Ejector", False)

    steps = {}
    if conveyor_start and conveyor_end:
        steps["conveyor"] = (conveyor_end - conveyor_start).total_seconds()
    if turntable_start and transfer_at_oven:
        steps["transfer_to_oven"] = (transfer_at_oven - turntable_start).total_seconds()
    if burn_start and burn_end:
        steps["burn"] = (burn_end - burn_start).total_seconds()
    if saw_start and saw_end:
        steps["saw"] = (saw_end - saw_start).total_seconds()
    if ejector_start and ejector_end:
        steps["eject"] = (ejector_end - ejector_start).total_seconds()

    # Oven loading (slider in/out)
    slider_in_start = find_event("bMotor_MS_OvenSlider_movein", True)
    slider_in_end = find_event("bReferenceSwitch_MS_OvenSlider_inside", True)
    if slider_in_start and slider_in_end:
        steps["oven_load"] = (slider_in_end - slider_in_start).total_seconds()

    slider_out_start = find_event("bMotor_MS_OvenSlider_moveout", True)
    slider_out_end = find_event("bReferenceSwitch_MS_OvenSlider_outside", True)
    if slider_out_start and slider_out_end:
        steps["oven_unload"] = (slider_out_end - slider_out_start).total_seconds()

    # Transfer back
    transfer_back_start = find_event("bMotor_MS_TransferUnit_toturntable", True)
    transfer_back_end = find_event("bReferenceSwitch_MS_TransferUnit_atturntable", True)
    if transfer_back_start and transfer_back_end:
        steps["transfer_back"] = (transfer_back_end - transfer_back_start).total_seconds()

    # Turntable to saw
    tt_saw_start = find_event("bMotor_MS_Turntable_counterclockwise", True)
    tt_saw_end = find_event("bReferenceSwitch_MS_Turntable_atsaw", True)
    if tt_saw_start and tt_saw_end:
        steps["turntable_to_saw"] = (tt_saw_end - tt_saw_start).total_seconds()

    return steps


def extract_color_reading(run_events):
    """Extract color sensor reading from a run."""
    for e in run_events:
        if e["variable"] == "iColorSensor_SL" and isinstance(e["value"], int) and e["value"] > 10:
            return e["value"]
    return None


def grade_from_color(color_value):
    if color_value is None:
        return None
    if 250 <= color_value <= 300:
        return "A"
    elif 130 <= color_value <= 190:
        return "B"
    elif 40 <= color_value <= 60:
        return "C"
    return "unknown"


def color_name_from_grade(grade):
    return {"A": "white", "B": "red", "C": "blue"}.get(grade, "unknown")


def compute_temperature_curve(burn_time, t_ambient=25.0, t_target=180.0, tau=1.5, dt=0.1):
    """Newton's heating law: T(t) = T_amb + (T_target - T_amb) * (1 - e^(-t/tau))."""
    if burn_time is None or burn_time <= 0:
        return [], [], t_ambient

    times = []
    temps = []
    t = 0.0
    peak = t_ambient
    while t <= burn_time + 0.05:
        temp = t_ambient + (t_target - t_ambient) * (1 - math.exp(-t / tau))
        times.append(round(t, 2))
        temps.append(round(temp, 1))
        if temp > peak:
            peak = temp
        t += dt

    return times, temps, round(peak, 1)


# ---- Main analytics functions ----

_cache = {}


def _get_events():
    csv_path = find_simulated_csv()
    cache_key = csv_path or "none"
    if cache_key not in _cache:
        _cache[cache_key] = load_events(csv_path)
    return _cache[cache_key]


def _get_runs():
    if "runs" not in _cache:
        events = _get_events()
        _cache["runs"] = split_into_runs(events)
    return _cache["runs"]


def invalidate_cache():
    _cache.clear()


def get_cycle_times():
    """Return cycle times per station per run."""
    runs = _get_runs()
    results = []
    for i, run_events in enumerate(runs):
        run_data = {"run": i + 1, "stations": {}}
        for station in STATION_ORDER:
            ct = compute_station_cycle_time(run_events, station)
            run_data["stations"][station] = round(ct, 2) if ct else None

        # MS sub-steps
        substeps = compute_ms_substeps(run_events)
        if substeps:
            run_data["ms_substeps"] = {k: round(v, 2) for k, v in substeps.items()}

        # Total cycle time (first event to last event)
        if run_events:
            total = (run_events[-1]["ts"] - run_events[0]["ts"]).total_seconds()
            run_data["total"] = round(total, 2)

        run_data["timestamp"] = run_events[0]["timestamp"] if run_events else None
        results.append(run_data)

    return results


def get_quality_grades():
    """Return quality grading data per run."""
    runs = _get_runs()
    results = []
    for i, run_events in enumerate(runs):
        color_val = extract_color_reading(run_events)
        grade = grade_from_color(color_val)
        color_name = color_name_from_grade(grade)

        # Get burn time from MS sub-steps
        substeps = compute_ms_substeps(run_events)
        burn_time = substeps.get("burn") if substeps else None

        # Temperature curve
        t_times, t_temps, peak_temp = compute_temperature_curve(burn_time)

        results.append({
            "run": i + 1,
            "color_value": color_val,
            "grade": grade,
            "color_name": color_name,
            "burn_time": round(burn_time, 2) if burn_time else None,
            "peak_temp": peak_temp,
            "timestamp": run_events[0]["timestamp"] if run_events else None,
        })

    return results


def get_temperature_curves():
    """Return temperature curve data for each run."""
    runs = _get_runs()
    results = []
    for i, run_events in enumerate(runs):
        substeps = compute_ms_substeps(run_events)
        burn_time = substeps.get("burn") if substeps else None
        t_times, t_temps, peak_temp = compute_temperature_curve(burn_time)
        results.append({
            "run": i + 1,
            "burn_time": round(burn_time, 2) if burn_time else None,
            "t": t_times,
            "T": t_temps,
            "peak": peak_temp,
        })
    return results


def get_oee():
    """Compute simplified OEE."""
    runs = _get_runs()
    events = _get_events()
    if not events or not runs:
        return {"availability": 0, "performance": 0, "quality": 0, "oee": 0}

    # Total time span
    total_time = (events[-1]["ts"] - events[0]["ts"]).total_seconds()
    if total_time <= 0:
        return {"availability": 0, "performance": 0, "quality": 0, "oee": 0}

    # Active time = sum of all run durations
    active_time = 0
    for run_events in runs:
        if run_events:
            active_time += (run_events[-1]["ts"] - run_events[0]["ts"]).total_seconds()

    availability = min(active_time / total_time, 1.0) if total_time > 0 else 0

    # Performance = theoretical total cycle time / actual active time
    theoretical_per_run = sum(THEORETICAL_CYCLE.values())
    theoretical_total = theoretical_per_run * len(runs)
    performance = min(theoretical_total / active_time, 1.0) if active_time > 0 else 0

    # Quality = Grade A count / total
    grades = get_quality_grades()
    grade_a = sum(1 for g in grades if g["grade"] == "A")
    quality = grade_a / len(grades) if grades else 0

    oee = availability * performance * quality

    return {
        "availability": round(availability, 3),
        "performance": round(performance, 3),
        "quality": round(quality, 3),
        "oee": round(oee, 3),
        "total_runs": len(runs),
        "grade_a_count": grade_a,
        "total_time_s": round(total_time, 1),
        "active_time_s": round(active_time, 1),
    }


def get_throughput():
    """Compute throughput metrics."""
    runs = _get_runs()
    events = _get_events()
    if not events or not runs:
        return {"per_hour": 0, "theoretical_max": 0, "utilization": 0}

    total_time = (events[-1]["ts"] - events[0]["ts"]).total_seconds()
    total_hours = total_time / 3600.0 if total_time > 0 else 1

    per_hour = len(runs) / total_hours
    theoretical_run_time = sum(THEORETICAL_CYCLE.values())
    theoretical_max = 3600.0 / theoretical_run_time if theoretical_run_time > 0 else 0
    utilization = per_hour / theoretical_max if theoretical_max > 0 else 0

    # Cumulative production
    cumulative = []
    for i, run_events in enumerate(runs):
        if run_events:
            cumulative.append({
                "run": i + 1,
                "timestamp": run_events[-1]["timestamp"],
                "count": i + 1,
            })

    return {
        "per_hour": round(per_hour, 1),
        "theoretical_max": round(theoretical_max, 1),
        "utilization": round(utilization, 3),
        "total_runs": len(runs),
        "total_time_min": round(total_time / 60, 1),
        "cumulative": cumulative,
    }


def get_alerts():
    """Detect anomalies and generate diverse alerts.

    Alert types:
    1. Cycle time — station exceeds theoretical by >15%
    2. Quality drift — Grade C rate above 30%
    3. Temperature / burn anomaly — burn time deviates from mean
    4. OEE — below warning/error thresholds
    5. Idle time — unusually long gap between runs
    6. Color sensor drift — reading outside expected ranges
    """
    cycle_data = get_cycle_times()
    grades = get_quality_grades()
    oee = get_oee()
    alerts = []

    # Theoretical cycle times with 15% tolerance
    THEO = {"HBW": 10.0, "Crane": 12.0, "MS": 18.0, "PM": 4.0, "SL": 5.0}

    # ---- 1. Cycle time alerts (per station, 15% threshold) ----
    for run_data in cycle_data:
        for station in STATION_ORDER:
            ct = run_data["stations"].get(station)
            if ct is None:
                continue
            theo = THEO.get(station, 999)
            if ct > theo * 1.15:
                pct = ((ct / theo) - 1) * 100
                sev = "error" if pct > 50 else "warning"
                alerts.append({
                    "type": "cycle_time",
                    "severity": sev,
                    "station": station,
                    "run": run_data["run"],
                    "message": f"{station} took {ct:.1f}s (theoretical: {theo:.0f}s, +{pct:.0f}%)",
                    "timestamp": run_data.get("timestamp"),
                })

    # ---- 2. Quality alerts (Grade C rate) ----
    if grades:
        total = len(grades)
        c_count = sum(1 for g in grades if g["grade"] == "C")
        c_rate = c_count / total if total > 0 else 0
        if c_rate > 0.30:
            last_c = next(
                (g for g in reversed(grades) if g["grade"] == "C"), grades[-1]
            )
            alerts.append({
                "type": "quality_drift",
                "severity": "error" if c_rate > 0.50 else "warning",
                "station": "SL",
                "run": last_c["run"],
                "message": f"Quality drift: Grade C rate at {c_rate * 100:.0f}% (threshold: 30%)",
                "timestamp": last_c.get("timestamp"),
            })

    # ---- 3. Temperature / burn-time anomaly ----
    burn_times = [g["burn_time"] for g in grades if g.get("burn_time")]
    if len(burn_times) >= 3:
        bt_mean = sum(burn_times) / len(burn_times)
        bt_sd = (sum((b - bt_mean) ** 2 for b in burn_times) / len(burn_times)) ** 0.5
        for g in grades:
            bt = g.get("burn_time")
            if bt is not None and bt_sd > 0 and abs(bt - bt_mean) > 2 * bt_sd:
                alerts.append({
                    "type": "temperature_anomaly",
                    "severity": "warning",
                    "station": "MS",
                    "run": g["run"],
                    "message": f"Climate chamber duration anomaly: Run #{g['run']} at {bt:.1f}s (mean: {bt_mean:.1f}s)",
                    "timestamp": g.get("timestamp"),
                })

    # ---- 4. OEE alerts ----
    oee_val = oee.get("oee", 1.0)
    if oee_val < 0.50:
        sev = "error" if oee_val < 0.30 else "warning"
        last_ts = cycle_data[-1].get("timestamp") if cycle_data else None
        last_run = cycle_data[-1]["run"] if cycle_data else 0
        alerts.append({
            "type": "oee_low",
            "severity": sev,
            "station": "Factory",
            "run": last_run,
            "message": f"OEE at {oee_val * 100:.1f}% — {'critical' if oee_val < 0.30 else 'below target'} (threshold: {'30%' if oee_val < 0.30 else '50%'})",
            "timestamp": last_ts,
        })

    # ---- 5. Idle time alerts (gaps between runs) ----
    if len(cycle_data) >= 2:
        gaps = []
        for i in range(1, len(cycle_data)):
            ts_prev = cycle_data[i - 1].get("timestamp")
            ts_curr = cycle_data[i].get("timestamp")
            total_prev = cycle_data[i - 1].get("total", 0)
            if ts_prev and ts_curr:
                try:
                    end_prev = parse_ts(ts_prev).timestamp() + total_prev
                    start_curr = parse_ts(ts_curr).timestamp()
                    gap = start_curr - end_prev
                    gaps.append((gap, cycle_data[i - 1]["run"], cycle_data[i]["run"], ts_curr))
                except Exception:
                    pass

        if gaps:
            gap_mean = sum(g[0] for g in gaps) / len(gaps)
            gap_sd = (sum((g[0] - gap_mean) ** 2 for g in gaps) / len(gaps)) ** 0.5
            for gap_dur, run_a, run_b, ts in gaps:
                if gap_sd > 0 and gap_dur > gap_mean + 2 * gap_sd and gap_dur > 5:
                    alerts.append({
                        "type": "idle_time",
                        "severity": "info",
                        "station": "Factory",
                        "run": run_b,
                        "message": f"Extended idle period ({gap_dur:.1f}s) between Run #{run_a} and #{run_b}",
                        "timestamp": ts,
                    })

    # ---- 6. Color sensor drift ----
    for g in grades:
        cv = g.get("color_value")
        if cv is not None:
            if not (40 <= cv <= 60 or 130 <= cv <= 190 or 250 <= cv <= 300):
                alerts.append({
                    "type": "color_sensor_drift",
                    "severity": "warning",
                    "station": "SL",
                    "run": g["run"],
                    "message": f"Color sensor reading {cv} outside expected ranges",
                    "timestamp": g.get("timestamp"),
                })

    # De-duplicate: keep at most one alert per (type, station, run)
    seen = set()
    unique = []
    for a in alerts:
        key = (a["type"], a["station"], a.get("run"))
        if key not in seen:
            seen.add(key)
            unique.append(a)

    # Sort by timestamp descending (newest first), limit to 20
    unique.sort(
        key=lambda a: a.get("timestamp") or "",
        reverse=True,
    )
    return unique[:20]


def get_station_timeline():
    """Return timeline data showing when each station was active."""
    runs = _get_runs()
    timeline = []

    for i, run_events in enumerate(runs):
        for station in STATION_ORDER:
            station_evts = [e for e in run_events if e["station"] == station]
            if not station_evts:
                continue
            actuator_evts = [e for e in station_evts if is_actuator(e["variable"])]
            if not actuator_evts:
                continue

            start = actuator_evts[0]["ts"]
            end = actuator_evts[-1]["ts"]
            timeline.append({
                "run": i + 1,
                "station": station,
                "start": start.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
                "end": end.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
                "duration": round((end - start).total_seconds(), 2),
            })

    return timeline


def get_bottleneck():
    """Identify the bottleneck station."""
    cycle_data = get_cycle_times()
    avg_times = {s: [] for s in STATION_ORDER}

    for run_data in cycle_data:
        for station in STATION_ORDER:
            ct = run_data["stations"].get(station)
            if ct is not None:
                avg_times[station].append(ct)

    averages = {}
    for station, times in avg_times.items():
        if times:
            averages[station] = round(sum(times) / len(times), 2)

    if not averages:
        return None

    bottleneck = max(averages, key=averages.get)
    theo = THEORETICAL_CYCLE.get(bottleneck, 0)

    return {
        "station": bottleneck,
        "avg_cycle_time": averages[bottleneck],
        "theoretical": theo,
        "all_averages": averages,
        "recommendation": f"Reduce {bottleneck} cycle time by {averages[bottleneck] - theo:.1f}s to match theoretical"
        if averages[bottleneck] > theo else "All stations within theoretical limits",
    }


def get_spc_metrics():
    """Calculate Cp and Cpk for measured parameters (burn_time, color_sensor_value).

    Specification limits:
      burn_time:          LSL=2.5s, USL=3.5s  (target 3.0s)
      color_sensor_value: per-grade ranges used as overall spec
                          LSL=40  (lowest Grade C boundary)
                          USL=300 (highest Grade A boundary)
    """
    grades = get_quality_grades()
    if not grades:
        return {}

    specs = {
        "burn_time": {"LSL": 2.5, "USL": 3.5, "target": 3.0, "unit": "s"},
        # color_sensor_value Cpk removed: statistically meaningless across 3 disjoint
        # populations (Grade A/B/C color ranges). Only burn_time Cpk is valid.
    }

    results = {}
    for param, spec in specs.items():
        key = param if param != "color_sensor_value" else "color_value"
        values = [g[key] for g in grades if g.get(key) is not None]
        if len(values) < 2:
            results[param] = {
                "Cp": None, "Cpk": None,
                "mean": None, "sigma": None,
                "n": len(values),
                **spec,
            }
            continue

        n = len(values)
        mean = sum(values) / n
        sigma = (sum((v - mean) ** 2 for v in values) / (n - 1)) ** 0.5

        if sigma > 0:
            cp = (spec["USL"] - spec["LSL"]) / (6 * sigma)
            cpu = (spec["USL"] - mean) / (3 * sigma)
            cpl = (mean - spec["LSL"]) / (3 * sigma)
            cpk = min(cpu, cpl)
        else:
            cp = None
            cpk = None

        results[param] = {
            "Cp": round(cp, 3) if cp is not None else None,
            "Cpk": round(cpk, 3) if cpk is not None else None,
            "mean": round(mean, 3),
            "sigma": round(sigma, 4),
            "n": n,
            "LSL": spec["LSL"],
            "USL": spec["USL"],
            "target": spec["target"],
            "unit": spec["unit"],
            "values": [round(v, 3) for v in values],
        }

    return results


def get_drift_analysis():
    """Split production runs into two halves and compare mean/sigma shift.

    Returns per-parameter:
      first_half_mean, second_half_mean, mean_shift,
      first_half_sigma, second_half_sigma, sigma_change,
      trend: 'improving' | 'degrading' | 'stable'
    """
    grades = get_quality_grades()
    if not grades:
        return {}

    params = {
        "burn_time": {"key": "burn_time", "unit": "s", "lower_is_better": False},
        "color_sensor_value": {"key": "color_value", "unit": "", "lower_is_better": False},
    }

    results = {}
    for param, meta in params.items():
        key = meta["key"]
        values = [g[key] for g in grades if g.get(key) is not None]
        if len(values) < 4:
            results[param] = {"trend": "insufficient_data", "n": len(values)}
            continue

        mid = len(values) // 2
        first_half = values[:mid]
        second_half = values[mid:]

        def _stats(arr):
            n = len(arr)
            m = sum(arr) / n
            s = (sum((v - m) ** 2 for v in arr) / max(n - 1, 1)) ** 0.5
            return m, s

        m1, s1 = _stats(first_half)
        m2, s2 = _stats(second_half)

        mean_shift = m2 - m1
        sigma_change = s2 - s1

        # For burn_time: closer to 3.0s target is better
        # Stability metric: smaller sigma shift = more stable
        if param == "burn_time":
            target = 3.0
            d1 = abs(m1 - target)
            d2 = abs(m2 - target)
            if d2 < d1 - 0.05:
                trend = "improving"
            elif d2 > d1 + 0.05:
                trend = "degrading"
            else:
                trend = "stable"
        else:
            # For color sensor: check sigma stability
            if abs(sigma_change) < 2.0:
                trend = "stable"
            elif sigma_change < 0:
                trend = "improving"
            else:
                trend = "degrading"

        results[param] = {
            "first_half_mean": round(m1, 3),
            "second_half_mean": round(m2, 3),
            "mean_shift": round(mean_shift, 3),
            "first_half_sigma": round(s1, 4),
            "second_half_sigma": round(s2, 4),
            "sigma_change": round(sigma_change, 4),
            "trend": trend,
            "n": len(values),
            "first_n": len(first_half),
            "second_n": len(second_half),
            "unit": meta["unit"],
        }

    return results


def get_summary():
    """High-level summary for executive cockpit."""
    oee = get_oee()
    throughput = get_throughput()
    grades = get_quality_grades()
    bottleneck = get_bottleneck()

    grade_dist = {"A": 0, "B": 0, "C": 0}
    for g in grades:
        if g["grade"] in grade_dist:
            grade_dist[g["grade"]] += 1

    total = sum(grade_dist.values())
    fpy = grade_dist["A"] / total if total > 0 else 0

    return {
        "oee": oee,
        "throughput": throughput,
        "quality": {
            "first_pass_yield": round(fpy, 3),
            "grade_distribution": grade_dist,
            "total_produced": total,
        },
        "bottleneck": bottleneck,
    }
