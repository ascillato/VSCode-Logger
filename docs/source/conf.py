import os
import sys
from datetime import datetime
from pathlib import Path

# -- Path setup --------------------------------------------------------------
# Add project root to sys.path if extensions or autodoc need it in the future.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

# -- Project information -----------------------------------------------------
project = "VSCode-Logger"
author = "VSCode-Logger Contributors"
# Use the current year in the copyright
copyright = f"{datetime.now().year}, {author}"

# -- General configuration ---------------------------------------------------
extensions = [
    "myst_parser",          # Markdown support
    "breathe",              # Doxygen + Breathe integration
    "sphinxcontrib.mermaid"  # Mermaid diagrams
]

# Recognize both Markdown and reStructuredText sources
source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}

# Enable helpful MyST features (colon fences for directives, linkify URLs, etc.)
myst_enable_extensions = [
    "colon_fence",
    "linkify",
    "substitution",
]
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

# -- Options for HTML output -------------------------------------------------
html_theme = "furo"
html_static_path = ["_static"]
html_title = "VSCode-Logger Documentation"

# Provide a basic sidebar structure for readability
html_theme_options = {
    "light_logo": "",
    "dark_logo": "",
}
