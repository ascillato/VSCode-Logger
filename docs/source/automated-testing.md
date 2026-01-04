# Automated Testing

This project uses a three-layer automated test suite to validate critical behaviors in the extension host and Webview-facing APIs. The tests are written in TypeScript and JavaScript and run under Vitest for unit and integration coverage plus the VS Code Test Runner for end-to-end verification.

## Writing tests

- Export helpers from your modules so they can be imported in unit tests.
- Mock VS Code APIs where possible; use the E2E suite for activation and command wiring.
- Keep tests small and focused; prefer fast unit tests and reserve E2E for critical workflows.

## Test suite layout

- `tests/unit/` — Pure TypeScript utilities (e.g., `buildGreeting`).
- `tests/integration/` — Functions that depend on VS Code types but can run in Node with minimal setup.
- `tests/e2e/` — Runs the compiled extension inside a VS Code instance using `@vscode/test-electron`.

### End-to-end coverage (e2e)
- **Extension activation smoke test** – The VS Code Test Runner launches a real extension host and verifies that activates successfully. This confirms the compiled extension loads, registers its commands, and initializes without runtime errors.

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

The coverage run writes `docs/build/coverage/coverage-summary.json` plus a Markdown summary at `docs/source/_generated/coverage-report.md` that feeds the Code Metrics page in the documentation.
If your system does not expose Python as `python`, ensure `python3` is available in PATH; the coverage script will try `python3` first.

Notes:
- The end-to-end tests compile the extension automatically before launching the VS Code test host (`npm run compile` is embedded in `npm run test:e2e`).
- On Linux, running the full suite in headless environments uses `xvfb-run` in CI; locally you can run tests in a regular shell or wrap the `npm test` command with `xvfb-run -a` if you encounter display issues.

## Continuous integration

The GitHub Actions workflow at `.github/workflows/deploy.yml` runs the test matrix on every push, tag, and non-draft pull request. After linting and building, the **test** job executes `xvfb-run -a npm test`, which runs the unit, integration, and end-to-end suites together. Keeping local runs aligned with this command helps catch issues before opening a pull request.
