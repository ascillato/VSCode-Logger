# Code Metrics

## Lines of Code

The following repository-wide code line count report is generated automatically during the documentation build using [`cloc`](https://github.com/AlDanial/cloc). The report excludes generated outputs and dependency directories to keep the results focused on source and documentation files. Both a language-level summary and a per-file breakdown are produced.

This report is refreshed automatically on every docs build.

```{include} _generated/cloc-report.md
:relative-images:
```

--------

## Code Complexity

Complexity metrics are generated during the documentation build using a TypeScript and JavaScript parser. The report covers `.ts` and `.js` files under the repository (excluding build outputs) and includes:

- Cyclomatic complexity (decision points and boolean operators)
- Halstead complexity measures (volume, difficulty, effort, bugs, time)
- Maintainability index (standard formula using LOC, Halstead volume, and cyclomatic complexity which translates to time for developer onboarding and for code reviews)
- Cognitive complexity (nesting-aware approximation)
- Depth of inheritance (in-repo inheritance depth)
- Coupling between objects (unique type references and `new` expressions per class)

Why bother? These metrics help you:

- Catch potential bugs early
- Make code easier to understand and maintain
- Save time and money long-term

Here's a quick comparison:

| Metric                | Measures                    | Why It Matters               |
| --------------------- | --------------------------- | ---------------------------- |
| Cyclomatic Complexity | Code paths                  | Higher = harder to test      |
| LOC                   | Code size                   | Bigger isn't always better   |
| Maintainability Index | Ease of maintenance         | Higher = easier to work with |
| Cognitive Complexity  | Mental effort to understand | Lower = more readable        |

### Benefits of Tracking Code Complexity

Tracking complexity offers key advantages:

#### Improved Software Quality

Teams can:

- Spot potential bug hotspots
- Cut error risk
- Boost code readability

#### Cost-Effective Maintenance

Complex code often means:

- Longer debugging
- Tough updates
- Hard onboarding

Tracking helps teams:

- Find refactoring targets
- Streamline maintenance
- Cut long-term costs

#### Better Resource Allocation

Complexity metrics guide teams in:

- Prioritizing refactoring
- Allocating testing resources
- Planning code reviews

#### Enhanced Team Collaboration

Complexity metrics provide:

- A shared language for code quality
- Objective measures for reviews
- Clear improvement goals

#### Proactive Risk Management

Teams can:

- Prevent technical debt buildup
- Catch security issues early
- Address scalability problems

A study of 12,000+ projects found quality issues caused over 20% of failures. Tracking complexity helps avoid these pitfalls.

#### Quantifiable Quality Standards

Teams can:

- Set clear benchmarks
- Measure progress
- Compare solutions objectively

--------

### Code Complexity Report

:::{ifconfig} have_complexity_report
```{include} _generated/complexity-report.md
:relative-images:
```
:::

:::{ifconfig} not have_complexity_report
Complexity metrics are not available yet. Run the docs build after installing Node dependencies to refresh the report.
:::

--------

## Test Coverage

The coverage summary is generated automatically when running the test suite (for example, via `npm test` or `make test`) and exported into the documentation metrics.

The target is to reach more than 80 percent of code being tested per file.

:::{ifconfig} have_coverage_report
```{include} _generated/coverage-report.md
:relative-images:
```
:::

:::{ifconfig} not have_coverage_report
Coverage results are not available yet. Run `npm test` locally to refresh coverage data before rebuilding the docs.
:::
