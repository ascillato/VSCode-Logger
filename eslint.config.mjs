import { defineConfig, globalIgnores } from "eslint/config";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-plugin-prettier";
import spellcheck from "eslint-plugin-spellcheck";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

const spellcheckSkipWords = [
  "compat",
  "csp",
  "ecma",
  "eslint",
  "globals",
  "lang",
  "lifecycles",
  "mjs",
  "npm",
  "prepublish",
  "readonly",
  "href",
  "stderr",
  "tsx",
  "tsconfig",
  "tdd",
  "typedoc",
  "workspace",
  "uri",
  "utf8",
  "vitest",
  "vscode",
  "vsix",
  "webview",
  "webviews",
];

export default defineConfig([
  globalIgnores([
    "**/node_modules/",
    "**/out/",
    "**/dist/",
    "**/.vscode-test/",
    "**/.github/",
    "**/.vscode/",
    "**/docs/",
    "**/*.vsix",
    "**/*.md",
    "**/*.css",
    "**/*.json",
    "eslint.config.mjs",
  ]),

  // -------------------------
  // JS / MJS / CJS (no TS project)
  // -------------------------
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: { prettier, spellcheck },
    rules: {
      "prettier/prettier": "error",
      "spellcheck/spell-checker": [
        "error",
        {
          lang: "en_US",
          identifiers: false,
          templates: true,
          skipWords: spellcheckSkipWords,
          skipIfMatch: ["https?:\\\/\\\/[^\\s]+", "^[A-Za-z0-9]{10,}$"],
          minLength: 3,
        },
      ],
      "no-console": "off",
    },
  },

  // -------------------------
  // TypeScript (type-aware)
  // -------------------------
  {
    files: ["**/*.{ts,tsx}"],
    extends: compat.extends(
      "eslint:recommended",
      "plugin:@typescript-eslint/recommended",
      "plugin:@typescript-eslint/recommended-requiring-type-checking",
      "plugin:prettier/recommended",
    ),
    plugins: {
      "@typescript-eslint": typescriptEslint,
      prettier,
      spellcheck,
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "off",
      "prettier/prettier": "error",
      "spellcheck/spell-checker": [
        "warn",
        {
          lang: "en_US",
          identifiers: false,
          templates: true,
          skipWords: spellcheckSkipWords,
          skipIfMatch: ["https?:\\\/\\\/[^\\s]+", "^[A-Za-z0-9]{10,}$"],
          minLength: 3,
        },
      ],
    },
  },

  // -------------------------
  // Tests (relaxed rules)
  // -------------------------
  {
    files: ["tests/**/*.{ts,tsx}", "test/**/*.{ts,tsx}", "vitest.config.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
]);
