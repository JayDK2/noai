// ESLint for NoAI. Én regel betaler hele opsaetningen: no-undef. "afbryd" blev
// brugt i c2paTjek men kun erklæret i tre ANDRE funktioner - en ReferenceError
// som den ydre catch slugte, så hvert billede over 256 KB med Content
// Credentials svarede "ingen". Det er præcis den fejltype en linter fanger på
// et sekund, og som et menneske overser i en diff.

import js from "@eslint/js";
import globals from "globals";

const faelles = {
  ...js.configs.recommended.rules,
  // Fejl, ikke stil. Ubrugte catch-parametre er bevidste ("catch (e) {}")
  // og en ubrugt funktions-parameter kan være dokumentation af en signatur.
  "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
  "no-empty": ["error", { allowEmptyCatch: true }],
  // Skygge af ydre variabler er den anden vej "afbryd"-fejlen kunne have gået:
  // en lokal der stjæler navnet fra en ydre, så den ydre aldrig bruges.
  "no-shadow": "error",
  "no-use-before-define": ["error", { functions: false, classes: true, variables: true }],
  "eqeqeq": ["error", "always"],
  "no-var": "error",
  "prefer-const": ["error", { destructuring: "all" }],
};

export default [
  { ignores: ["node_modules/**", "mirror/**", "store/**"] },

  // Indholds-scripts og popup: almindelige browser-scripts, ikke moduler.
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: { ...globals.browser, ...globals.webextensions },
    },
    rules: faelles,
  },

  // Service worker: worker-globaler (importScripts, self) oven i webextension.
  {
    files: ["src/background.js", "src/c2pa.js"],
    languageOptions: {
      globals: { ...globals.worker, ...globals.webextensions, NoAIC2PA: "readonly" },
    },
  },

  // Værktøjer og denne fil: Node ESM.
  {
    files: ["tools/**/*.mjs", "eslint.config.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: faelles,
  },
];
