from fastapi import FastAPI

from matchpoint_api import __version__
from matchpoint_api.config import settings
from matchpoint_api.routers import players


def create_app() -> FastAPI:
    app = FastAPI(title="MatchPoint API", version=__version__, debug=settings.debug)
    app.include_router(players.router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app


app = create_app()
