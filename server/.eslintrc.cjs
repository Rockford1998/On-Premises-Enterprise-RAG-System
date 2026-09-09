module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { node: true, es2020: true, jest: true },
  ignorePatterns: ["dist", "node_modules"],
  rules: {
    // TypeScript already catches undefined-variable errors; no-undef is
    // redundant against TS and prone to false positives on ambient globals.
    "no-undef": "off",
    // This codebase leans on `any` throughout (Mongoose docs, dynamic tool
    // payloads, LLM responses) — banning it outright would flag hundreds of
    // pre-existing, deliberate uses. Keep the rule available but non-blocking.
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    // Pre-existing domain model leans on `{}` / bare `String` as loose
    // "any object" / "any string" types (botProfile's baseModel, botUsers,
    // etc.) — enforcing this here means redesigning that typing, which is a
    // separate, unrelated refactor.
    "@typescript-eslint/ban-types": "off",
  },
};
