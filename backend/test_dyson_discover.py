import importlib.util
import tempfile
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "dyson_discover", Path(__file__).with_name("dyson-discover.py")
)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class DysonDiscoveryTests(unittest.TestCase):
    def test_only_private_router_addresses_are_accepted(self):
        self.assertEqual(module.local_ip("192.168.1.25"), "192.168.1.25")
        for address in ("127.0.0.1", "8.8.8.8", "not-an-ip"):
            with self.assertRaises(ValueError):
                module.local_ip(address)

    def test_save_replaces_only_dyson_config(self):
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text("SUPABASE_KEY=keep\nDYSON_DEVICES=old\n", encoding="utf-8")
            module.save_devices(env_path, ["upstairs:192.168.1.2:438:SERIAL:SECRET"])
            content = env_path.read_text(encoding="utf-8")
            self.assertIn("SUPABASE_KEY=keep\n", content)
            self.assertEqual(content.count("DYSON_DEVICES="), 1)
            self.assertIn("DYSON_DEVICES=upstairs:192.168.1.2:438:SERIAL:SECRET", content)


if __name__ == "__main__":
    unittest.main()
