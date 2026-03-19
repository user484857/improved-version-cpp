"""
Simulates realistic Fischertechnik factory data and writes to CSV.
Mimics what opcua_subscription.py would collect from the real factory.

Usage:
    python simulate_factory.py              → simulate 3 runs (default)
    python simulate_factory.py --runs 9     → simulate 9 runs
    python simulate_factory.py --live       → simulate in real-time (slow, for dashboard testing)
"""

import csv
import os
import sys
import time
import random
from datetime import datetime, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data")

# ============================================================================
# Factory process simulation
# One "run" = one workpiece going through the full production line:
#   HBW (retrieve) → Crane (pick) → MS (burn/saw) → PM (punch) → SL (sort) → HBW (store)
# ============================================================================

COLORS = ["white", "red", "blue"]
COLOR_SENSOR_VALUES = {"white": (250, 300), "red": (130, 190), "blue": (40, 60)}


def emit(events, ts, gvl, var, val):
    """Append a data change event."""
    events.append((ts.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3], gvl, var, val))


def simulate_hbw_retrieve(events, t, duration_s=8):
    """HBW: Retrieve workpiece from rack onto conveyor belt."""
    gvl = "gvl_HBW"
    # Stacker crane moves to rack
    emit(events, t, gvl, "bMotor_HBW_StackerCrane_torack", True)
    t += timedelta(seconds=1.5)
    emit(events, t, gvl, "bReferenceSwitch_HBW_horizontal", False)
    t += timedelta(seconds=2.0)
    emit(events, t, gvl, "bMotor_HBW_StackerCrane_torack", False)

    # Lower to correct level
    emit(events, t, gvl, "bMotor_HBW_StackerCrane_downward", True)
    t += timedelta(seconds=1.0)
    emit(events, t, gvl, "bReferenceSwitch_HBW_vertical", False)
    t += timedelta(seconds=0.5)
    emit(events, t, gvl, "bMotor_HBW_StackerCrane_downward", False)

    # Extend cantilever to pick
    emit(events, t, gvl, "bMotor_HBW_Cantilever_forward", True)
    t += timedelta(seconds=0.8)
    emit(events, t, gvl, "bReferenceSwitch_HBW_Cantilever_front", True)
    emit(events, t, gvl, "bMotor_HBW_Cantilever_forward", False)

    # Retract cantilever
    t += timedelta(seconds=0.3)
    emit(events, t, gvl, "bMotor_HBW_Cantilever_backward", True)
    t += timedelta(seconds=0.8)
    emit(events, t, gvl, "bReferenceSwitch_HBW_Cantilever_back", True)
    emit(events, t, gvl, "bReferenceSwitch_HBW_Cantilever_front", False)
    emit(events, t, gvl, "bMotor_HBW_Cantilever_backward", False)

    # Move back to conveyor belt
    emit(events, t, gvl, "bMotor_HBW_StackerCrane_toconveyorbelt", True)
    emit(events, t, gvl, "bMotor_HBW_StackerCrane_upward", True)
    t += timedelta(seconds=2.0)
    emit(events, t, gvl, "bReferenceSwitch_HBW_horizontal", True)
    emit(events, t, gvl, "bReferenceSwitch_HBW_vertical", True)
    emit(events, t, gvl, "bMotor_HBW_StackerCrane_toconveyorbelt", False)
    emit(events, t, gvl, "bMotor_HBW_StackerCrane_upward", False)

    # Place on conveyor belt
    emit(events, t, gvl, "bMotor_HBW_Cantilever_forward", True)
    t += timedelta(seconds=0.8)
    emit(events, t, gvl, "bMotor_HBW_Cantilever_forward", False)
    emit(events, t, gvl, "bMotor_HBW_Cantilever_backward", True)
    t += timedelta(seconds=0.8)
    emit(events, t, gvl, "bMotor_HBW_Cantilever_backward", False)

    # Conveyor belt to crane
    emit(events, t, gvl, "bMotor_HBW_ConveyorBelt_forward", True)
    emit(events, t, gvl, "bLightBarrier_HBW_inside", True)
    t += timedelta(seconds=1.5)
    emit(events, t, gvl, "bLightBarrier_HBW_inside", False)
    emit(events, t, gvl, "bLightBarrier_HBW_outside", True)
    emit(events, t, gvl, "bMotor_HBW_ConveyorBelt_forward", False)

    return t


