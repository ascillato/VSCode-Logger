import importlib.util
import json
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
DOCS_SOURCE = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(DOCS_SOURCE))

# -- Project information -----------------------------------------------------
project = "VS Code Extension Template"
author = "Template Maintainers"
# Use the current year in the copyright
copyright = f"{datetime.now().year}, {author}"

def _load_package_metadata() -> dict:
    """Load metadata from package.json if available."""

    package_json = PROJECT_ROOT / "package.json"
    try:
        with package_json.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        warnings.warn("Unable to read package.json; version will be omitted.")
        return {}

_package_metadata = _load_package_metadata()
if _package_metadata != {}:
    version = _package_metadata.get("version", "")
    project = project + " - v" + version

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
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store", "_generated/*"]

# -- Options for TypeDoc -----------------------------------------------------
_typedoc_output = PROJECT_ROOT / "docs" / "build" / "typedoc"
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
from coverage_report import generate_coverage_report

# -- Options for cloc --------------------------------------------------------
_cloc_generated_dir = Path(__file__).parent / "_generated"
_cloc_generated_dir.mkdir(parents=True, exist_ok=True)
_cloc_summary_json = _cloc_generated_dir / "cloc-summary.json"
_cloc_files_json = _cloc_generated_dir / "cloc-files.json"
_cloc_report_md = _cloc_generated_dir / "cloc-report.md"
_cloc_excluded_dirs = [
    "node_modules",
    "build",
    "typedoc",
    "out",
    ".git",
    ".venv",
    "dist",
    "coverage",
    ".VSCodeCounter",
    ".vscode-test",
    ".github",
    ".vscode",
]


def _cloc_command() -> Optional[List[str]]:
    """Return the cloc command to run, or None if not available."""

    local_cloc = PROJECT_ROOT / "node_modules" / ".bin" / "cloc"
    if local_cloc.exists():
        return [str(local_cloc)]
    if shutil.which("cloc"):
        return [str(shutil.which("cloc"))]
    if shutil.which("npx"):
        return ["npx", "--yes", "cloc"]
    return None


def _run_cloc(by_file: bool) -> Optional[dict]:
    """Run cloc and return parsed JSON output."""

    command = _cloc_command()
    if not command:
        return None

    args = command + [
        "--json",
        "--quiet",
        f"--exclude-dir={','.join(_cloc_excluded_dirs)}",
    ]
    if by_file:
        args.append("--by-file")
    args.append(str(PROJECT_ROOT))

    try:
        result = subprocess.run(
            args,
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None

    output = result.stdout.strip()
    if not output:
        return None

    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return None


def _format_row(values: List[str]) -> str:
    return "| " + " | ".join(values) + " |"


def _format_cloc_table(
    headers: List[str], rows: List[List[str]], numeric_columns: Optional[set[int]] = None
) -> str:
    """Build a Markdown table."""

    numeric_columns = numeric_columns or set()
    header_line = _format_row(headers)
    separator_cells = []
    for index, _ in enumerate(headers):
        separator_cells.append("---:" if index in numeric_columns else "---")
    separator = _format_row(separator_cells)
    body = "\n".join(_format_row(row) for row in rows)
    return "\n".join([header_line, separator, body])


def _write_placeholder_report(message: str) -> None:
    """Write a placeholder report when cloc data is unavailable."""

    _cloc_report_md.write_text(
        "\n".join(
            [
                "<!-- cloc data unavailable; generated placeholder. -->",
                message,
                "",
            ]
        ),
        encoding="utf-8",
    )


def _write_cloc_report(language_data: dict, file_data: dict) -> None:
    """Write the cloc Markdown report from parsed JSON data."""

    language_rows = []
    for language, stats in language_data.items():
        if language in {"header", "SUM"} or not isinstance(stats, dict):
            continue
        language_rows.append(
            [
                language,
                f"{stats.get('nFiles', 0):,}",
                f"{stats.get('blank', 0):,}",
                f"{stats.get('comment', 0):,}",
                f"{stats.get('code', 0):,}",
            ]
        )
    language_rows.sort(key=lambda row: int(row[4].replace(",", "")), reverse=True)

    file_rows = []
    for path, stats in file_data.items():
        if path in {"header", "SUM"} or not isinstance(stats, dict):
            continue
        relative_path = path
        try:
            relative_path = str(Path(path).resolve().relative_to(PROJECT_ROOT))
        except ValueError:
            relative_path = path
        file_rows.append(
            [
                relative_path,
                stats.get("language", ""),
                f"{stats.get('blank', 0):,}",
                f"{stats.get('comment', 0):,}",
                f"{stats.get('code', 0):,}",
            ]
        )
    file_rows.sort(key=lambda row: row[0].lower())
    file_rows = [[f"`{row[0]}`", *row[1:]] for row in file_rows]

    language_table = _format_cloc_table(
        ["Language", "Files", "Blank", "Comment", "Code"],
        language_rows,
        numeric_columns={1, 2, 3, 4},
    )
    file_table = _format_cloc_table(
        ["File", "Language", "Blank", "Comment", "Code"],
        file_rows,
        numeric_columns={2, 3, 4},
    )

    header = language_data.get("header", {})
    version = header.get("cloc_version", "unknown")
    elapsed = header.get("elapsed_seconds")
    elapsed_text = (
        f"in {elapsed:.2f} seconds" if isinstance(elapsed, (int, float)) else ""
    )

    _cloc_report_md.write_text(
        "\n".join(
            [
                "<!-- Automatically generated by Sphinx; do not edit manually. -->",
                f"Generated with `cloc` {version} {elapsed_text}.",
                "",
                "## Lines by language",
                language_table,
                "",
                "## Lines by file",
                file_table,
                "",
            ]
        ),
        encoding="utf-8",
    )


def _generate_cloc_reports() -> bool:
    """Generate cloc reports used in the documentation."""

    if os.environ.get("CLOC_SKIP"):
        _write_placeholder_report("`cloc` was skipped because CLOC_SKIP is set.")
        return False

    language_data = _run_cloc(by_file=False)
    file_data = _run_cloc(by_file=True)

    if not language_data or not file_data:
        _write_placeholder_report(
            "Code metrics are unavailable because `cloc` could not produce data."
        )
        return False

    _cloc_generated_dir.mkdir(parents=True, exist_ok=True)
    _cloc_summary_json.write_text(
        json.dumps(language_data, indent=2),
        encoding="utf-8",
    )
    _cloc_files_json.write_text(
        json.dumps(file_data, indent=2),
        encoding="utf-8",
    )
    _write_cloc_report(language_data, file_data)
    return True


have_cloc_report = _generate_cloc_reports()
_coverage_report_md = _cloc_generated_dir / "coverage-report.md"
have_coverage_report = generate_coverage_report(
    PROJECT_ROOT, _coverage_report_md, fail_on_missing=False
)


def setup(app):
    """Register custom configuration values for Sphinx extensions."""

    # ``ifconfig`` directives rely on config values registered with Sphinx.
    # Provide a default and then set the computed value so cached environments
    # from previous builds reload cleanly even when the value is new.
    app.add_config_value("have_typedoc", False, "env", types=[bool])
    app.config.have_typedoc = have_typedoc
    app.add_config_value("have_cloc_report", False, "env", types=[bool])
    app.config.have_cloc_report = have_cloc_report
    app.add_config_value("have_coverage_report", False, "env", types=[bool])
    app.config.have_coverage_report = have_coverage_report
    app.connect("build-finished", _copy_typedoc_output)


def _copy_typedoc_output(app, exception):
    """Copy TypeDoc output into the built HTML tree."""

    if exception or not _typedoc_index.exists():
        return

    output_dir = Path(app.builder.outdir) / "typedoc"
    try:
        shutil.copytree(_typedoc_output, output_dir, dirs_exist_ok=True)
    except OSError:
        warnings.warn("Failed to copy TypeDoc output into the Sphinx build.")

# -- Options for HTML output -------------------------------------------------
html_theme = "sphinx_rtd_theme"
html_static_path = ["_static"]
html_css_files = ['css/custom.css']
html_title = "VSCode-Logger Documentation"

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
