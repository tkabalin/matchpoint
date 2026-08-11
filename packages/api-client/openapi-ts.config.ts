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
  ],
});
