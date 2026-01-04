# VS Code Extension Template

This repository is a minimal, batteries-included starting point for building Visual Studio Code extensions with TypeScript. It keeps the build pipeline, linting, automated tests, and documentation wiring in place while leaving the extension logic intentionally small so you can replace it with your own features.

## What is included?

- **Sample commands** (`extension-template.sayHello` and `extension-template.showWelcomePanel`) that demonstrate command registration and a basic Webview panel.
- **TypeScript toolchain** with ESLint, Prettier, Vitest, and TypeDoc ready to run.
- **End-to-end harness** powered by `@vscode/test-electron` to validate activation.
- **Documentation pipeline** using Sphinx and TypeDoc so you can publish API docs and project guides.
- **CI helpers and Makefile** to keep formatting, linting, packaging, and docs generation repeatable.

## Getting started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Run the sample extension**

   - Press `F5` in VS Code to launch a development host.
   - Run the `Extension Template: Say Hello` command from the Command Palette.
   - Open the `Extension Template: Open Welcome Panel` command to see the sample Webview content.

3. **Replace the template code**

   - Update `src/extension.ts` with your activation logic and commands.
   - Swap out `src/welcomePanel.ts` and the assets under `media/` to build your own UI.
   - Change `package.json` fields (name, display name, publisher, repository, activation events, and contributed settings) to match your project.

## Scripts

These scripts are defined in `package.json`:

- `npm run compile` – build the extension into `out/`.
- `npm test` – run coverage, generate the coverage summary, and execute E2E tests.
- `npm run lint` / `npm run lint:fix` – lint the codebase.
- `npm run format` / `npm run format:check` – apply or verify Prettier formatting.
- `npm run docs:typedoc` – generate API documentation into `docs/typedoc`.
- `npm run lint:docs` – spell-check Markdown files and docs sources.
- `npm run test:e2e` – run the VS Code integration tests via `@vscode/test-electron`.

## Contributing your own extension

- Use `typedoc.json` to customize API doc output for your project.
- Update the docs under `docs/source/` to describe your extension’s features. Each file includes template sections you can replace.
- Adjust the tests in `tests/unit`, `tests/integration`, and `tests/e2e` to cover your extension behavior.
- Swap the sample settings under `contributes.configuration` with your own configuration schema.

## License

MIT — see [LICENSE](LICENSE).
