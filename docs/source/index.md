# VSCode-Logger Documentation

Welcome to the VSCode-Logger documentation site. This extension streams logs from embedded Linux devices over SSH into Visual Studio Code, providing filtering, highlighting, presets, and exporting. These pages collect architecture notes, user guidance, and generated API references.

## Getting started

- Install dependencies with `npm install`.
- Compile the extension via `npm run compile`.
- Launch the extension in VS Code using `F5` to open a development host.
- Configure devices under the `embeddedLogger.devices` setting, then open the **Embedded Logger** view from the activity bar.

```{toctree}
:maxdepth: 2
:caption: Contents

user-guide
api/index
```

## Diagrams

Mermaid diagrams in Markdown work with fenced code blocks. For example:

```mermaid
graph LR
    A[Device configured] --> B[Open log panel]
    B --> C{SSH stream}
    C --> D[Log lines rendered]
```

## API reference

The API reference is generated from Doxygen XML via Breathe. Run `doxygen Doxyfile` before building Sphinx so the `api/` section can render the latest symbols.

## Building this documentation

1. Install doc tooling with `pip install -r docs/requirements.txt`.
2. Generate XML output for Breathe using `doxygen Doxyfile` (outputs to `docs/xml`).
3. Build the site with `sphinx-build -b html docs/source docs/build/html`.
4. GitHub Actions publishes the built HTML to the `gh-pages` branch on each push to `main`.
