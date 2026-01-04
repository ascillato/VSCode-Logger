# Contributing

This document provides guidelines with the intention of making informed, safe and high‑quality contributions to the repository. Follow these instructions to maintain coherence with the existing architecture and to avoid breaking functionality.

## Development workflow

1. Install dependencies with `npm install`.
2. Run `npm run compile` to build the extension into `out/`.
3. Use `npm test` to run unit, integration, coverage, and end-to-end checks.
4. Launch the extension locally by pressing `F5` in VS Code.

## Coding standards

- Keep the extension entry point lean. Avoid heavy work during activation like network calls, etc.
- Prefer TypeScript with explicit return types.
- Prefer small, testable helpers and export them for unit tests.
- Follow the existing ESLint and Prettier rules; run `npm run lint` and `npm run format` before before committing.
- Avoid storing secrets in the repository. Use VS Code Secret Storage in your own code when needed.

## Project layout

- `src/` holds TypeScript sources.
- `media/` is served by Webviews; only reference files with `webview.asWebviewUri`.
- `tests/` contains unit, integration, and end-to-end suites.
- `docs/` stores Sphinx sources and generated artifacts.

## Adding configuration

Use `contributes.configuration` in `package.json` as a template. Add your settings there and read them through `workspace.getConfiguration()` in your code.

## Extending commands

Commands are registered in `src/extension.ts`. Create new commands, export helpers for testing, and document them in `README.md` and `docs/source/detailed-usage.md`.

### Versioning and publishing

* Increment the version in `package.json` following semantic versioning: bump the patch version for bug fixes, minor for backward‑compatible feature additions and major for breaking changes.
* Update the changelog or release notes (if present) whenever you release a new version. Summarize notable changes and migration steps.
* Before publishing to the VS Code Marketplace, run `npm run compile` and ensure the extension packages successfully (e.g., using `vsce package`). Test that all contributed settings and commands appear in the VS Code UI and that secrets are handled correctly.

## Documentation

Documentation lives in `docs/source/`. Each page includes template sections you can replace with information about your extension. Generate the HTML docs with `make docs` or `npm run docs:typedoc` for API docs.
