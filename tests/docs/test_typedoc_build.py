"""Check TypeDoc build failures without installing Sphinx or running report hooks."""

import ast
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from typing import List, Optional
import unittest
from unittest.mock import patch


class ConfigError(Exception):
    """Stand-in for Sphinx's configuration error in these dependency-free tests."""


class TypeDocBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config_path = Path(__file__).resolve().parents[2] / "docs/source/conf.py"
        config = ast.parse(config_path.read_text(encoding="utf-8"))
        # Load the real build functions, excluding unrelated Sphinx/report setup.
        functions = ast.Module(
            body=[
                node
                for node in config.body
                if isinstance(node, ast.FunctionDef)
                and node.name in ("_typedoc_command", "_generate_typedoc")
            ],
            type_ignores=[],
        )
        cls.build_code = compile(functions, str(config_path), "exec")

    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.root = Path(temporary_directory.name)
        self.config = self.root / "typedoc.json"
        self.config.write_text("{}", encoding="utf-8")
        self.output = self.root / "docs/typedoc"
        self.index = self.output / "index.html"
        self.namespace = {
            "PROJECT_ROOT": self.root,
            "_typedoc_config": self.config,
            "_typedoc_output": self.output,
            "_typedoc_index": self.index,
            "ConfigError": ConfigError,
            "List": List,
            "Optional": Optional,
            "os": os,
            "shutil": shutil,
            "subprocess": subprocess,
        }
        exec(self.build_code, self.namespace)
        environment = patch.dict(os.environ, {"TYPEDOC_SKIP": ""})
        environment.start()
        self.addCleanup(environment.stop)

    def set_command(self, script):
        script_path = self.root / "typedoc_stub.py"
        script_path.write_text(script, encoding="utf-8")
        self.namespace["_typedoc_command"] = lambda: [sys.executable, str(script_path)]

    def generate(self):
        return self.namespace["_generate_typedoc"]()

    def write_stale_index(self):
        self.output.mkdir(parents=True)
        self.index.write_text("stale API reference", encoding="utf-8")

    def test_success_requires_generated_api_index(self):
        self.set_command(
            "from pathlib import Path\n"
            "Path('docs/typedoc/index.html').write_text('API reference')\n"
        )
        self.assertTrue(self.generate())
        self.assertEqual(self.index.read_text(encoding="utf-8"), "API reference")

    def test_nonzero_exit_fails_without_output(self):
        self.set_command("raise SystemExit(2)\n")
        with self.assertRaisesRegex(ConfigError, "TypeDoc failed with exit code 2"):
            self.generate()

    def test_nonzero_exit_fails_even_with_stale_index(self):
        self.write_stale_index()
        self.set_command("raise SystemExit(2)\n")
        with self.assertRaisesRegex(ConfigError, "TypeDoc failed with exit code 2"):
            self.generate()

    def test_success_without_output_fails(self):
        self.set_command("pass\n")
        with self.assertRaisesRegex(ConfigError, "without generating the API reference"):
            self.generate()

    def test_command_launch_failure_fails(self):
        self.namespace["_typedoc_command"] = lambda: [str(self.root / "missing-command")]
        with self.assertRaisesRegex(ConfigError, "Unable to run TypeDoc"):
            self.generate()

    def test_missing_configuration_fails(self):
        self.config.unlink()
        with self.assertRaisesRegex(ConfigError, "TypeDoc configuration was not found"):
            self.generate()

    def test_missing_tool_fails(self):
        with patch.object(shutil, "which", return_value=None):
            with self.assertRaisesRegex(ConfigError, "TypeDoc is unavailable"):
                self.generate()

    def test_explicit_skip_reuses_existing_index(self):
        self.write_stale_index()
        self.set_command("raise SystemExit(2)\n")
        with patch.dict(os.environ, {"TYPEDOC_SKIP": "1"}):
            self.assertTrue(self.generate())
        self.assertEqual(self.index.read_text(encoding="utf-8"), "stale API reference")

    def test_explicit_skip_allows_missing_output_and_configuration(self):
        self.config.unlink()
        with patch.dict(os.environ, {"TYPEDOC_SKIP": "1"}):
            self.assertFalse(self.generate())


if __name__ == "__main__":
    unittest.main()
