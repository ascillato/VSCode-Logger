# Makefile for packaging the Extension and building the docs

YELLOW=\033[1;33m
RED=\033[1;31m
GREEN=\033[1;32m
BLUE=\033[1;34m
RESET=\033[0m

.PHONY: all clean install help check package force-install package-clean linter-fix docs docs-clean test tests-clean

all: clean package install ## Clean, then build VSIX package and installs it

clean: package-clean docs-clean ## Remove all generated files (package + docs)

check: ## Linting and type checking
	@ts=""; \
	ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
	printf "$(YELLOW)\n\nStart Linting and type checking at %s\n\n$(RESET)\n" "$$ts"

	@ts=""; \
	if npm install && npm run lint && npm run format:check; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(BLUE)\n\nCheck completed at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError running check. %s\n\n$(RESET)\n" "$$ts"; \
		exit 1; \
	fi

linter-fix: ## Apply Linter Fixes when possible
	@ts=""; \
	ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
	printf "$(YELLOW)\n\nStart Linter Fixes at %s\n\n$(RESET)\n" "$$ts"

	@ts=""; \
	if npm install && npm run lint:fix && npm run format; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(BLUE)\n\nLinter Fixes completed at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError running Linter Fixes. %s\n\n$(RESET)\n" "$$ts"; \
		exit 1; \
	fi

test: ## Run unit, integration, and E2E tests
	@ts=""; \
	ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
	printf "$(YELLOW)\n\nStart Tests at %s\n\n$(RESET)\n" "$$ts"

	@ts=""; \
	if npm install && npm test; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(GREEN)\n\nTests completed at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError running Tests. %s\n\n$(RESET)\n" "$$ts"; \
		exit 1; \
	fi

tests-clean: ## Remove generated tests reports
	@ts=""; \
	if rm -rf .vscode-test; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(GREEN)\n\nTests-clean completed at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError running Tests-clean. %s\n\n$(RESET)\n" "$$ts"; \
		exit 1; \
	fi

package: ## Install deps, compile, and create the .vsix package
	@ts=""; \
	ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
	printf "$(YELLOW)\n\nStart building package at %s\n\n$(RESET)\n" "$$ts"

	@ts=""; \
	if npm install && npm run compile && vsce package; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(GREEN)\n\nPackage completed at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError running package. %s\n\n$(RESET)\n" "$$ts"; \
		exit 1; \
	fi

package-clean: ## Remove node_modules, build outputs, and generated .vsix
	@ts=""; \
	if rm -rf node_modules out *.vsix; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(GREEN)\n\nPackage-clean completed at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError running package-clean. %s\n\n$(RESET)\n" "$$ts"; \
		exit 1; \
	fi

docs: ## Build documentation (TypeDoc + Sphinx HTML)
	@ts=""; \
	ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
	printf "$(YELLOW)\n\nStart building docs at %s\n\n$(RESET)\n" "$$ts"

	@ts=""; \
	if npm install && npm run lint:docs && sphinx-build -b html docs/source docs/build/html; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(BLUE)\n\nDocs Build finished at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError building docs. %s\n\n$(RESET)\n" "$$ts"; \
		exit 1; \
	fi

docs-clean: ## Remove generated documentation outputs
	@ts=""; \
	if rm -rf docs/build docs/source/__pycache__ docs/source/_generated/*.md docs/source/_generated/*.json; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(GREEN)\n\nDocs-clean completed at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError running docs-clean. %s\n\n$(RESET)\n" "$$ts"; \
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
		printf "$(GREEN)\n\nInstall completed at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError running install. %s\n\n$(RESET)\n" "$$ts"; \
		exit 1; \
	fi

force-install: ## Force to Install the first .vsix found in the current directory (even if it is downgrading versions)
	@ts=""; \
	vsix="$$(find . -maxdepth 1 -type f -name '*.vsix' -print | sort | head -n 1)"; \
	if [ -z "$$vsix" ]; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError: no .vsix file found. %s\n\n$(RESET)\n" "$$ts"; \
		printf "Run 'make package' first.\n"; \
		exit 1; \
	fi; \
	echo "Force Installing extension: $$vsix"; \
	if code --install-extension "$$vsix" --force; then \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(GREEN)\n\nForce Install completed at %s\n\n$(RESET)\n" "$$ts"; \
	else \
		ts="$$(date +"%Y-%m-%dT%H:%M:%S%z")"; \
		printf "$(RED)\n\nError running force install. %s\n\n$(RESET)\n" "$$ts"; \
		exit 1; \
	fi

help: ## Show this help
	@echo "Usage: make <option>"; \
	echo ""; \
	echo "Options:"; \
	awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9][a-zA-Z0-9_.-]*:.*##/ {printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
