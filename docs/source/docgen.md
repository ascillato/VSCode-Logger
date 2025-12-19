# Documentation Generation

Use these steps to generate the documentation site locally.

1. Install the Python dependencies: `pip install -r docs/requirements.txt`.
2. Generate the Doxygen XML output: `doxygen Doxyfile` (outputs to `docs/xml`).
3. Build the HTML site: `sphinx-build -b html docs/source docs/build/html`.

The API reference renders the Doxygen XML through Breathe, so ensure the
Doxygen step completes before building Sphinx.
