/**
 * Lets plain `node` run a script that imports `src/`.
 *
 * The app's own modules are written for a bundler, so they import each other without
 * a file extension ("./point"), which Node's ESM resolver refuses. This hook adds the
 * `.ts` back before handing the specifier on; Node strips the types itself. The `@/`
 * alias is rewritten to `src/` first, for the same reason.
 *
 * Only for scripts under this directory — nothing the app ships goes through it.
 */

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// Where the app's `@/` alias points (tsconfig.json's `paths`), so a script can import
// the modules that use it, not only the ones that import by relative path.
const SRC = new URL("../src/", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      specifier = new URL(specifier.slice(2), SRC).href;
    }
    if (
      (specifier.startsWith(".") || specifier.startsWith("file:")) &&
      !/\.[a-z]+$/i.test(specifier)
    ) {
      const base = new URL(specifier, context.parentURL);
      for (const candidate of [`${base.href}.ts`, `${base.href}/index.ts`]) {
        if (existsSync(fileURLToPath(candidate))) {
          return nextResolve(candidate, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
