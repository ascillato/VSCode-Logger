# Automated Testing

The template includes example tests to demonstrate how to validate a VS Code extension.

## Test suite layout

- `tests/unit/` — Pure TypeScript utilities (e.g., `buildGreeting`).
- `tests/integration/` — Functions that depend on VS Code types but can run in Node with minimal setup.
- `tests/e2e/` — Runs the compiled extension inside a VS Code instance using `@vscode/test-electron`.

## Running tests

```bash
npm test            # run coverage + coverage report + e2e
npm run test:unit   # unit tests only
npm run test:integration
npm run test:e2e
```

Coverage output is written to the `coverage/` folder. A Markdown summary is generated at `docs/source/_generated/coverage-report.md` via `npm run coverage:report`.

## Writing your own tests

- Export helpers from your modules so they can be imported in unit tests.
- Mock VS Code APIs where possible; use the E2E suite for activation and command wiring.
- Keep tests small and focused; prefer fast unit tests and reserve E2E for critical workflows.
