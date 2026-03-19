"""
Configuration for OPC UA connection to TwinCAT PLC.

The TwinCAT OPC UA Server runs on the Windows PC.
Default endpoint: opc.tcp://<PLC_IP>:4840
"""

# --- OPC UA Connection ---
PLC_IP = "169.254.159.200"             # <-- CHANGE THIS to your PLC's LAN IP
OPC_UA_PORT = 4840
OPC_UA_ENDPOINT = f"opc.tcp://{PLC_IP}:{OPC_UA_PORT}"

# --- Dashboard ---
DASHBOARD_HOST = "0.0.0.0"
DASHBOARD_PORT = 8050
UPDATE_INTERVAL_MS = 500               # Poll interval in milliseconds

# --- PLC Variable Mapping ---
# OPC UA node paths for TwinCAT:
# Format: "ns=4;s=MAIN.gvl_name.variable_name"
# Namespace 4 is the default for TwinCAT PLC variables

VARIABLES = {
    # === Machining Station (MS) ===
    "MS": {
        "sensors": {
            "ns=4;s=MAIN.gvl_MS.bReferenceSwitch_MS_Turntable_Oven":        ("Turntable @ Oven", "bool"),
            "ns=4;s=MAIN.gvl_MS.bReferenceSwitch_MS_Turntable_Conveyor":    ("Turntable @ Conveyor", "bool"),
            "ns=4;s=MAIN.gvl_MS.bReferenceSwitch_MS_Turntable_Saw":         ("Turntable @ Saw", "bool"),
            "ns=4;s=MAIN.gvl_MS.bReferenceSwitch_MS_OvenSlider_inside":     ("Oven Slider Inside", "bool"),
            "ns=4;s=MAIN.gvl_MS.bReferenceSwitch_MS_OvenSlider_outside":    ("Oven Slider Outside", "bool"),
            "ns=4;s=MAIN.gvl_MS.bLightBarrier_MS_Turntable":                ("LB Turntable", "bool"),
            "ns=4;s=MAIN.gvl_MS.bLightBarrier_MS_Conveyor":                 ("LB Conveyor", "bool"),
            "ns=4;s=MAIN.gvl_MS.bLightBarrier_MS_Oven":                     ("LB Oven", "bool"),
        },
        "actuators": {
            "ns=4;s=MAIN.gvl_MS.bMotor_MS_Turntable_clockwise":             ("Turntable CW", "bool"),
            "ns=4;s=MAIN.gvl_MS.bMotor_MS_Turntable_counterclockwise":      ("Turntable CCW", "bool"),
            "ns=4;s=MAIN.gvl_MS.bMotor_MS_ConveyorBelt_forward":            ("Conveyor Fwd", "bool"),
            "ns=4;s=MAIN.gvl_MS.bMotor_MS_ConveyorBelt_backward":           ("Conveyor Bwd", "bool"),
            "ns=4;s=MAIN.gvl_MS.bMotor_MS_Saw":                             ("Saw", "bool"),
            "ns=4;s=MAIN.gvl_MS.bMotor_MS_OvenSlider_retract":              ("Oven Slider Retract", "bool"),
            "ns=4;s=MAIN.gvl_MS.bMotor_MS_OvenSlider_extend":               ("Oven Slider Extend", "bool"),
            "ns=4;s=MAIN.gvl_MS.bValve_MS_OvenDoor":                        ("Oven Door Valve", "bool"),
            "ns=4;s=MAIN.gvl_MS.bLamp_MS_Oven":                             ("Oven Lamp (Burn)", "bool"),
            "ns=4;s=MAIN.gvl_MS.bCompressor_MS":                            ("Compressor MS", "bool"),
        },
    },

    # === Crane (C) ===
    "Crane": {
        "sensors": {
            "ns=4;s=MAIN.gvl_C.bReferenceSwitch_C_vertical":    ("Ref Vertical", "bool"),
            "ns=4;s=MAIN.gvl_C.bReferenceSwitch_C_horizontal":  ("Ref Horizontal", "bool"),
            "ns=4;s=MAIN.gvl_C.bReferenceSwitch_C_rotate":      ("Ref Rotate", "bool"),
        },
        "actuators": {
            "ns=4;s=MAIN.gvl_C.bMotor_C_upward":                ("Motor Up", "bool"),
            "ns=4;s=MAIN.gvl_C.bMotor_C_downward":              ("Motor Down", "bool"),
            "ns=4;s=MAIN.gvl_C.bMotor_C_forward":               ("Motor Forward", "bool"),
            "ns=4;s=MAIN.gvl_C.bMotor_C_backward":              ("Motor Backward", "bool"),
            "ns=4;s=MAIN.gvl_C.bMotor_C_clockwise":             ("Motor CW", "bool"),
            "ns=4;s=MAIN.gvl_C.bMotor_C_counterclockwise":      ("Motor CCW", "bool"),
            "ns=4;s=MAIN.gvl_C.bCompressor_C":                  ("Compressor C", "bool"),
            "ns=4;s=MAIN.gvl_C.bValve_C_vacuum":                ("Vacuum Valve", "bool"),
        },
    },

    # === Sorting Line (SL) ===
    "SL": {
        "sensors": {
            "ns=4;s=MAIN.gvl_SL.bLightBarrier_SL_BeforeColorSensor":   ("LB Before Color", "bool"),
            "ns=4;s=MAIN.gvl_SL.bLightBarrier_SL_AfterColorSensor":    ("LB After Color", "bool"),
            "ns=4;s=MAIN.gvl_SL.bLightBarrier_SL_StorageWhite":        ("LB Storage White", "bool"),
            "ns=4;s=MAIN.gvl_SL.bLightBarrier_SL_StorageRed":          ("LB Storage Red", "bool"),
            "ns=4;s=MAIN.gvl_SL.bLightBarrier_SL_StorageBlue":         ("LB Storage Blue", "bool"),
            "ns=4;s=MAIN.gvl_SL.iColorSensor_SL":                      ("Color Sensor", "int"),
        },
        "actuators": {
            "ns=4;s=MAIN.gvl_SL.bMotor_SL_ConveyorBelt":               ("Conveyor Belt", "bool"),
            "ns=4;s=MAIN.gvl_SL.bValve_SL_CylinderWhite":              ("Cylinder White", "bool"),
            "ns=4;s=MAIN.gvl_SL.bValve_SL_CylinderRed":                ("Cylinder Red", "bool"),
            "ns=4;s=MAIN.gvl_SL.bValve_SL_CylinderBlue":               ("Cylinder Blue", "bool"),
            "ns=4;s=MAIN.gvl_SL.bCompressor_SL":                       ("Compressor SL", "bool"),
        },
    },

    # === High Bay Warehouse (HBW) ===
    "HBW": {
        "sensors": {
            "ns=4;s=MAIN.gvl_HBW.bReferenceSwitch_HBW_horizontal":         ("Ref Horizontal", "bool"),
            "ns=4;s=MAIN.gvl_HBW.bReferenceSwitch_HBW_vertical":           ("Ref Vertical", "bool"),
            "ns=4;s=MAIN.gvl_HBW.bReferenceSwitch_HBW_cantileverFront":    ("Ref Cantilever Front", "bool"),
            "ns=4;s=MAIN.gvl_HBW.bReferenceSwitch_HBW_cantileverBack":     ("Ref Cantilever Back", "bool"),
            "ns=4;s=MAIN.gvl_HBW.bLightBarrier_HBW_InsideConveyorBelt":    ("LB Inside Conv", "bool"),
            "ns=4;s=MAIN.gvl_HBW.bLightBarrier_HBW_OutsideConveyorBelt":   ("LB Outside Conv", "bool"),
        },
        "actuators": {
            "ns=4;s=MAIN.gvl_HBW.bMotor_HBW_ConveyorBelt_forward":         ("Conv Forward", "bool"),
            "ns=4;s=MAIN.gvl_HBW.bMotor_HBW_ConveyorBelt_backward":        ("Conv Backward", "bool"),
            "ns=4;s=MAIN.gvl_HBW.bMotor_HBW_StackerCrane_forward":         ("Stacker Fwd", "bool"),
            "ns=4;s=MAIN.gvl_HBW.bMotor_HBW_StackerCrane_backward":        ("Stacker Bwd", "bool"),
            "ns=4;s=MAIN.gvl_HBW.bMotor_HBW_StackerCrane_upward":          ("Stacker Up", "bool"),
            "ns=4;s=MAIN.gvl_HBW.bMotor_HBW_StackerCrane_downward":        ("Stacker Down", "bool"),
            "ns=4;s=MAIN.gvl_HBW.bMotor_HBW_CantileverExtend":             ("Cantilever Extend", "bool"),
            "ns=4;s=MAIN.gvl_HBW.bMotor_HBW_CantileverRetract":            ("Cantilever Retract", "bool"),
        },
    },

    # === Punching Machine (PM) ===
    "PM": {
        "sensors": {
            "ns=4;s=MAIN.gvl_PM.bLightBarrier_PM_Entry":            ("LB Entry", "bool"),
            "ns=4;s=MAIN.gvl_PM.bLightBarrier_PM_ToolPosition":     ("LB Tool Position", "bool"),
            "ns=4;s=MAIN.gvl_PM.bReferenceSwitch_PM_Top":           ("Ref Top", "bool"),
            "ns=4;s=MAIN.gvl_PM.bReferenceSwitch_PM_Bottom":        ("Ref Bottom", "bool"),
        },
        "actuators": {
            "ns=4;s=MAIN.gvl_PM.bMotor_PM_ConveyorBelt_forward":    ("Conv Forward", "bool"),
            "ns=4;s=MAIN.gvl_PM.bMotor_PM_ConveyorBelt_backward":   ("Conv Backward", "bool"),
            "ns=4;s=MAIN.gvl_PM.bMotor_PM_Tool_upward":             ("Tool Up", "bool"),
            "ns=4;s=MAIN.gvl_PM.bMotor_PM_Tool_downward":           ("Tool Down", "bool"),
        },
    },

    # === State Variables ===
    "State": {
        "state": {
            "ns=4;s=MAIN.LocalVariables.iMS_Step":                  ("MS Process Step", "int"),
            "ns=4;s=MAIN.LocalVariables.iHBW_Coord_H_Current":     ("HBW Pos H", "int"),
            "ns=4;s=MAIN.LocalVariables.iHBW_Coord_V_Current":     ("HBW Pos V", "int"),
            "ns=4;s=MAIN.LocalVariables.iC_Coord_H":               ("Crane Pos H", "int"),
            "ns=4;s=MAIN.LocalVariables.iC_Coord_V":               ("Crane Pos V", "int"),
            "ns=4;s=MAIN.LocalVariables.iC_Coord_R":               ("Crane Pos R", "int"),
            "ns=4;s=MAIN.LocalVariables.bEmergencyShutdown":        ("Emergency Shutdown", "bool"),
        },
    },
}
