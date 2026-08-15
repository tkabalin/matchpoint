import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  // The committed spec, not a running server: see apps/api/src/matchpoint_api/openapi.py.
  input: "../../apps/api/openapi.json",
  output: "src",
  plugins: [
    {
      name: "@hey-api/client-fetch",
      // Base URL comes from here rather than a literal in this config: see the file.
      runtimeConfigPath: "./runtime-config",
    },
    "@hey-api/sdk",
    "@tanstack/react-query",
    // The generated TypeScript types keep field names and primitive types and drop
    // everything else the spec knows: `format: date` and `format: uuid` both erase
    // to `string`, as do ShortText's length bounds. These schemas keep them, so a
    // request body can be checked against the real contract in a unit test.
    "zod",
  ],
});