def simulate_crane_pick(events, t):
    """Crane: Pick workpiece from HBW conveyor belt."""
    gvl = "gvl_C"
    # Compressor on for vacuum gripper
    emit(events, t, gvl, "bCompressor_C", True)
    t += timedelta(seconds=0.5)

    # Rotate to HBW
    emit(events, t, gvl, "bMotor_C_clockwise", True)
    t += timedelta(seconds=1.2)
    emit(events, t, gvl, "bReferenceSwitch_C_rotate", False)
    t += timedelta(seconds=1.0)
    emit(events, t, gvl, "bMotor_C_clockwise", False)

    # Extend and lower
    emit(events, t, gvl, "bMotor_C_forward", True)
    t += timedelta(seconds=1.5)
    emit(events, t, gvl, "bReferenceSwitch_C_horizontal", False)
    emit(events, t, gvl, "bMotor_C_forward", False)
    emit(events, t, gvl, "bMotor_C_downward", True)
    t += timedelta(seconds=1.0)
    emit(events, t, gvl, "bReferenceSwitch_C_vertical", False)
    emit(events, t, gvl, "bMotor_C_downward", False)

    # Grab with vacuum
    emit(events, t, gvl, "bValve_C", True)
    t += timedelta(seconds=0.5)

    # Lift and retract
    emit(events, t, gvl, "bMotor_C_upward", True)
    t += timedelta(seconds=1.0)
    emit(events, t, gvl, "bReferenceSwitch_C_vertical", True)
    emit(events, t, gvl, "bMotor_C_upward", False)
    emit(events, t, gvl, "bMotor_C_backward", True)
    t += timedelta(seconds=1.5)
    emit(events, t, gvl, "bReferenceSwitch_C_horizontal", True)
    emit(events, t, gvl, "bMotor_C_backward", False)

    return t


def simulate_crane_place(events, t):
    """Crane: Place workpiece at machining station conveyor belt."""
    gvl = "gvl_C"
    # Rotate to MS
    emit(events, t, gvl, "bMotor_C_counterclockwise", True)
    t += timedelta(seconds=1.5)
    emit(events, t, gvl, "bMotor_C_counterclockwise", False)

    # Extend and lower
    emit(events, t, gvl, "bMotor_C_forward", True)
    t += timedelta(seconds=1.5)
    emit(events, t, gvl, "bMotor_C_forward", False)
    emit(events, t, gvl, "bMotor_C_downward", True)
    t += timedelta(seconds=1.0)
    emit(events, t, gvl, "bMotor_C_downward", False)

    # Release vacuum
    emit(events, t, gvl, "bValve_C", False)
    t += timedelta(seconds=0.3)

    # Retract and go home
    emit(events, t, gvl, "bMotor_C_upward", True)
    t += timedelta(seconds=1.0)
    emit(events, t, gvl, "bMotor_C_upward", False)
    emit(events, t, gvl, "bMotor_C_backward", True)
    t += timedelta(seconds=1.5)
    emit(events, t, gvl, "bMotor_C_backward", False)
    emit(events, t, gvl, "bMotor_C_clockwise", True)
    t += timedelta(seconds=1.0)
    emit(events, t, gvl, "bReferenceSwitch_C_rotate", True)
    emit(events, t, gvl, "bMotor_C_clockwise", False)
    emit(events, t, gvl, "bCompressor_C", False)

    return t


