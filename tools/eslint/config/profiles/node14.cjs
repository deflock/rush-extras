module.exports = {
  root: true,
  env: {
    es2020: true,
    node: true,
  },
  parser: "",
  ignorePatterns: ["*.d.ts"],
  overrides: [
    {
      files: ["*.js", "*.cjs", "*.mjs", "*.jsx"],
      plugins: ["import", "promise"],
      parser: "",
      parserOptions: {
        ecmaVersion: 11,
      },
      extends: [
        "eslint:recommended",
        "plugin:promise/recommended",
        "plugin:import/errors",
        "plugin:import/warnings",
        "prettier",
      ],
    },
    {
      files: ["*.ts", "*.cts", "*.mts", "*.tsx"],
      plugins: ["@typescript-eslint/eslint-plugin", "promise"],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        project: "./tsconfig.json",
        sourceType: "module",
      },
      extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:promise/recommended",
        "prettier",
      ],
      rules: {
        "@typescript-eslint/interface-name-prefix": "off",
        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/explicit-module-boundary-types": "off",
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
  ],
};
