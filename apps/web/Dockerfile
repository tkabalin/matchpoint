# Build context is the repo root (docker build -f apps/web/Dockerfile .)
# because the SPA builds inside the pnpm workspace. The runtime image is Caddy,
# which serves the built assets, terminates TLS, and reverse-proxies /api/*
# (see infra/prod/Caddyfile).
FROM node:22-slim AS build

RUN corepack enable
WORKDIR /repo

# Dependency layer first, so source edits don't invalidate it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/api-client/package.json packages/api-client/
# The trailing `...` widens the filter to what @matchpoint/web depends on, so the
# workspace packages it imports are installed too, not just linked to nothing.
RUN pnpm install --frozen-lockfile --filter @matchpoint/web...

COPY tsconfig.base.json ./
# The generated client is TypeScript source that Vite compiles as part of the app,
# so the whole package has to be here — including runtime-config.ts, which sits
# outside src/ and is imported by the generated client.
COPY packages/api-client packages/api-client
COPY apps/web apps/web
RUN pnpm --filter @matchpoint/web run build

FROM caddy:2-alpine

COPY infra/prod/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
