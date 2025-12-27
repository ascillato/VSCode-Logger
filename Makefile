# Makefile for packaging the Extension and building the docs

YELLOW=\033[1;33m
RED=\033[1;31m
GREEN=\033[1;32m
RESET=\033[0m

.PHONY: all clean install help check package package-clean docs docs-clean

all: clean package install ## Clean, then build VSIX package and installs it

clean: package-clean docs-clean ## Remove all generated files (package + docs)

check: ## Linting and type checking
	@ts=""; \
	if npm install && npm run lint && npm run format:check; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(GREEN)\n\nCheck target completed at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError running check target. %s\n\n$(RESET)\n" "$$ts"; \
		exit 1; \
	fi

package: ## Install deps, compile, and create the .vsix package
	@ts=""; \
	if npm install && npm run compile && vsce package; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(GREEN)\n\nPackage target completed at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError running package target. %s\n\n$(RESET)\n" "$$ts"; \
		exit 1; \
	fi

package-clean: ## Remove node_modules, build outputs, and generated .vsix
	@ts=""; \
	if rm -rf node_modules out *.vsix; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(GREEN)\n\nPackage-clean target completed at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError running package-clean target. %s\n\n$(RESET)\n" "$$ts"; \
		exit 1; \
	fi

docs: ## Build documentation (TypeDoc + Sphinx HTML)
	@ts=""; \
	if npm install && sphinx-build -b html docs/source docs/build/html; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(YELLOW)\n\nDocs Build finished at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError building docs. %s\n\n$(RESET)\n" "$$ts"; \
		exit 1; \
	fi

docs-clean: ## Remove generated documentation outputs
	@ts=""; \
	if rm -rf docs/build docs/html docs/typedoc; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(GREEN)\n\nDocs-clean target completed at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError running docs-clean target. %s\n\n$(RESET)\n" "$$ts"; \
		exit 1; \
	fi

install: ## Install the first .vsix found in the current directory
	@ts=""; \
	vsix="$$(find . -maxdepth 1 -type f -name '*.vsix' -print | sort | head -n 1)"; \
	if [ -z "$$vsix" ]; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError: no .vsix file found. %s\n\n$(RESET)\n" "$$ts"; \
		printf "Run 'make package' first.\n"; \
		exit 1; \
	fi; \
	echo "Installing extension: $$vsix"; \
	if code --install-extension "$$vsix"; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(GREEN)\n\nInstall target completed at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError running install target. %s\n\n$(RESET)\n" "$$ts"; \
		exit 1; \
	fi

help: ## Show this help
	@echo "Usage: make <target>"; \
	echo ""; \
	echo "Targets:"; \
	awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9][a-zA-Z0-9_.-]*:.*##/ {printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
