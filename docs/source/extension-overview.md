# Architecture Overview

This template keeps only the minimal pieces you need to bootstrap a TypeScript VS Code extension. The shipped code is intentionally small so you can replace it with your own logic.

## Structure

- **`src/extension.ts`** — entry point that registers two sample commands.
- **`src/greeting.ts`** — a tiny utility showing how to read configuration values.
- **`src/welcomePanel.ts`** — a Webview example with Content Security Policy wiring and message passing.
- **`media/`** — static assets used by the Webview sample (CSS today; add JS or images as needed).
- **`tests/`** — Vitest suites for unit and integration checks, plus an end-to-end harness driven by `@vscode/test-electron`.

## How to adapt

1. Replace the sample commands with your own features and adjust `activationEvents` and `contributes.commands` in `package.json`.
2. Swap the greeting helper for real configuration handling or remove it entirely.
3. Rework the Webview HTML and styles to match your UX.
4. Expand the tests to cover your extension behavior.

Use this document as a quick map for new contributors to find the starting points in your customized project.
