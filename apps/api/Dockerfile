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
CMD ["uvicorn", "matchpoint_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--root-path", "/api"]
