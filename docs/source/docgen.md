# Documentation Generation

The template provides two documentation paths:

1. **Sphinx site** — built from the Markdown files under `docs/source/`.
2. **TypeDoc API docs** — generated from the TypeScript sources using `typedoc.json`.

## Building docs locally

```bash
pip install -r docs/requirements.txt
npm install
make docs
```

This runs `cspell` for spell checking, builds the Sphinx site into `docs/build/html`, and writes TypeDoc output to `docs/typedoc`.

## Customizing

- Edit `docs/source/*.md` to describe your extension’s features and workflows.
- Update `typedoc.json` to adjust the API doc title or entry points.
- Configure deployment (e.g., GitHub Pages) in your own CI pipeline to publish the generated HTML.
