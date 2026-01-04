from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Iterable

_COVERAGE_METRICS = ("lines", "statements", "functions", "branches")


def _format_table(
    headers: list[str],
    rows: list[list[str]],
    numeric_columns: Iterable[int] | None = None,
) -> str:
    """Build a Markdown table with optional numeric column alignment."""

    numeric_columns = set(numeric_columns or [])
    header_line = "| " + " | ".join(headers) + " |"
    separator_cells = []
    for index, _ in enumerate(headers):
        separator_cells.append("---:" if index in numeric_columns else "---")
    separator = "| " + " | ".join(separator_cells) + " |"
    body = "\n".join("| " + " | ".join(row) + " |" for row in rows)
    return "\n".join([header_line, separator, body])


def _format_coverage_cell(stat: Any) -> str:
    """Return a human-readable coverage cell like '85.0% (17/20)'."""

    if not isinstance(stat, dict):
        return "—"

    covered = stat.get("covered")
    total = stat.get("total")
    percentage = stat.get("pct")

    if isinstance(covered, (int, float)) and isinstance(total, (int, float)):
        pct_value = (
            float(percentage)
            if isinstance(percentage, (int, float))
            else (covered / total * 100 if total else 0.0)
        )
        return f"{pct_value:.1f}% ({int(covered)}/{int(total)})"

    return "—"


def _write_placeholder(output_path: Path, message: str) -> None:
    """Write a placeholder coverage report."""

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        "\n".join(
            [
                "<!-- Coverage data unavailable; generated placeholder. -->",
                message,
                "",
            ]
        ),
        encoding="utf-8",
    )


def generate_coverage_report(
    project_root: Path, output_path: Path, *, fail_on_missing: bool = False
) -> bool:
    """
    Generate a Markdown coverage report from coverage-summary.json.

    Args:
        project_root: Path to the repository root containing the coverage folder.
        output_path: Destination Markdown file path.
        fail_on_missing: When True, return False if coverage data cannot be read.

    Returns:
        True when coverage data was written, False when a placeholder was emitted.
    """

    summary_path = project_root / "docs" / "build" / "coverage" / "coverage-summary.json"
    try:
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        _write_placeholder(
            output_path,
            f"Coverage summary not found at `{summary_path}`. Run `npm test` to generate coverage data.",
        )
        return False

    total_stats = summary.get("total")
    if not isinstance(total_stats, dict):
        _write_placeholder(
            output_path,
            "Coverage summary was missing the `total` coverage block; coverage results could not be rendered.",
        )
        return False

    overview_rows: list[list[str]] = []
    for metric in _COVERAGE_METRICS:
        overview_rows.append(
            [metric.title(), _format_coverage_cell(total_stats.get(metric))]
        )
    overview_table = _format_table(
        ["Metric", "Coverage"], overview_rows, numeric_columns=[1]
    )

    file_rows: list[list[str]] = []
    for path_key, stats in summary.items():
        if path_key == "total" or not isinstance(stats, dict):
            continue
        relative_path = path_key
        try:
            relative_path = str(Path(path_key).resolve().relative_to(project_root))
        except ValueError:
            relative_path = path_key
        file_rows.append(
            [
                f"`{relative_path}`",
                _format_coverage_cell(stats.get("lines")),
                _format_coverage_cell(stats.get("statements")),
                _format_coverage_cell(stats.get("functions")),
                _format_coverage_cell(stats.get("branches")),
            ]
        )
    file_rows.sort(key=lambda row: row[0].lower())

    file_table = _format_table(
        ["File", "Lines", "Statements", "Functions", "Branches"],
        file_rows,
        numeric_columns=[1, 2, 3, 4],
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        "\n".join(
            [
                "<!-- Automatically generated coverage summary; do not edit manually. -->",
                "Generated from `docs/build/coverage/coverage-summary.json`.",
                "",
                "## Overall coverage",
                overview_table,
                "",
                "## Coverage by file",
                file_table if file_rows else "Coverage details were not available.",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return True


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate Markdown coverage metrics from coverage-summary.json."
    )
    parser.add_argument(
        "--allow-missing",
        action="store_true",
        help="Exit successfully even when coverage data is unavailable.",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    project_root = Path(__file__).resolve().parents[2]
    output_dir = Path(__file__).parent / "_generated"
    output_file = output_dir / "coverage-report.md"

    success = generate_coverage_report(
        project_root, output_file, fail_on_missing=not args.allow_missing
    )
    if not success and not args.allow_missing:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
