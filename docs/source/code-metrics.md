# Code Metrics

This template keeps optional helpers for generating code statistics so you can track growth as you build your extension.

## cloc reports

If `cloc` is installed (either globally or via `npm install`), running the Sphinx build will generate summary files in `docs/source/_generated/`:

- `cloc-summary.json`
- `cloc-files.json`
- `cloc-report.md`

These files are ignored by version control and regenerated on demand.

## Coverage summary

`npm run coverage:report` creates `docs/source/_generated/coverage-report.md` from the Vitest coverage output. Link to this file from your docs or CI reports to keep an eye on test completeness.

Feel free to remove or extend this section depending on the metrics you want to track in your project.
