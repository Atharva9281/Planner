import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // What `netlify build` leaves behind: the compiled server handler and edge functions, which
    // are this app's own code already bundled. Linting them reports thousands of problems in
    // generated output and buries anything real.
    ".netlify/**",
  ]),
]);

export default eslintConfig;
