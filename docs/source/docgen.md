# Documentation Generation

Documentation site.

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

The API reference is generated with TypeDoc and surfaced inside Sphinx. When Sphinx builds the site, it runs TypeDoc (when available) to refresh the `docs/build/typedoc` output so the `api/` section stays up to date.

## Building this documentation

1. Install doc tooling with `pip install -r docs/requirements.txt`.
2. Install Node.js development dependencies with `npm install` to provide the bundled `typedoc` and `cloc` binaries used during the build.
3. Run `npm run lint:docs` to spell-check the Markdown sources.
4. (Optional) Generate the TypeDoc HTML output with `npm run docs:typedoc` (outputs to `docs/build/typedoc`).
5. Build the site with `sphinx-build -b html docs/source docs/build/html` (Sphinx runs TypeDoc and `cloc` when available; set `CLOC_SKIP=1` to skip the metrics report).
6. GitHub Actions publishes the built HTML to the `gh-pages` branch on each push to `main` with tag.
