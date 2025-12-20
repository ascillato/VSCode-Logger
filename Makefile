# Makefile for packaging the Extension and building the docs

.PHONY: all clean install help check package package-clean docs docs-clean

all: clean package docs ## Clean, then build VSIX package and docs

clean: package-clean docs-clean ## Remove all generated files (package + docs)

check: ## Linting and type checking
	npm install
	npm run lint
	npm run format:check

package: ## Install deps, compile, and create the .vsix package
	npm install
	npm run compile
	vsce package

package-clean: ## Remove node_modules, build outputs, and generated .vsix
	rm -rf node_modules out *.vsix

docs: ## Build documentation (TypeDoc + Sphinx HTML)
	npm install
	sphinx-build -b html docs/source docs/build/html

docs-clean: ## Remove generated documentation outputs
	rm -rf docs/build docs/html docs/typedoc

install: ## Install the first .vsix found in the current directory
	@set -e; \
	vsix="$$(find . -maxdepth 1 -type f -name '*.vsix' -print | sort | head -n 1)"; \
	if [ -z "$$vsix" ]; then \
		echo "ERROR: No .vsix file found in the current directory. Run 'make package' first."; \
		exit 1; \
	fi; \
	echo "Installing extension: $$vsix"; \
	code --install-extension "$$vsix"

help: ## Show this help
	@echo "Usage: make <target>"; \
	echo ""; \
	echo "Targets:"; \
	awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9][a-zA-Z0-9_.-]*:.*##/ {printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
