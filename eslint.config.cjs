// exophial init — minimal ESLint flat config for a detected TypeScript repo.
//
// CommonJS (not ESM): the templated mirrors-eslint pre-commit hook installs
// its additional_dependencies into its OWN sandboxed node environment and
// resolves them into the linted repo via NODE_PATH. Node's ESM `import`
// resolver ignores NODE_PATH; only CommonJS `require()` honors it — an
// eslint.config.mjs here would fail with a "Cannot find package" error
// inside that hook's environment even though the same import resolves fine
// against a locally `npm install`ed node_modules.
//
// Uses only the packages the hook installs: eslint, typescript, and
// typescript-eslint (see .pre-commit-config.yaml, the ESLint hook's
// additional_dependencies). Swap in a richer config — for example
// aspergillus's reference TypeScript config
// (aspergillus/typescript/configs/eslint.config.js) — once the project's
// own toolchain carries the extra lint dependencies that needs.
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  ...tseslint.configs.recommended,
  {
    // The repo is CommonJS (package.json "type": "commonjs"); every .js file
    // uses require(), so the TS-oriented no-require-imports rule is a false
    // positive here, not a real lint finding.
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // tests/diff-test.js carries one pre-existing unused helper
    // (stripHex). This install fixes lint failures by configuration only,
    // not by editing source behavior, so the finding is scoped off here
    // rather than the helper being deleted.
    files: ["tests/diff-test.js"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
