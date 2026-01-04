# Contributing

Thanks for considering a contribution to the VS Code Extension Template! This repository is designed to be customized, so feel free to adapt these guidelines to fit your own project once you fork or duplicate the template.

## Development workflow

1. Install dependencies with `npm install`.
2. Run `npm run compile` to build the extension into `out/`.
3. Use `npm test` to run unit, integration, coverage, and end-to-end checks.
4. Launch the extension locally by pressing `F5` in VS Code.

## Coding standards

- Keep the extension entry point lean—avoid heavy work during activation.
- Prefer TypeScript with explicit return types.
- Follow the existing ESLint and Prettier rules; run `npm run lint` and `npm run format` before opening a pull request.
- Add or update tests alongside your changes.

## Documentation

Documentation lives in `docs/source/`. Each page includes template sections you can replace with information about your extension. Generate the HTML docs with `make docs` or `npm run docs:typedoc` for API docs.

## Reporting issues

If you discover a problem with the template, open an issue with clear steps to reproduce. Replace this process with your own when building an extension from the template.
