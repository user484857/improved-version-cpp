"""
ADS Client for TwinCAT PLC - reads all configured variables via LAN.

Usage:
    from ads_client import PLCConnection

    plc = PLCConnection()
    plc.connect()
    data = plc.read_all()
    plc.disconnect()
"""

import pyads
from config import PLC_AMS_NET_ID, PLC_IP, AMS_PORT, VARIABLES


class PLCConnection:
    """Manages ADS connection to TwinCAT PLC over LAN."""

    def __init__(self):
        self.plc = pyads.Connection(PLC_AMS_NET_ID, AMS_PORT, PLC_IP)
        self._connected = False

    def connect(self):
        """Open ADS connection."""
        self.plc.open()
        self._connected = True
        print(f"Connected to PLC at {PLC_AMS_NET_ID} ({PLC_IP})")

    def disconnect(self):
        """Close ADS connection."""
        if self._connected:
            self.plc.close()
            self._connected = False
            print("Disconnected from PLC")

    @property
    def is_connected(self):
        return self._connected

    def read_variable(self, symbol_name: str, var_type: str):
        """Read a single PLC variable by its full symbol path."""
        if var_type == "bool":
            return self.plc.read_by_name(symbol_name, pyads.PLCTYPE_BOOL)
        elif var_type == "int":
            return self.plc.read_by_name(symbol_name, pyads.PLCTYPE_INT)
        elif var_type == "real":
            return self.plc.read_by_name(symbol_name, pyads.PLCTYPE_REAL)
        else:
            return self.plc.read_by_name(symbol_name, pyads.PLCTYPE_BOOL)

    def read_all(self) -> dict:
        """
        Read all configured variables and return structured dict.

        Returns:
            {
                "MS": {
                    "sensors": {"Turntable @ Oven": True, ...},
                    "actuators": {"Turntable CW": False, ...},
                },
                "Crane": { ... },
                ...
            }
        """
        result = {}
        for station, groups in VARIABLES.items():
            result[station] = {}
            for group_name, vars_dict in groups.items():
                result[station][group_name] = {}
                for symbol, (label, var_type) in vars_dict.items():
                    try:
                        value = self.read_variable(symbol, var_type)
                        result[station][group_name][label] = value
                    except Exception as e:
                        result[station][group_name][label] = f"ERR: {e}"
        return result

    def read_flat(self) -> dict:
        """Read all variables and return flat dict: {label: value}."""
        result = {}
        for station, groups in VARIABLES.items():
            for group_name, vars_dict in groups.items():
                for symbol, (label, var_type) in vars_dict.items():
                    try:
                        value = self.read_variable(symbol, var_type)
                        result[f"{station} | {label}"] = value
                    except Exception:
                        result[f"{station} | {label}"] = None
        return result


def add_ads_route():
    """
    Add an ADS route on this machine to reach the TwinCAT PLC.
    Only needed once per machine. Run this if connection fails.
    """
    print("Adding ADS route...")
    print(f"  Target: {PLC_AMS_NET_ID} at {PLC_IP}")
    pyads.add_route(PLC_AMS_NET_ID, PLC_IP)
    print("Route added. You may also need to add a route on the TwinCAT side:")
    print("  TwinCAT > System > Routes > Add Route")
    print(f"  Enter this machine's AMS Net ID and IP address.")


if __name__ == "__main__":
    # Quick test: connect and read all variables once
    import json

    plc = PLCConnection()
    try:
        plc.connect()
        data = plc.read_all()
        print(json.dumps(data, indent=2, default=str))
    except pyads.ADSError as e:
        print(f"ADS Error: {e}")
        print("Tip: Run 'python ads_client.py --add-route' to set up the route first.")
    finally:
        plc.disconnect()
