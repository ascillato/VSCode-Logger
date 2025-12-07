# Generating documentation with Sphinx and Mermaid

The project documentation is now built with **Sphinx** so that Markdown content and Mermaid diagrams render without requiring a newer Doxygen release. Mermaid diagrams render directly in HTML output using the `sphinxcontrib-mermaid` extension—no Mermaid CLI binary is required.

## Prerequisites

1. Ensure Python 3.10+ is available.
2. Install the documentation dependencies:

   ```bash
   pip install -r docs/requirements.txt
   ```

## Building the docs

1. From the repository root, run Sphinx to generate HTML:

   ```bash
   sphinx-build -M html docs docs/_build
   ```

   The `docs/_build/html` directory will contain the generated site.
2. Open `docs/_build/html/index.html` in a browser to view the pages, including the Mermaid diagrams from `docs/extension-overview.md`.

## Notes on Mermaid diagrams

- Diagrams are authored with fenced code blocks using the `mermaid` language, which Sphinx renders at build time via `sphinxcontrib-mermaid` and the embedded Mermaid JS runtime.
- No additional npm packages are required for documentation builds. If you already installed `@mermaid-js/mermaid-cli`, it is not used by this pipeline.
