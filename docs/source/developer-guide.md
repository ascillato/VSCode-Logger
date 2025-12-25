# Developer Setup and Workflow

Embedded Device Logger welcomes contributions from the community. Please review the [CONTRIBUTING guide](../../CONTRIBUTING.md) before opening a pull request.

## Source code and documentation

- Repository: https://github.com/ascillato/VSCode-Logger
- Architecture and docs site: https://ascillato.github.io/VSCode-Logger/index.html

## Build and run from source

1. Clone the repository.
2. Install dependencies and compile:
   ```bash
   npm install
   npm run compile
   ```
3. Launch the Extension Development Host with `F5` in VS Code and open the **Embedded Logger** view.

## Packaging and installation

- Generate a VSIX (requires `@vscode/vsce`):
  ```bash
  make package
  ```
- Install the generated package locally:
  ```bash
  make install
  ```

## Cleaning and rebuilding

```bash
make clean
make package
make install
```

Or run everything at once:
```bash
make all
```

## Linting and formatting

Install lint dependencies and run checks:
```bash
npm install --save-dev eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-config-prettier eslint-plugin-prettier
make check
```

## Documentation

Install Python requirements and build the docs:
```bash
pip install -r docs/requirements.txt
make docs
```
The generated HTML lives at `docs/build/html/index.html`.

Continuous integration builds and publishes the site from `main` to `gh-pages`.

## How to contribute

- Open issues for bug reports or feature requests.
- Submit pull requests with clear descriptions and tests where applicable.
- Follow the coding and security practices outlined in [CONTRIBUTING](../../CONTRIBUTING.md).
