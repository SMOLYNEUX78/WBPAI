"""Discover Dyson purifier details for the local WBPAI Dyson collector.

This uses Dyson's current OTP login flow through libdyson-rest and prints the
DYSON_DEVICES value expected by dyson-handler.js.
"""

from __future__ import annotations

import getpass
import os
import sys
from pathlib import Path


LOCAL_VENDOR_DIR = Path(__file__).resolve().parent / ".dyson-tools"
if LOCAL_VENDOR_DIR.exists():
    sys.path.insert(0, str(LOCAL_VENDOR_DIR))

from libdyson_rest import DysonClient  # noqa: E402


def env_or_prompt(name: str, prompt: str, secret: bool = False) -> str:
    value = os.environ.get(name, "").strip()
    if value:
        return value

    if secret:
        return getpass.getpass(prompt).strip()
    return input(prompt).strip()


def parse_ip_map(value: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for entry in value.split(","):
        if not entry.strip() or "=" not in entry:
            continue
        serial, ip_address = entry.split("=", 1)
        result[serial.strip()] = ip_address.strip()
        result[normalise_serial(serial)] = ip_address.strip()
    return result


def normalise_serial(value: str) -> str:
    return value.strip().replace("-", "").upper()


def safe_name(value: str) -> str:
    return (
        value.strip()
        .replace(":", "-")
        .replace(",", "-")
        .replace(" ", "_")
        or "dyson"
    )


def main() -> int:
    email = env_or_prompt("DYSON_EMAIL", "Dyson email: ")
    password = env_or_prompt("DYSON_PASSWORD", "Dyson password: ", secret=True)
    country = os.environ.get("DYSON_COUNTRY", "GB").strip().upper()
    culture = os.environ.get("DYSON_CULTURE", f"en-{country}").strip()
    ip_map = parse_ip_map(os.environ.get("DYSON_DEVICE_IPS", ""))

    client = DysonClient(
        email=email,
        password=password,
        country=country,
        culture=culture,
        user_agent=os.environ.get("DYSON_USER_AGENT", "android client"),
    )

    print("Requesting Dyson one-time code...")
    client.authenticate()
    otp = env_or_prompt("DYSON_OTP", "Enter Dyson one-time code: ")
    client.complete_authentication(otp)

    devices = client.get_devices()
    env_entries: list[str] = []

    print("\nDevices found:")
    for device in devices:
        product_code = device.type
        firmware = None
        mqtt_credentials = None
        local_password = None

        if device.connected_configuration:
            firmware = device.connected_configuration.firmware.version
            if device.connected_configuration.mqtt:
                mqtt_credentials = (
                    device.connected_configuration.mqtt.local_broker_credentials
                )

        if mqtt_credentials:
            local_password = client.decrypt_local_credentials(
                mqtt_credentials,
                device.serial_number,
            )

        print(f"- {device.name}")
        print(f"  serial: {device.serial_number}")
        print(f"  product_code: {product_code}")
        print(f"  model: {device.model or ''}")
        print(f"  firmware: {firmware or ''}")
        print(f"  has_local_mqtt: {'yes' if local_password else 'no'}")

        host = ip_map.get(device.serial_number) or ip_map.get(
            normalise_serial(device.serial_number)
        )
        if host and local_password:
            env_entries.append(
                ":".join(
                    [
                        safe_name(device.name),
                        host,
                        product_code,
                        device.serial_number,
                        local_password,
                    ]
                )
            )

    if env_entries:
        print("\nPaste this into backend/.env:")
        print(f"DYSON_DEVICES={','.join(env_entries)}")
    else:
        print(
            "\nNo DYSON_DEVICES line could be built. Set DYSON_DEVICE_IPS with "
            "serial=ip entries and make sure the devices have local MQTT."
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
