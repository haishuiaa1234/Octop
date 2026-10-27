from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from octop.api.middleware.jwt_auth import install as install_auth
from octop.api.middleware.setup_lockdown import install as install_setup
from octop.api.routers.settings import router
from octop.config import OctopConfig


@pytest.mark.parametrize("configured", [False, True])
@pytest.mark.parametrize("brand", ["default", "dinfectome"])
async def test_branding_is_public_before_and_after_setup(configured, brand):
    config = OctopConfig(brand=brand)
    server = SimpleNamespace(
        _started=True,
        config=config,
        services=SimpleNamespace(config=config) if configured else None,
        user_manager=SimpleNamespace(count=lambda: 1) if configured else None,
    )
    app = FastAPI()
    app.state.octop_server = server
    app.include_router(router, prefix="/api")
    install_auth(app, server)
    install_setup(app, server)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/settings/branding")
        assert response.status_code == 200
        assert response.json() == {"brand": brand}
        assert response.headers["cache-control"] == "no-store"
        protected = await client.get("/api/settings/timezone")
        assert protected.status_code == (401 if configured else 503)
