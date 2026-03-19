"""
OPC UA Client for TwinCAT PLC - reads all configured variables via LAN.
Works on macOS, Linux, Windows — no TwinCAT installation needed.

Usage:
    from opcua_client import PLCConnection

    plc = PLCConnection()
    plc.connect()
    data = plc.read_all()
    plc.disconnect()
"""

from opcua import Client
from config import OPC_UA_ENDPOINT, VARIABLES


class PLCConnection:
    """Manages OPC UA connection to TwinCAT PLC over LAN."""

    def __init__(self, endpoint=None):
        self.endpoint = endpoint or OPC_UA_ENDPOINT
        self.client = Client(self.endpoint)
        self._connected = False

    def connect(self):
        """Open OPC UA connection."""
        self.client.connect()
        self._connected = True
        print(f"Connected to PLC via OPC UA at {self.endpoint}")

    def disconnect(self):
        """Close OPC UA connection."""
        if self._connected:
            self.client.disconnect()
            self._connected = False
            print("Disconnected from PLC")

    @property
    def is_connected(self):
        return self._connected

    def read_variable(self, node_id: str):
        """Read a single PLC variable by its OPC UA node ID."""
        node = self.client.get_node(node_id)
        return node.get_value()

    def read_all(self) -> dict:
        """
        Read all configured variables and return structured dict.

        Returns:
            {
                "MS": {
                    "sensors": {"Turntable @ Oven": True, ...},
                    "actuators": {"Turntable CW": False, ...},
                },
                ...
            }
        """
        result = {}
        for station, groups in VARIABLES.items():
            result[station] = {}
            for group_name, vars_dict in groups.items():
                result[station][group_name] = {}
                for node_id, (label, var_type) in vars_dict.items():
                    try:
                        value = self.read_variable(node_id)
                        result[station][group_name][label] = value
                    except Exception as e:
                        result[station][group_name][label] = f"ERR: {e}"
        return result

    def read_flat(self) -> dict:
        """Read all variables and return flat dict: {label: value}."""
        result = {}
        for station, groups in VARIABLES.items():
            for group_name, vars_dict in groups.items():
                for node_id, (label, var_type) in vars_dict.items():
                    try:
                        value = self.read_variable(node_id)
                        result[f"{station} | {label}"] = value
                    except Exception:
                        result[f"{station} | {label}"] = None
        return result

    def browse_nodes(self):
        """Browse available OPC UA nodes — useful to discover variable paths."""
        root = self.client.get_root_node()
        objects = self.client.get_objects_node()
        print(f"Root: {root}")
        print(f"Objects: {objects}")
        print("\nChildren of Objects node:")
        for child in objects.get_children():
            print(f"  {child.get_browse_name()}: {child}")
            try:
                for sub in child.get_children():
                    print(f"    {sub.get_browse_name()}: {sub}")
            except Exception:
                pass


if __name__ == "__main__":
    import json

    plc = PLCConnection()
    try:
        plc.connect()

        print("\n--- Browsing nodes ---")
        plc.browse_nodes()

        print("\n--- Reading all variables ---")
        data = plc.read_all()
        print(json.dumps(data, indent=2, default=str))
    except Exception as e:
        print(f"Connection failed: {e}")
        print(f"\nEndpoint: {OPC_UA_ENDPOINT}")
        print("Check:")
        print("  1. Is the TwinCAT OPC UA Server running? (TF6100)")
        print("  2. Can you reach the PLC?  → ping the IP")
        print("  3. Is port 4840 open?")
    finally:
        plc.disconnect()
