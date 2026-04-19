# Automated Testing

This repository uses three automated test layers:

- Unit tests for focused module behavior with mocked VS Code and SSH dependencies
- Integration tests for extension-host workflows that cross module boundaries
- End-to-end tests that launch a real VS Code extension host through `@vscode/test-electron`

The current test commands are defined in `package.json`, the Vitest configuration lives in `vitest.config.ts`, and the VS Code test launcher lives under `tests/e2e`.

## Current test layout

### Unit tests

Unit tests live in `tests/unit` and currently cover:

- configuration normalization and inherited defaults
- device manager behavior
- device ping helpers
- device tree rendering and refresh behavior
- extension command handlers for passwords, SFTP preset migration, and web browser actions
- log panel host behavior, auto-save lifecycle, and Webview message parsing
- log session orchestration, connection management, fingerprint persistence, SSH authentication resolution, and host key verification
- logger panel and sidebar Webview messaging, refresh payloads, clipboard actions, and command routing
- password storage and migration
- SFTP explorer panel state, seeded test-mode flows, search snapshots, preset persistence, and reconnect countdown behavior
- SFTP search command compilation and validation
- SSH command runner validation and execution
- SSH terminal session lifecycle, reconnect handling, and initial command or script execution
- workspace-backed log panel state storage

Most of these tests run against the lightweight mock layers in [tests/mocks/vscode.ts](../../tests/mocks/vscode.ts) and [tests/mocks/ssh.ts](../../tests/mocks/ssh.ts).

### Integration tests

Integration tests live in `tests/integration` and currently exercise:

- `LogSession` streaming, status updates, connection settings, and host fingerprint persistence
- `SidebarViewProvider` flows that open devices, run commands, and publish grouped device and ping metadata to the sidebar Webview

These tests still use mocks, but they intentionally validate multi-module behavior instead of isolated helper functions.

### End-to-end tests

End-to-end tests live in `tests/e2e/suite` and run in a real VS Code test host.

They currently verify:

- extension activation succeeds in the packaged extension host
- the SFTP explorer test surface responds correctly to keyboard navigation and actions such as quick search, selection movement, delete, rename, duplicate, pane switching, folder navigation, and find dialog preview/submission

The E2E runner uses Mocha to collect `*.test.js` files and is launched through [tests/e2e/runTest.js](../../tests/e2e/runTest.js).

## Test commands

Install dependencies first:

```bash
npm install
```

Run the full automated suite:

```bash
npm test
```

That command executes:

1. `npm run test:coverage`
2. `npm run coverage:report`
3. `npm run test:e2e`

Run individual stages while iterating:

```bash
npm run test:unit
npm run test:integration
npm run test:coverage
npm run coverage:report
npm run test:e2e
```

Related validation commands commonly used before a pull request:

```bash
npm run compile
npm run lint
npm run lint:docs
```

## Coverage behavior

Coverage is collected by Vitest with the V8 provider using the configuration in [vitest.config.ts](../../vitest.config.ts).

Current coverage settings:

- include `src/**/*.ts`
- exclude tests, generated output, docs, dependency directories, declaration files, and type-only modules
- generate `text`, `json-summary`, and `lcov` reports

The coverage goal is at least 80% per runtime source file. Type-only files such as `.d.ts` files and `src/**/types.ts` are excluded because they do not emit executable runtime code and cannot be meaningfully covered by tests.

Running `npm run test:coverage` produces artifacts under `coverage/`, including:

- `coverage/coverage-summary.json`
- `coverage/lcov.info`

Running `npm run coverage:report` converts the JSON summary into the Markdown report at `docs/source/_generated/coverage-report.md`, which is then consumed by the documentation site. The generated report includes coverage percentage spans that the documentation theme can style as low, medium, or high coverage.

The coverage report command tries `python3` first and then falls back to `python`:

```bash
python3 docs/source/coverage_report.py || python docs/source/coverage_report.py
```

Note that the E2E suite is not part of the Vitest coverage report. Coverage currently reflects the TypeScript test files matched by Vitest under `tests/**/*.test.ts`, which means unit and integration tests contribute to coverage and the JavaScript E2E specs do not.

## Build and runtime notes

- `npm run test:e2e` always runs `npm run compile` first, so the extension host is tested against a fresh bundle in `out/extension.js`.
- Vitest runs in a Node environment with globals enabled.
- The E2E harness patches a stream validation helper in `@vscode/test-electron` before launching the VS Code test host, matching the current runner implementation.

## Continuous integration

The CI workflow is defined in [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml).

On non-draft pull requests, pushes to `main`, tags, and manual dispatches, CI currently runs:

1. `npm run lint`
2. `npm run format:check`
3. `npm run compile`
4. `xvfb-run -a npm test`

The test job uploads these generated artifacts:

- `coverage/coverage-summary.json`
- `docs/source/_generated/coverage-report.md`

The documentation job downloads those artifacts before building the docs site, so keeping local coverage generation aligned with CI avoids stale documentation output.

On Linux CI runners, `xvfb-run -a` is used for the full suite because the VS Code E2E host needs a display server. If you run the full suite in a headless local environment, use the same wrapper.