def simulate_ms_burning(events, t):
    """Machining Station: Burn workpiece in oven."""
    gvl = "gvl_MS"
    # WP arrives on conveyor belt
    emit(events, t, gvl, "bLightBarrier_MS_conveyorbelt", True)
    emit(events, t, gvl, "bMotor_MS_ConveyorBelt_forward", True)
    t += timedelta(seconds=1.0)
    emit(events, t, gvl, "bMotor_MS_ConveyorBelt_forward", False)
    emit(events, t, gvl, "bLightBarrier_MS_conveyorbelt", False)

    # Turntable rotates to transfer unit
    emit(events, t, gvl, "bMotor_MS_Turntable_clockwise", True)
    t += timedelta(seconds=1.2)
    emit(events, t, gvl, "bReferenceSwitch_MS_Turntable_attransferunit", True)
    emit(events, t, gvl, "bReferenceSwitch_MS_Turntable_atconveyorbelt", False)
    emit(events, t, gvl, "bMotor_MS_Turntable_clockwise", False)

    # Transfer unit picks WP and moves to oven
    emit(events, t, gvl, "bCompressor_MS", True)
    t += timedelta(seconds=0.3)
    emit(events, t, gvl, "bValve_MS_Vacuum", True)
    emit(events, t, gvl, "bValve_MS_TransferUnit", True)
    t += timedelta(seconds=0.5)
    emit(events, t, gvl, "bMotor_MS_TransferUnit_tooven", True)
    t += timedelta(seconds=1.5)
    emit(events, t, gvl, "bReferenceSwitch_MS_TransferUnit_atoven", True)
    emit(events, t, gvl, "bReferenceSwitch_MS_TransferUnit_atturntable", False)
    emit(events, t, gvl, "bMotor_MS_TransferUnit_tooven", False)

    # Place WP on oven slider
    emit(events, t, gvl, "bValve_MS_Vacuum", False)
    emit(events, t, gvl, "bValve_MS_TransferUnit", False)
    t += timedelta(seconds=0.3)
    emit(events, t, gvl, "bLightBarrier_MS_oven", True)

    # Open oven door, slide in
    emit(events, t, gvl, "bValve_MS_OvenDoor", True)
    t += timedelta(seconds=0.8)
    emit(events, t, gvl, "bMotor_MS_OvenSlider_movein", True)
    t += timedelta(seconds=1.5)
    emit(events, t, gvl, "bReferenceSwitch_MS_OvenSlider_inside", True)
    emit(events, t, gvl, "bReferenceSwitch_MS_OvenSlider_outside", False)
    emit(events, t, gvl, "bMotor_MS_OvenSlider_movein", False)

    # Close door, burn
    emit(events, t, gvl, "bValve_MS_OvenDoor", False)
    t += timedelta(seconds=0.5)
    emit(events, t, gvl, "bLamp_MS", True)
    t += timedelta(seconds=3.0)  # burning takes ~3 seconds
    emit(events, t, gvl, "bLamp_MS", False)

    # Open door, slide out
    emit(events, t, gvl, "bValve_MS_OvenDoor", True)
    t += timedelta(seconds=0.5)
    emit(events, t, gvl, "bMotor_MS_OvenSlider_moveout", True)
    t += timedelta(seconds=1.5)
    emit(events, t, gvl, "bReferenceSwitch_MS_OvenSlider_outside", True)
    emit(events, t, gvl, "bReferenceSwitch_MS_OvenSlider_inside", False)
    emit(events, t, gvl, "bMotor_MS_OvenSlider_moveout", False)
    emit(events, t, gvl, "bValve_MS_OvenDoor", False)

    # Transfer unit picks WP back
    emit(events, t, gvl, "bValve_MS_Vacuum", True)
    emit(events, t, gvl, "bValve_MS_TransferUnit", True)
    t += timedelta(seconds=0.5)
    emit(events, t, gvl, "bLightBarrier_MS_oven", False)
    emit(events, t, gvl, "bMotor_MS_TransferUnit_toturntable", True)
    t += timedelta(seconds=1.5)
    emit(events, t, gvl, "bReferenceSwitch_MS_TransferUnit_atturntable", True)
    emit(events, t, gvl, "bReferenceSwitch_MS_TransferUnit_atoven", False)
    emit(events, t, gvl, "bMotor_MS_TransferUnit_toturntable", False)
    emit(events, t, gvl, "bValve_MS_Vacuum", False)
    emit(events, t, gvl, "bValve_MS_TransferUnit", False)

    return t


