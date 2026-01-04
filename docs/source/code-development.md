# Working on the Codebase

This page outlines how to extend the template safely once you start building your own VS Code extension.

## Coding guidelines

- Keep activation fast—do not perform heavy network calls in `activate`.
- Prefer small, testable helpers and export them for unit tests.
- Use the existing ESLint and Prettier configuration; run `npm run lint` and `npm run format:check` before committing.
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
