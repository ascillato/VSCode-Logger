# Developer Workflow

Use this guide after cloning the template or after you have customized it for your own extension.

## Prerequisites

- Node.js and npm
- VS Code with the Extension Development Host capability
- Python (for building the Sphinx docs)

## Build and run

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host that loads the compiled extension from `out/`.

## Common tasks

- **Package the extension**: `make package`
- **Install the built VSIX**: `make install` or `make force-install`
- **Clean artifacts**: `make clean`
- **Generate docs**: `make docs`

When you adapt the template, update these commands to fit your workflow if necessary.

## Pull requests

1. Branch from `main` (or your chosen default).
2. Make focused commits with clear messages.
3. Run linting, tests, and docs checks locally.
4. Open a PR with a summary of the changes and any follow-up tasks.