def simulate_ms_sawing(events, t):
    """Machining Station: Saw workpiece."""
    gvl = "gvl_MS"
    # Turntable to saw
    emit(events, t, gvl, "bMotor_MS_Turntable_counterclockwise", True)
    t += timedelta(seconds=1.0)
    emit(events, t, gvl, "bReferenceSwitch_MS_Turntable_atsaw", True)
    emit(events, t, gvl, "bReferenceSwitch_MS_Turntable_attransferunit", False)
    emit(events, t, gvl, "bMotor_MS_Turntable_counterclockwise", False)

    # Saw
    emit(events, t, gvl, "bMotor_MS_Saw", True)
    t += timedelta(seconds=2.5)
    emit(events, t, gvl, "bMotor_MS_Saw", False)

    # Turntable back to conveyor belt
    emit(events, t, gvl, "bMotor_MS_Turntable_clockwise", True)
    t += timedelta(seconds=1.5)
    emit(events, t, gvl, "bReferenceSwitch_MS_Turntable_atconveyorbelt", True)
    emit(events, t, gvl, "bReferenceSwitch_MS_Turntable_atsaw", False)
    emit(events, t, gvl, "bMotor_MS_Turntable_clockwise", False)

    # Eject WP to conveyor belt
    emit(events, t, gvl, "bValve_MS_Ejector", True)
    t += timedelta(seconds=0.5)
    emit(events, t, gvl, "bValve_MS_Ejector", False)
    emit(events, t, gvl, "bCompressor_MS", False)

    return t


def simulate_punching(events, t):
    """Punching Machine: Punch workpiece."""
    gvl = "gvl_PM"
    # WP enters
    emit(events, t, gvl, "bLightBarrier_PM_entry", True)
    emit(events, t, gvl, "bMotor_PM_ConveyorBelt_forward", True)
    t += timedelta(seconds=1.5)
    emit(events, t, gvl, "bLightBarrier_PM_entry", False)
    emit(events, t, gvl, "bLightBarrier_PM_tool", True)
    emit(events, t, gvl, "bMotor_PM_ConveyorBelt_forward", False)

    # Punch down
    emit(events, t, gvl, "bMotor_PM_Tool_downward", True)
    emit(events, t, gvl, "bReferenceSwitch_PM_top", False)
    t += timedelta(seconds=1.0)
    emit(events, t, gvl, "bReferenceSwitch_PM_bottom", True)
    emit(events, t, gvl, "bMotor_PM_Tool_downward", False)

    # Punch up
    t += timedelta(seconds=0.3)
    emit(events, t, gvl, "bMotor_PM_Tool_upward", True)
    emit(events, t, gvl, "bReferenceSwitch_PM_bottom", False)
    t += timedelta(seconds=1.0)
    emit(events, t, gvl, "bReferenceSwitch_PM_top", True)
    emit(events, t, gvl, "bMotor_PM_Tool_upward", False)

    # WP exits
    emit(events, t, gvl, "bMotor_PM_ConveyorBelt_forward", True)
    t += timedelta(seconds=1.0)
    emit(events, t, gvl, "bLightBarrier_PM_tool", False)
    emit(events, t, gvl, "bMotor_PM_ConveyorBelt_forward", False)

    return t


