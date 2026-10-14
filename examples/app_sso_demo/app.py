"""Run with: uv run --with itsdangerous uvicorn examples.app_sso_demo.app:create_app --factory."""

from __future__ import annotations

import base64
import hashlib
import html
import ipaddress
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError
from starlette.middleware.sessions import SessionMiddleware

PRELOGIN_SECONDS = 300
APP_SESSION_SECONDS = 8 * 60 * 60
_STATIC = Path(__file__).with_name("static")


def _validated_url(
    value: str, name: str, *, origin_only: bool = False, http_origins: tuple[str, ...] = ()
) -> str:
    parts = urlsplit(value)
    if (
        parts.scheme not in {"http", "https"}
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
        or parts.query
        or parts.fragment
        or (origin_only and parts.path not in {"", "/"})
    ):
        raise ValueError(f"{name} must be an absolute HTTP(S) URL without credentials or query")
    host = parts.hostname.lower()
    try:
        loopback = host == "localhost" or ipaddress.ip_address(host).is_loopback
    except ValueError:
        loopback = host == "localhost"
    port = parts.port
    authority = f"[{host}]" if ":" in host else host
    if port is not None and (parts.scheme, port) not in {("http", 80), ("https", 443)}:
        authority += f":{port}"
    origin = f"{parts.scheme}://{authority}"
    if parts.scheme == "http" and not loopback and origin not in http_origins:
        raise ValueError(f"{name} must use HTTPS unless its HTTP origin is explicitly allowed")
    return origin if origin_only else origin + parts.path.rstrip("/")


@dataclass(frozen=True)
class DemoSettings:
    octop_base_url: str
    octop_origin: str
    website_id: str
    client_secret: str
    app_origin: str
    session_secret: str

    @property
    def callback_url(self) -> str:
        return self.app_origin + "/auth/octop/callback"

    @classmethod
    def from_environment(cls) -> DemoSettings:
        names = (
            "OCTOP_BASE_URL",
            "OCTOP_ORIGIN",
            "OCTOP_WEBSITE_ID",
            "OCTOP_CLIENT_SECRET",
            "DEMO_BASE_URL",
            "DEMO_SESSION_SECRET",
        )
        values = {name: os.environ.get(name, "").strip() for name in names}
        missing = [name for name, value in values.items() if not value]
        if missing:
            raise ValueError("Missing required configuration: " + ", ".join(missing))
        http_origins = tuple(
            value.strip().rstrip("/")
            for value in os.environ.get("DEMO_SSO_HTTP_ORIGINS", "").split(",")
            if value.strip()
        )
        octop_base_url = _validated_url(
            values["OCTOP_BASE_URL"], "OCTOP_BASE_URL", http_origins=http_origins
        )
        octop_origin = _validated_url(
            values["OCTOP_ORIGIN"], "OCTOP_ORIGIN", origin_only=True, http_origins=http_origins
        )
        app_origin = _validated_url(
            values["DEMO_BASE_URL"], "DEMO_BASE_URL", origin_only=True, http_origins=http_origins
        )
        if app_origin == octop_origin:
            raise ValueError("The independent application and Octop must have different origins")
        if app_origin.startswith("http://") and (
            not octop_origin.startswith("http://")
            or urlsplit(app_origin).hostname != urlsplit(octop_origin).hostname
        ):
            raise ValueError(
                "HTTP iframe development requires HTTP browser origins on the same host"
            )
        if len(values["DEMO_SESSION_SECRET"]) < 32:
            raise ValueError("DEMO_SESSION_SECRET must contain at least 32 random characters")
        return cls(
            octop_base_url=octop_base_url,
            octop_origin=octop_origin,
            website_id=values["OCTOP_WEBSITE_ID"],
            client_secret=values["OCTOP_CLIENT_SECRET"],
            app_origin=app_origin,
            session_secret=values["DEMO_SESSION_SECRET"],
        )


