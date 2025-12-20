import importlib.util
import os
import shutil
import subprocess
import sys
import warnings
from typing import List, Optional
from datetime import datetime
from pathlib import Path
from sphinx.highlighting import lexers
from pygments.lexers.special import TextLexer

# -- Path setup --------------------------------------------------------------
# Add project root to sys.path if extensions or autodoc need it in the future.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

# -- Project information -----------------------------------------------------
project = "VSCode-Logger"
author = "A. Scillato"
# Use the current year in the copyright
copyright = f"{datetime.now().year}, {author}"

# -- General configuration ---------------------------------------------------
extensions = [
    "myst_parser",          # Markdown support
    "sphinxcontrib.mermaid",  # Mermaid diagrams
    "sphinx.ext.ifconfig",  # Conditional content blocks
    'sphinx_rtd_dark_mode'
]

# generate slug anchors for headings up to this depth
# (2 is enough for ## headings; use 3 if you also want ###, etc.)
myst_heading_anchors = 2

# Recognize both Markdown and reStructuredText sources
source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}

_myst_extensions = [
    "colon_fence",
    "substitution",
]
# Enable linkify automatically when the optional dependency is available so
# local builds without network access can still succeed.
if importlib.util.find_spec("linkify_it"):
    _myst_extensions.append("linkify")
else:
    warnings.warn(
        "linkify-it-py is not installed; MyST linkify support is disabled. "
        "Install linkify-it-py to enable automatic URL linking."
    )

# Enable helpful MyST features (colon fences for directives, optional linkify
# URLs when available, etc.)
myst_enable_extensions = _myst_extensions
# Allow fenced code blocks to render as Mermaid diagrams without directives
myst_fence_as_directive = ["mermaid"]

templates_path = ["_templates"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

# -- Options for TypeDoc -----------------------------------------------------
_typedoc_output = PROJECT_ROOT / "docs" / "typedoc"
_typedoc_index = _typedoc_output / "index.html"
_typedoc_config = PROJECT_ROOT / "typedoc.json"


def _typedoc_command() -> Optional[List[str]]:
    """Return the TypeDoc command to run, or None if not available."""

    local_typedoc = PROJECT_ROOT / "node_modules" / ".bin" / "typedoc"
    if local_typedoc.exists():
        return [str(local_typedoc)]
    if shutil.which("typedoc"):
        return ["typedoc"]
    if shutil.which("npx"):
        return ["npx", "typedoc"]
    return None


def _generate_typedoc() -> bool:
    """Generate TypeDoc output when possible."""

    if os.environ.get("TYPEDOC_SKIP"):
        return False
    if not _typedoc_config.exists():
        return False

    command = _typedoc_command()
    if not command:
        return False

    _typedoc_output.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            command + ["--options", str(_typedoc_config)],
            cwd=PROJECT_ROOT,
            check=False,
        )
    except OSError:
        return False
    return _typedoc_index.exists()


_generate_typedoc()
have_typedoc = _typedoc_index.exists()
_typedoc_output.mkdir(parents=True, exist_ok=True)

# Map Mermaid fenced blocks to a no-op lexer to silence warnings about the
# language not being known to Pygments when rendering code fences.
lexers["mermaid"] = TextLexer()


def setup(app):
    """Register custom configuration values for Sphinx extensions."""

    # ``ifconfig`` directives rely on config values registered with Sphinx.
    # Provide a default and then set the computed value so cached environments
    # from previous builds reload cleanly even when the value is new.
    app.add_config_value("have_typedoc", False, "env", types=[bool])
    app.config.have_typedoc = have_typedoc

# -- Options for HTML output -------------------------------------------------
html_theme = "sphinx_rtd_theme"
html_static_path = ["_static"]
html_css_files = ['css/custom.css']
html_title = "VSCode-Logger Documentation"
html_extra_path = [str(_typedoc_output)]

html_show_sourcelink = False

# Theme configuration: expanded sidebar navigation and dark theme support.
html_theme_options = {
    "collapse_navigation": False,
    "navigation_depth": 4,
    "body_max_width": "100%",
}

# user starts in dark mode
default_dark_mode = True

# Ensure syntax highlighting adapts to the user's theme.
pygments_style = "sphinx"
pygments_dark_style = "native"
