# Code Metrics

We generate a repository-wide code line count during the documentation build using
[`cloc`](https://github.com/AlDanial/cloc). The invocation excludes generated outputs
and dependency directories to keep the results focused on source and documentation
files. Both a language-level summary and a per-file breakdown are produced.

The report is refreshed automatically when you run `sphinx-build` (set `CLOC_SKIP=1`
to opt out). To make sure `cloc` is available, install the Node.js development
dependencies with `npm install` from the repository root.

```{include} _generated/cloc-report.md
:relative-images:
```
