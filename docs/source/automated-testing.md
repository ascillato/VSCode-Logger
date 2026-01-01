# Automated Testing

This project uses a three-layer automated test suite to validate critical behaviors in the extension host and Webview-facing APIs. The tests are written in TypeScript and JavaScript and run under Vitest for unit and integration coverage plus the VS Code Test Runner for end-to-end verification.

## What is covered

### New unit and integration tests
- **PasswordManager flows (unit)** – Exercises cached password reuse, legacy secret migration, and the interactive prompt path using the VS Code mock layer in `tests/mocks/vscode`. These cases ensure stored credentials are reused without re-prompting, migrated secrets are cleaned up after confirmation, and fresh prompts occur when no secret exists.
- **SshCommandRunner execution (unit)** – Uses the mock SSH client factory in `tests/mocks/ssh` to validate that commands are trimmed, rejected when they include control characters, and surface remote stderr/exit codes through `SshCommandError`. This protects against command injection and makes error handling predictable for the UI.
- **LogSession streaming (integration)** – Spins up a mocked SSH client to feed log data and status events through the `LogSession` lifecycle. It asserts that complete lines are emitted, host fingerprints are persisted back into the device configuration, and the session closes cleanly after the stream ends.

### End-to-end coverage
- **Extension activation smoke test** – The VS Code Test Runner launches a real extension host and verifies that `Scallant.embedded-device-logger` activates successfully. This confirms the compiled extension loads, registers its commands, and initializes without runtime errors.

## Running tests locally

1. Install dependencies if you have not already:
   ```bash
   npm install
   ```
2. Run the full suite (unit, integration, and end-to-end):
   ```bash
   npm test
   ```
3. Run individual stages when iterating:
   ```bash
   npm run test:unit
   npm run test:integration
   npm run test:e2e
   ```
4. Collect coverage without running the end-to-end suite:
   ```bash
   npm run test:coverage
   npm run coverage:report
   ```

The coverage run writes `coverage/coverage-summary.json` plus a Markdown summary at `docs/source/_generated/coverage-report.md` that feeds the Code Metrics page in the documentation.

Notes:
- The end-to-end tests compile the extension automatically before launching the VS Code test host (`npm run compile` is embedded in `npm run test:e2e`).
- On Linux, running the full suite in headless environments uses `xvfb-run` in CI; locally you can run tests in a regular shell or wrap the `npm test` command with `xvfb-run -a` if you encounter display issues.

## Continuous integration

The GitHub Actions workflow at `.github/workflows/deploy.yml` runs the test matrix on every push, tag, and non-draft pull request. After linting and building, the **test** job executes `xvfb-run -a npm test`, which runs the unit, integration, and end-to-end suites together. Keeping local runs aligned with this command helps catch issues before opening a pull request.
