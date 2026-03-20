"""
Configuration for OPC UA connection to TwinCAT PLC.

The TwinCAT OPC UA Server runs on the Windows PC.
Default endpoint: opc.tcp://<PLC_IP>:4840
"""

# --- OPC UA Connection ---
PLC_IP = "169.254.100.11"              # Fischertechnik PLC via LAN
OPC_UA_PORT = 4840
OPC_UA_ENDPOINT = f"opc.tcp://{PLC_IP}:{OPC_UA_PORT}"

# --- Dashboard ---
DASHBOARD_HOST = "0.0.0.0"
DASHBOARD_PORT = 8050
UPDATE_INTERVAL_MS = 500               # Poll interval in milliseconds

# --- PLC Variable Mapping ---
# OPC UA node paths for TwinCAT:
# Format: "ns=4;s=gvl_name.variable_name"
# Namespace 4 is the default for TwinCAT PLC variables

VARIABLES = {
    # === Machining Station (MS) ===
    "MS": {
        "sensors": {
            "ns=4;s=gvl_MS.bReferenceSwitch_MS_Turntable_attransferunit":  ("Turntable @ Transfer", "bool"),
            "ns=4;s=gvl_MS.bReferenceSwitch_MS_Turntable_atconveyorbelt":  ("Turntable @ Conveyor", "bool"),
            "ns=4;s=gvl_MS.bReferenceSwitch_MS_Turntable_atsaw":           ("Turntable @ Saw", "bool"),
            "ns=4;s=gvl_MS.bReferenceSwitch_MS_TransferUnit_atturntable":  ("Transfer @ Turntable", "bool"),
            "ns=4;s=gvl_MS.bReferenceSwitch_MS_TransferUnit_atoven":       ("Transfer @ Oven", "bool"),
            "ns=4;s=gvl_MS.bReferenceSwitch_MS_OvenSlider_inside":         ("Oven Slider Inside", "bool"),
            "ns=4;s=gvl_MS.bReferenceSwitch_MS_OvenSlider_outside":        ("Oven Slider Outside", "bool"),
            "ns=4;s=gvl_MS.bLightBarrier_MS_conveyorbelt":                 ("LB Conveyor", "bool"),
            "ns=4;s=gvl_MS.bLightBarrier_MS_oven":                         ("LB Oven", "bool"),
        },
        "actuators": {
            "ns=4;s=gvl_MS.bMotor_MS_Turntable_clockwise":                ("Turntable CW", "bool"),
            "ns=4;s=gvl_MS.bMotor_MS_Turntable_counterclockwise":         ("Turntable CCW", "bool"),
            "ns=4;s=gvl_MS.bMotor_MS_ConveyorBelt_forward":               ("Conveyor Fwd", "bool"),
            "ns=4;s=gvl_MS.bMotor_MS_Saw":                                ("Saw", "bool"),
            "ns=4;s=gvl_MS.bMotor_MS_OvenSlider_movein":                  ("Oven Slider In", "bool"),
            "ns=4;s=gvl_MS.bMotor_MS_OvenSlider_moveout":                 ("Oven Slider Out", "bool"),
            "ns=4;s=gvl_MS.bMotor_MS_TransferUnit_tooven":                ("Transfer To Oven", "bool"),
            "ns=4;s=gvl_MS.bMotor_MS_TransferUnit_toturntable":           ("Transfer To Turntable", "bool"),
            "ns=4;s=gvl_MS.bLamp_MS":                                     ("Lamp", "bool"),
            "ns=4;s=gvl_MS.bCompressor_MS":                               ("Compressor", "bool"),
            "ns=4;s=gvl_MS.bValve_MS_Vacuum":                             ("Vacuum Valve", "bool"),
            "ns=4;s=gvl_MS.bValve_MS_TransferUnit":                       ("Transfer Valve", "bool"),
            "ns=4;s=gvl_MS.bValve_MS_OvenDoor":                           ("Oven Door Valve", "bool"),
            "ns=4;s=gvl_MS.bValve_MS_Ejector":                            ("Ejector Valve", "bool"),
        },
    },

    # === Crane (C) ===
    "Crane": {
        "sensors": {
            "ns=4;s=gvl_C.bReferenceSwitch_C_vertical":               ("Ref Vertical", "bool"),
            "ns=4;s=gvl_C.bReferenceSwitch_C_horizontal":             ("Ref Horizontal", "bool"),
            "ns=4;s=gvl_C.bReferenceSwitch_C_rotate":                 ("Ref Rotate", "bool"),
            "ns=4;s=gvl_C.bEncoderImpulse_C_vertical1":               ("Encoder Vert 1", "bool"),
            "ns=4;s=gvl_C.bEncoderImpulse_C_vertical2":               ("Encoder Vert 2", "bool"),
            "ns=4;s=gvl_C.bEncoderImpulse_C_horizontal1":             ("Encoder Horiz 1", "bool"),
            "ns=4;s=gvl_C.bEncoderImpulse_C_horizontal2":             ("Encoder Horiz 2", "bool"),
            "ns=4;s=gvl_C.bEncoderImpulse_C_rotate1":                 ("Encoder Rotate 1", "bool"),
            "ns=4;s=gvl_C.bEncoderImpulse_C_rotate2":                 ("Encoder Rotate 2", "bool"),
        },
        "actuators": {
            "ns=4;s=gvl_C.bMotor_C_upward":                           ("Motor Up", "bool"),
            "ns=4;s=gvl_C.bMotor_C_downward":                         ("Motor Down", "bool"),
            "ns=4;s=gvl_C.bMotor_C_forward":                          ("Motor Forward", "bool"),
            "ns=4;s=gvl_C.bMotor_C_backward":                         ("Motor Backward", "bool"),
            "ns=4;s=gvl_C.bMotor_C_clockwise":                        ("Motor CW", "bool"),
            "ns=4;s=gvl_C.bMotor_C_counterclockwise":                 ("Motor CCW", "bool"),
            "ns=4;s=gvl_C.bCompressor_C":                             ("Compressor", "bool"),
            "ns=4;s=gvl_C.bValve_C":                                  ("Valve", "bool"),
        },
    },

    # === Sorting Line (SL) ===
    "SL": {
        "sensors": {
            "ns=4;s=gvl_SL.bPulseCounter_SL":                         ("Pulse Counter", "bool"),
            "ns=4;s=gvl_SL.bLightBarrier_SL_beforecolor":             ("LB Before Color", "bool"),
            "ns=4;s=gvl_SL.bLightBarrier_SL_aftercolor":              ("LB After Color", "bool"),
            "ns=4;s=gvl_SL.bLightBarrier_SL_white":                   ("LB White", "bool"),
            "ns=4;s=gvl_SL.bLightBarrier_SL_red":                     ("LB Red", "bool"),
            "ns=4;s=gvl_SL.bLightBarrier_SL_blue":                    ("LB Blue", "bool"),
            "ns=4;s=gvl_SL.iColorSensor_SL":                          ("Color Sensor", "int"),
        },
        "actuators": {
            "ns=4;s=gvl_SL.bMotor_SL_ConveyorBelt":                   ("Conveyor Belt", "bool"),
            "ns=4;s=gvl_SL.bCompressor_SL":                           ("Compressor", "bool"),
            "ns=4;s=gvl_SL.bValve_SL_white":                          ("Valve White", "bool"),
            "ns=4;s=gvl_SL.bValve_SL_red":                            ("Valve Red", "bool"),
            "ns=4;s=gvl_SL.bValve_SL_blue":                           ("Valve Blue", "bool"),
        },
    },

    # === High Bay Warehouse (HBW) ===
    "HBW": {
        "sensors": {
            "ns=4;s=gvl_HBW.bReferenceSwitch_HBW_horizontal":         ("Ref Horizontal", "bool"),
            "ns=4;s=gvl_HBW.bReferenceSwitch_HBW_vertical":           ("Ref Vertical", "bool"),
            "ns=4;s=gvl_HBW.bReferenceSwitch_HBW_Cantilever_front":   ("Ref Cantilever Front", "bool"),
            "ns=4;s=gvl_HBW.bReferenceSwitch_HBW_Cantilever_back":    ("Ref Cantilever Back", "bool"),
            "ns=4;s=gvl_HBW.bLightBarrier_HBW_inside":                ("LB Inside", "bool"),
            "ns=4;s=gvl_HBW.bLightBarrier_HBW_outside":               ("LB Outside", "bool"),
            "ns=4;s=gvl_HBW.bTrailSensor_HBW_bottom":                 ("Trail Sensor Bottom", "bool"),
            "ns=4;s=gvl_HBW.bTrailSensor_HBW_top":                    ("Trail Sensor Top", "bool"),
            "ns=4;s=gvl_HBW.bEncoderImpulse_HBW_horizontal1":         ("Encoder Horiz 1", "bool"),
            "ns=4;s=gvl_HBW.bEncoderImpulse_HBW_horizontal2":         ("Encoder Horiz 2", "bool"),
            "ns=4;s=gvl_HBW.bEncoderImpulse_HBW_vertical1":           ("Encoder Vert 1", "bool"),
            "ns=4;s=gvl_HBW.bEncoderImpulse_HBW_vertical2":           ("Encoder Vert 2", "bool"),
        },
        "actuators": {
            "ns=4;s=gvl_HBW.bMotor_HBW_ConveyorBelt_forward":         ("Conv Forward", "bool"),
            "ns=4;s=gvl_HBW.bMotor_HBW_ConveyorBelt_backward":        ("Conv Backward", "bool"),
            "ns=4;s=gvl_HBW.bMotor_HBW_StackerCrane_torack":          ("Stacker To Rack", "bool"),
            "ns=4;s=gvl_HBW.bMotor_HBW_StackerCrane_toconveyorbelt":  ("Stacker To Conv", "bool"),
            "ns=4;s=gvl_HBW.bMotor_HBW_StackerCrane_upward":          ("Stacker Up", "bool"),
            "ns=4;s=gvl_HBW.bMotor_HBW_StackerCrane_downward":        ("Stacker Down", "bool"),
            "ns=4;s=gvl_HBW.bMotor_HBW_Cantilever_forward":           ("Cantilever Fwd", "bool"),
            "ns=4;s=gvl_HBW.bMotor_HBW_Cantilever_backward":          ("Cantilever Bwd", "bool"),
        },
    },

    # === Punching Machine (PM) ===
    "PM": {
        "sensors": {
            "ns=4;s=gvl_PM.bLightBarrier_PM_entry":                   ("LB Entry", "bool"),
            "ns=4;s=gvl_PM.bLightBarrier_PM_tool":                    ("LB Tool", "bool"),
            "ns=4;s=gvl_PM.bReferenceSwitch_PM_top":                  ("Ref Top", "bool"),
            "ns=4;s=gvl_PM.bReferenceSwitch_PM_bottom":               ("Ref Bottom", "bool"),
        },
        "actuators": {
            "ns=4;s=gvl_PM.bMotor_PM_ConveyorBelt_forward":           ("Conv Forward", "bool"),
            "ns=4;s=gvl_PM.bMotor_PM_ConveyorBelt_backward":          ("Conv Backward", "bool"),
            "ns=4;s=gvl_PM.bMotor_PM_Tool_upward":                    ("Tool Up", "bool"),
            "ns=4;s=gvl_PM.bMotor_PM_Tool_downward":                  ("Tool Down", "bool"),
        },
    },

    # === State Variables (LocalVariables) ===
    "State": {
        "state": {
            "ns=4;s=LocalVariables.iC_CoordH":                        ("Crane Coord H", "int"),
            "ns=4;s=LocalVariables.iC_CoordV":                        ("Crane Coord V", "int"),
            "ns=4;s=LocalVariables.iC_CoordR":                        ("Crane Coord R", "int"),
            "ns=4;s=LocalVariables.eC_PickingStation":                ("Crane Picking Station", "enum"),
            "ns=4;s=LocalVariables.eC_PlacingStation":                ("Crane Placing Station", "enum"),
            "ns=4;s=LocalVariables.iC_Coord_Picking":                 ("Crane Coord Picking", "array"),
            "ns=4;s=LocalVariables.iC_Coord_Placing":                 ("Crane Coord Placing", "array"),
        },
    },
}
