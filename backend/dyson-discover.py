"""Enroll Dyson purifiers for the local WBPAI collector without printing secrets."""

from __future__ import annotations

import getpass
import os
import socket
import sys
import tempfile
import argparse
import ipaddress
from pathlib import Path


LOCAL_VENDOR_DIR = Path(__file__).resolve().parent / ".dyson-tools"
if LOCAL_VENDOR_DIR.exists():
    sys.path.insert(0, str(LOCAL_VENDOR_DIR))

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


def local_ip(value: str) -> str:
    address = ipaddress.ip_address(value.strip())
    if address.version != 4 or not address.is_private or address.is_loopback:
        raise ValueError("Use the purifier's private IPv4 address from your home router")
    return str(address)


def save_devices(env_path: Path, entries: list[str]) -> None:
    if not env_path.exists():
        raise FileNotFoundError(f"Create {env_path} with collector credentials first")
    original = env_path.read_text(encoding="utf-8")
    lines = [line for line in original.splitlines() if not line.startswith("DYSON_DEVICES=")]
    lines.append(f"DYSON_DEVICES={','.join(entries)}")
    fd, temp_path = tempfile.mkstemp(prefix=".dyson-env-", dir=env_path.parent)
    try:
        os.chmod(temp_path, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write("\n".join(lines) + "\n")
        os.replace(temp_path, env_path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(__file__).resolve().parent / ".env")
    args = parser.parse_args()
    try:
        from libdyson_rest import DysonClient
    except ImportError:
        print("Install libdyson-rest on the home collector first.", file=sys.stderr)
        return 1

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
        if local_password and not host:
            host = input(f"  Router IP for {device.name} (blank to skip): ").strip()
        if host and local_password:
            try:
                host = local_ip(host)
            except ValueError as error:
                print(f"  Skipped: {error}")
                continue
            try:
                with socket.create_connection((host, 1883), timeout=3):
                    pass
            except OSError:
                print(f"  Skipped: local MQTT is not reachable at {host}:1883")
                continue
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
        save_devices(args.env_file, env_entries)
        print(f"\nSaved {len(env_entries)} device(s) to local collector configuration. Restart the collector to connect.")
    else:
        print(
            "\nNo devices enrolled. Check the router IPs and local MQTT availability."
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
