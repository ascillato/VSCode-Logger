# Code Metrics

The following repository-wide code line count report is generated automatically during the documentation build using [`cloc`](https://github.com/AlDanial/cloc). The report excludes generated outputs and dependency directories to keep the results focused on source and documentation files. Both a language-level summary and a per-file breakdown are produced.

This report is refreshed automatically on every docs build.

```{include} _generated/cloc-report.md
:relative-images:
```

## Test coverage

The coverage summary is generated automatically when running the test suite (for example, via `npm test` or `make test`) and exported into the documentation metrics.

:::{ifconfig} have_coverage_report
```{include} _generated/coverage-report.md
:relative-images:
```
:::

:::{ifconfig} not have_coverage_report
Coverage results are not available yet. Run `npm test` locally to refresh coverage data before rebuilding the docs.
:::
