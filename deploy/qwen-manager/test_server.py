import importlib.util
import pathlib
import tempfile
import unittest

MODULE_PATH = pathlib.Path(__file__).with_name("server.py")
spec = importlib.util.spec_from_file_location("qwen_manager", MODULE_PATH)
manager = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(manager)


class ManagerUnitTests(unittest.TestCase):
    def test_extract_json_from_noisy_output(self):
        value = manager._extract_json('log line\n{"task":"change_vqa","target":"water"}\n')
        self.assertEqual(value["task"], "change_vqa")

    def test_route_is_deterministic_for_pair_modes(self):
        self.assertEqual(manager._enforce_route("vqa", "compare", "bitemporal"), ("change_vqa", True))
        self.assertEqual(manager._enforce_route("caption", "water", "optical_sar"), ("optical_sar", True))
        self.assertEqual(manager._enforce_route("change_vqa", "change", "single_image"), ("vqa", True))

    def test_image_path_allowlist(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp).resolve()
            image = root / "scene.jpg"
            image.write_bytes(b"test")
            old = manager.ALLOWED_ROOTS
            manager.ALLOWED_ROOTS = (root,)
            try:
                self.assertEqual(manager._validate_image_path(str(image)), image)
            finally:
                manager.ALLOWED_ROOTS = old


if __name__ == "__main__":
    unittest.main()
