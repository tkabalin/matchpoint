# Build in the uv image, run in plain python-slim so the runtime image carries
# no build toolchain. Both stages share the same Debian/CPython base, so the
# virtualenv copies across cleanly. The uv tag pins the 0.11 minor to match
# pyproject's required-version (the unversioned *-bookworm-slim tags are frozen
# at uv 0.9, which can't read this lockfile).
FROM ghcr.io/astral-sh/uv:0.11-python3.12-trixie-slim AS build

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app

# Dependency layer first, so source edits don't invalidate it.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY . .
RUN uv sync --locked --no-dev

FROM python:3.12-slim-trixie

WORKDIR /app
COPY --from=build /app /app
ENV PATH="/app/.venv/bin:$PATH"

# Drop to an unprivileged user. Nothing here is written at runtime, so leaving
# /app owned by root means the process cannot rewrite its own code either.
RUN useradd --system --uid 10001 app
USER app

EXPOSE 8000
# --root-path because Caddy strips the /api prefix before proxying
# (handle_path in infra/prod/Caddyfile); this keeps the OpenAPI docs and
# generated URLs correct behind the proxy.
#
# --forwarded-allow-ips so request.client is the address Caddy saw rather than
# Caddy's container IP — the sign-up rate limit keys on it. Trusting the header
# from any peer ('*') is safe here because this port is never published: the
# only peer is Caddy, and Caddy replaces X-Forwarded-For from clients it does
# not trust (it trusts none — no trusted_proxies in infra/prod/Caddyfile), so
# the value is always the one address that reached Caddy, never a client-forged
# chain. That address is a Cloudflare edge, not the visitor: coarser, which the
# rate limit's shared tier compensates for (see rate_limit.py).
#
# The safety is Caddy's, not uvicorn's: '*' makes uvicorn read the leftmost
# entry of the chain — the client-supplied end — and that is the right address
# only because the chain is one entry long. Adding trusted_proxies to the
# Caddyfile preserves a visitor's own X-Forwarded-For and hands the rate limit
# an attacker-chosen key, so that change belongs with a real CIDR here (the api
# container's Docker network) in place of '*'. Noted in the Caddyfile too, next
# to the log directive that invites the change.
CMD ["uvicorn", "matchpoint_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--root-path", "/api", "--forwarded-allow-ips", "*"]