def simulate_sorting(events, t, color):
    """Sorting Line: Sort workpiece by color."""
    gvl = "gvl_SL"
    color_val = random.randint(*COLOR_SENSOR_VALUES[color])

    # WP enters sorting line
    emit(events, t, gvl, "bMotor_SL_ConveyorBelt", True)
    emit(events, t, gvl, "bCompressor_SL", True)
    t += timedelta(seconds=1.0)

    # Pass color sensor
    emit(events, t, gvl, "bLightBarrier_SL_beforecolor", True)
    t += timedelta(seconds=0.3)
    emit(events, t, gvl, "iColorSensor_SL", color_val)
    t += timedelta(seconds=0.5)
    emit(events, t, gvl, "bLightBarrier_SL_beforecolor", False)
    emit(events, t, gvl, "bLightBarrier_SL_aftercolor", True)
    t += timedelta(seconds=0.3)
    emit(events, t, gvl, "bLightBarrier_SL_aftercolor", False)
    emit(events, t, gvl, "iColorSensor_SL", 0)

    # Move to correct storage and activate valve
    valve_var = f"bValve_SL_{color}"
    lb_var = f"bLightBarrier_SL_{color}"
    sort_delay = {"white": 1.5, "red": 2.5, "blue": 3.5}

    t += timedelta(seconds=sort_delay[color])
    emit(events, t, gvl, valve_var, True)
    t += timedelta(seconds=0.3)
    emit(events, t, gvl, lb_var, True)
    t += timedelta(seconds=0.5)
    emit(events, t, gvl, valve_var, False)
    emit(events, t, gvl, lb_var, False)

    emit(events, t, gvl, "bMotor_SL_ConveyorBelt", False)
    emit(events, t, gvl, "bCompressor_SL", False)

    return t


def simulate_full_run(events, t, color):
    """Simulate one complete workpiece run through the factory."""
    t = simulate_hbw_retrieve(events, t)
    t += timedelta(seconds=0.5)
    t = simulate_crane_pick(events, t)
    t += timedelta(seconds=0.5)
    t = simulate_crane_place(events, t)
    t += timedelta(seconds=0.5)
    t = simulate_ms_burning(events, t)
    t += timedelta(seconds=0.5)
    t = simulate_ms_sawing(events, t)
    t += timedelta(seconds=0.5)
    t = simulate_punching(events, t)
    t += timedelta(seconds=0.5)
    t = simulate_sorting(events, t, color)
    t += timedelta(seconds=2.0)  # pause between runs
    return t


def main():
    num_runs = 3
    live_mode = "--live" in sys.argv

    for i, arg in enumerate(sys.argv):
        if arg == "--runs" and i + 1 < len(sys.argv):
            num_runs = int(sys.argv[i + 1])

    os.makedirs(DATA_DIR, exist_ok=True)
    run_time = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = os.path.join(DATA_DIR, f"simulated_run_{run_time}.csv")

    # Generate color sequence (mix of colors)
    color_sequence = []
    for i in range(num_runs):
        color_sequence.append(COLORS[i % len(COLORS)])
    random.shuffle(color_sequence)

    print(f"Simulating {num_runs} factory runs...")
    print(f"Color sequence: {', '.join(color_sequence)}")
    if live_mode:
        print("Live mode: writing events in real-time speed\n")
    print()

    events = []
    t = datetime.now()
    for i, color in enumerate(color_sequence):
        print(f"  Run {i + 1}/{num_runs}: {color} workpiece")
        t = simulate_full_run(events, t, color)

    # Sort events by timestamp (should already be sorted, but just in case)
    events.sort(key=lambda e: e[0])

    # Write to CSV
    with open(csv_path, "w", newline="") as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(["timestamp", "gvl", "variable", "value"])

        if live_mode:
            print("\nWriting events in real-time...")
            base_time = datetime.strptime(events[0][0], "%Y-%m-%d %H:%M:%S.%f")
            start_real = time.time()
            for ts_str, gvl, var, val in events:
                event_time = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S.%f")
                delay = (event_time - base_time).total_seconds()
                elapsed = time.time() - start_real
                if delay > elapsed:
                    time.sleep(delay - elapsed)
                writer.writerow([ts_str, gvl, var, val])
                csvfile.flush()
                print(f"  [{ts_str}] {gvl}.{var} = {val}")
        else:
            for event in events:
                writer.writerow(event)

    print(f"\n{'=' * 60}")
    print(f"Simulation complete.")
    print(f"  Runs: {num_runs}")
    print(f"  Events: {len(events)}")
    print(f"  CSV: {csv_path}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
