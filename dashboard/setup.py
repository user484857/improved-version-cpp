"""
Setup script: tests OPC UA connection to TwinCAT PLC.
Run this to verify connectivity before starting the dashboard.

Usage:
    python setup.py
"""

import sys

try:
    from opcua import Client
except ImportError:
    print("ERROR: opcua not installed. Run: pip install -r requirements.txt")
    sys.exit(1)

from config import OPC_UA_ENDPOINT, PLC_IP


def main():
    print(f"\n{'='*60}")
    print(f"  Fischertechnik OPC UA Setup")
    print(f"{'='*60}")
    print(f"\n  OPC UA Endpoint : {OPC_UA_ENDPOINT}")
    print(f"  PLC IP Address  : {PLC_IP}")

    # Step 1: Test connection
    print(f"\n[1/2] Connecting to OPC UA server...")
    client = Client(OPC_UA_ENDPOINT)
    try:
        client.connect()
        print("  ✓ Connected!")
    except Exception as e:
        print(f"  ✗ Connection failed: {e}")
        print("\n  Troubleshooting:")
        print("  1. Is TwinCAT running with OPC UA Server (TF6100)?")
        print("  2. Is the LAN cable connected?")
        print(f"  3. Can you ping the PLC?  → ping {PLC_IP}")
        print("  4. Is port 4840 open on the Windows firewall?")
        print("  5. Check TwinCAT OPC UA Configurator settings")
        return

    # Step 2: Browse nodes
    print(f"\n[2/2] Browsing available nodes...")
    try:
        objects = client.get_objects_node()
        print("  Available top-level nodes:")
        for child in objects.get_children():
            name = child.get_browse_name()
            print(f"    {name}")
            try:
                for sub in child.get_children()[:5]:
                    print(f"      └─ {sub.get_browse_name()}")
            except Exception:
                pass
    except Exception as e:
        print(f"  ✗ Browse failed: {e}")
    finally:
        client.disconnect()

    print(f"\n{'='*60}")
    print(f"  Setup complete! Start the dashboard:")
    print(f"  python dashboard.py")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