@dataclass(frozen=True)
class PendingLogin:
    state: str
    verifier: str
    created_at: float

    def public(self) -> dict[str, str]:
        challenge = base64.urlsafe_b64encode(hashlib.sha256(self.verifier.encode("ascii")).digest())
        return {"state": self.state, "code_challenge": challenge.decode("ascii").rstrip("=")}


class UserIdentity(BaseModel):
    id: int = Field(gt=0)
    username: str = Field(min_length=1)
    display_name: str | None
    locale: str


class ExchangeResponse(BaseModel):
    user: UserIdentity


@dataclass(frozen=True)
class ApplicationSession:
    user: UserIdentity
    created_at: float


def _callback_error(status: int, detail: str) -> HTMLResponse:
    return HTMLResponse(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<link rel="stylesheet" href="/static/app.css"><title>应用登录未完成</title>'
        f'<main><h1>应用登录未完成</h1><p class="error">{html.escape(detail)}</p>'
        '<p><a href="/">返回应用</a></p></main></html>',
        status_code=status,
    )


def create_app(*, exchange_transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    settings = DemoSettings.from_environment()
    app = FastAPI(title="Independent application SSO demo", docs_url=None, redoc_url=None)
    pending_logins: dict[str, PendingLogin] = {}
    sessions: dict[str, ApplicationSession] = {}
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        session_cookie=(
            "octop_demo_session"
            if settings.app_origin.startswith("https://")
            else "octop_demo_http_session"
        ),
        max_age=APP_SESSION_SECONDS,
        same_site="none" if settings.app_origin.startswith("https://") else "lax",
        https_only=settings.app_origin.startswith("https://"),
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; "
            f"form-action 'self'; frame-ancestors 'self' {settings.octop_origin}"
        )
        return response

    app.mount("/static", StaticFiles(directory=_STATIC), name="static")

    def current_session(request: Request) -> ApplicationSession | None:
        session_id = request.session.get("session_id")
        session = sessions.get(session_id) if session_id else None
        if session is not None and time.time() - session.created_at >= APP_SESSION_SECONDS:
            sessions.pop(session_id, None)
            session = None
        return session

    def require_session(request: Request) -> ApplicationSession:
        session = current_session(request)
        if session is None:
            raise HTTPException(401, "Application login required")
        return session

    def require_csrf(request: Request) -> None:
        token = request.headers.get("X-CSRF-Token", "")
        expected = request.session.get("csrf_token", "")
        if (
            request.headers.get("Origin") != settings.app_origin
            or not token
            or not token.isascii()
            or not expected
            or not secrets.compare_digest(token, expected)
        ):
            raise HTTPException(403, "Application origin and CSRF token required")

    session_dependency = Depends(require_session)

    def bootstrap(request: Request) -> dict[str, Any]:
        now = time.time()
        for key, record in list(pending_logins.items()):
            if now - record.created_at >= PRELOGIN_SECONDS:
                pending_logins.pop(key, None)
        for key, record in list(sessions.items()):
            if now - record.created_at >= APP_SESSION_SECONDS:
                sessions.pop(key, None)
        if "csrf_token" not in request.session:
            request.session["csrf_token"] = secrets.token_urlsafe(32)
        session = current_session(request)
        pending_id = request.session.get("pending_id")
        pending = pending_logins.get(pending_id) if pending_id else None
        if session is None and pending is None and not request.session.get("login_paused"):
            pending_id = secrets.token_urlsafe(32)
            pending = PendingLogin(secrets.token_urlsafe(32), secrets.token_urlsafe(48), now)
            pending_logins[pending_id] = pending
            request.session["pending_id"] = pending_id
        return {
            "authenticated": session is not None,
            "pending": pending.public() if pending is not None and session is None else None,
            "csrf_token": request.session["csrf_token"],
            "octop_origin": settings.octop_origin,
            "callback_url": settings.callback_url,
        }

    @app.get("/", response_class=FileResponse, summary="Independent application")
    async def index() -> FileResponse:
        return FileResponse(_STATIC / "index.html")

    @app.get("/api/sso/bootstrap", summary="Prepare the browser's application-owned login")
    async def prepare(request: Request) -> dict[str, Any]:
        return bootstrap(request)

    @app.post("/auth/start", summary="Explicitly restart application login")
    async def start(request: Request, _: None = Depends(require_csrf)) -> dict[str, Any]:
        request.session.pop("login_paused", None)
        return bootstrap(request)

    @app.get(
        "/auth/octop/callback",
        summary="Redeem an Octop code and establish an app session",
        response_model=None,
    )
    async def callback(
        request: Request, code: str = "", state: str = ""
    ) -> RedirectResponse | HTMLResponse:
        pending_id = request.session.get("pending_id")
        pending = pending_logins.get(pending_id) if pending_id else None
        if (
            pending is None
            or not state
            or not state.isascii()
            or len(state) > 128
            or not code
            or len(code) > 512
            or not secrets.compare_digest(pending.state, state)
        ):
            return _callback_error(400, "Missing or mismatched application prelogin state")
        # Consume application-side state before awaiting HTTP; concurrent callbacks cannot reuse it.
        pending_logins.pop(pending_id, None)
        request.session.pop("pending_id", None)
        request.session["login_paused"] = True
        age = time.time() - pending.created_at
        if age < 0 or age >= PRELOGIN_SECONDS:
            return _callback_error(400, "Application prelogin expired; restart login")
        try:
            async with httpx.AsyncClient(
                transport=exchange_transport, timeout=10.0, follow_redirects=False
            ) as client:
                response = await client.post(
                    settings.octop_base_url + "/api/app-sso/exchange",
                    json={
                        "website_id": settings.website_id,
                        "client_secret": settings.client_secret,
                        "code": code,
                        "state": state,
                        "code_verifier": pending.verifier,
                    },
                )
                response.raise_for_status()
                identity = ExchangeResponse.model_validate(response.json()).user
        except (httpx.HTTPError, ValidationError, ValueError):
            return _callback_error(
                502, "Octop exchange failed; restart login or contact the administrator"
            )
        old_session_id = request.session.get("session_id")
        if old_session_id:
            sessions.pop(old_session_id, None)
        csrf_token = request.session.get("csrf_token", secrets.token_urlsafe(32))
        request.session.clear()
        session_id = secrets.token_urlsafe(32)
        sessions[session_id] = ApplicationSession(identity, time.time())
        request.session.update({"session_id": session_id, "csrf_token": csrf_token})
        return RedirectResponse("/", status_code=303)

    @app.get("/api/me", summary="Current application identity and locally assigned permissions")
    async def me(session: ApplicationSession = session_dependency) -> dict[str, Any]:
        # This demo's local policy grants every linked account viewer access, never Octop admin access.
        return {
            "user": session.user.model_dump(),
            "application": {
                "subject": f"{settings.octop_origin}|{session.user.id}",
                "role": "viewer",
                "permissions": ["reports:read"],
            },
        }

    @app.get("/api/reports", summary="A locally authorized application resource")
    async def reports(_: ApplicationSession = session_dependency) -> dict[str, Any]:
        return {"items": [{"id": "R-2026-001", "name": "Quarterly report", "status": "ready"}]}

    @app.get("/api/reports/export", summary="A local permission not granted to the demo viewer")
    async def export(_: ApplicationSession = session_dependency) -> None:
        raise HTTPException(403, "Application permission reports:export required")

    @app.post("/auth/logout", summary="End only this application's session")
    async def logout(request: Request, _: None = Depends(require_csrf)) -> dict[str, bool]:
        sessions.pop(request.session.get("session_id", ""), None)
        pending_logins.pop(request.session.get("pending_id", ""), None)
        request.session.clear()
        request.session.update({"login_paused": True, "csrf_token": secrets.token_urlsafe(32)})
        return {"ok": True}

    return app
