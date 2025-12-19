import importlib.util
import os
import sys
import warnings
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
    "breathe",              # Doxygen + Breathe integration
    "sphinxcontrib.mermaid",  # Mermaid diagrams
    "sphinx.ext.ifconfig",  # Conditional content blocks
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

# -- Options for Breathe/Doxygen --------------------------------------------
# Doxygen XML is expected under docs/xml (relative to repo root)
_doxygen_xml = PROJECT_ROOT / "docs" / "xml"
breathe_projects = {
    "VSCode-Logger": str(_doxygen_xml),
}
breathe_default_project = "VSCode-Logger"
# Default to the JavaScript domain so TypeScript/JS symbols from Doxygen are
# not parsed as C++ declarations by Sphinx.
breathe_default_domain = "js"
# Route TypeScript and JavaScript entities to the JS domain so Breathe does not
# try to interpret them as C++ declarations.
breathe_domain_by_extension = {
    "ts": "js",
    "js": "js",
}

# Expose a flag for the ifconfig directive to avoid hard build failures when
# Doxygen has not been run locally. The CI workflow generates the XML before
# building docs, so this mainly helps local preview builds.
have_doxygen = (_doxygen_xml / "index.xml").exists()

# Map Mermaid fenced blocks to a no-op lexer to silence warnings about the
# language not being known to Pygments when rendering code fences.
lexers["mermaid"] = TextLexer()


def setup(app):
    """Register custom configuration values for Sphinx extensions."""

    # ``ifconfig`` directives rely on config values registered with Sphinx.
    # Provide a default and then set the computed value so cached environments
    # from previous builds reload cleanly even when the value is new.
    app.add_config_value("have_doxygen", False, "env", types=[bool])
    app.config.have_doxygen = have_doxygen

# -- Options for HTML output -------------------------------------------------
html_theme = "furo"
html_static_path = ["_static"]
html_title = "VSCode-Logger Documentation"

# Provide a basic sidebar structure for readability
html_theme_options = {
    "light_logo": "",
    "dark_logo": "",
}
