# VSCode-Logger Documentation Generation

Welcome to the VSCode-Logger documentation site. This extension streams logs from embedded Linux devices over SSH into Visual Studio Code, providing filtering, highlighting, presets, and exporting. These pages collect architecture notes, user guidance, and generated API references.

## Diagrams

Mermaid diagrams in Markdown work with fenced code blocks. For example:

<code>```mermaid</code>
```
:zoom: 100%
graph LR
    A[Device configured] --> B[Open log panel]
    B --> C{SSH stream}
    C --> D[Log lines rendered]
```
<code>```</code>

will render as:

```mermaid
:zoom: 100%
graph LR
    A[Device configured] --> B[Open log panel]
    B --> C{SSH stream}
    C --> D[Log lines rendered]
```

## API reference

The API reference is generated with TypeDoc and surfaced inside Sphinx. When Sphinx builds the site, it runs TypeDoc (when available) to refresh the `docs/typedoc` output so the `api/` section stays up to date.

## Building this documentation

1. Ensure Node.js and npm are available. For Python, either install Python 3.12 or newer, or install `uv` so the docs build can provision Python 3.12 automatically.
2. Run `make docs`. The target installs Node.js dependencies, installs `docs/requirements.txt` with a Python 3.12 interpreter when available, otherwise falls back to `uv run --python 3.12`, then runs `npm run lint:docs` and builds `docs/build/html` with `python -m sphinx`.
3. (Optional) Generate the TypeDoc HTML output separately with `npm run docs:typedoc` (outputs to `docs/typedoc`).
4. GitHub Actions publishes the built HTML to the `gh-pages` branch on each push to `main` with tag.
