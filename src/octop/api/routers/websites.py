"""Thin HTTP adapter for the external website catalog."""

import asyncio
from functools import partial

from fastapi import APIRouter, Depends, Request, Response

from octop.api.common.public_base import resolve_public_base
from octop.api.deps import current_user, get_server, require_admin
from octop.infra.server import OctopServer
from octop.infra.users.identity import User
from octop.infra.websites.models import WebsiteInput, WebsiteLink, WebsiteRecord, WebsiteUser
from octop.infra.websites.service import WebsiteService
from octop.infra.websites.sso import (
    SsoCodeRequest,
    SsoCodeResponse,
    SsoExchangeRequest,
    SsoExchangeResponse,
    SsoSecretResponse,
    WebsiteSsoService,
)

router = APIRouter()


def get_service(server: OctopServer = Depends(get_server)) -> WebsiteService:
    assert server.services is not None
    return WebsiteService(server.services)


def get_sso_service(server: OctopServer = Depends(get_server)) -> WebsiteSsoService:
    assert server.services is not None
    return WebsiteSsoService(server.services)


@router.get("/websites", response_model=list[WebsiteLink], summary="List accessible websites")
async def visible_websites(
    user: User = Depends(current_user), service: WebsiteService = Depends(get_service)
) -> list[WebsiteLink]:
    return await asyncio.get_running_loop().run_in_executor(None, service.list_visible, user)


@router.get(
    "/websites/{website_id}",
    response_model=WebsiteLink,
    summary="Open an accessible website",
    description="Rechecks enablement and audience. Returns 404 for missing, disabled, or unauthorized entries. Does not proxy the target; optional SSO uses application-scoped one-time codes.",
)
async def visible_website(
    website_id: str,
    user: User = Depends(current_user),
    service: WebsiteService = Depends(get_service),
) -> WebsiteLink:
    return await asyncio.get_running_loop().run_in_executor(
        None, service.get_visible, user, website_id
    )


@router.get(
    "/admin/websites",
    response_model=list[WebsiteRecord],
    summary="List all website configurations",
    description="Administrator only; includes disabled entries and access grants.",
)
async def managed_websites(
    user: User = Depends(require_admin()), service: WebsiteService = Depends(get_service)
) -> list[WebsiteRecord]:
    return await asyncio.get_running_loop().run_in_executor(None, service.list_managed, user)


@router.get(
    "/admin/websites/users",
    response_model=list[WebsiteUser],
    summary="List website audience candidates",
    description="Administrator only. Includes disabled users to preserve existing grants during edits.",
)
async def website_users(
    user: User = Depends(require_admin()), service: WebsiteService = Depends(get_service)
) -> list[WebsiteUser]:
    return await asyncio.get_running_loop().run_in_executor(None, service.users, user)


@router.post(
    "/admin/websites",
    response_model=WebsiteRecord,
    status_code=201,
    summary="Create a website entry",
    description="Administrator only. Saves a link; does not deploy or fetch the website.",
)
async def create_website(
    body: WebsiteInput,
    user: User = Depends(require_admin()),
    service: WebsiteService = Depends(get_service),
) -> WebsiteRecord:
    return await asyncio.get_running_loop().run_in_executor(None, partial(service.save, user, body))


@router.put(
    "/admin/websites/{website_id}",
    response_model=WebsiteRecord,
    summary="Replace a website configuration",
    description="Administrator only. Replaces the full configuration, including audience and enabled state.",
)
async def update_website(
    website_id: str,
    body: WebsiteInput,
    user: User = Depends(require_admin()),
    service: WebsiteService = Depends(get_service),
) -> WebsiteRecord:
    return await asyncio.get_running_loop().run_in_executor(
        None, service.save, user, body, website_id
    )


@router.delete(
    "/admin/websites/{website_id}",
    status_code=204,
    summary="Delete a website entry",
    description="Administrator only. Removes the Octop entry, not the external website.",
)
async def delete_website(
    website_id: str,
    user: User = Depends(require_admin()),
    service: WebsiteService = Depends(get_service),
) -> Response:
    await asyncio.get_running_loop().run_in_executor(None, service.delete, user, website_id)
    return Response(status_code=204)


@router.post(
    "/admin/websites/{website_id}/sso-secret",
    response_model=SsoSecretResponse,
    summary="Generate or rotate an application SSO secret",
    description="Administrator only. Reveals the new secret once and invalidates the old secret and outstanding codes. Store it only in the application's backend.",
)
async def rotate_sso_secret(
    website_id: str,
    response: Response,
    user: User = Depends(require_admin()),
    service: WebsiteSsoService = Depends(get_sso_service),
) -> SsoSecretResponse:
    response.headers["Cache-Control"] = "no-store"
    return await asyncio.get_running_loop().run_in_executor(
        None, service.rotate_secret, user, website_id
    )


@router.post(
    "/websites/{website_id}/sso/code",
    response_model=SsoCodeResponse,
    summary="Issue an application identity code",
    description="Requires Octop login and current website access. Binds the code to the current user, app, registered callback, random state and S256 challenge. Expires after 60 seconds; never grants Octop API access.",
)
async def issue_sso_code(
    website_id: str,
    body: SsoCodeRequest,
    request: Request,
    response: Response,
    user: User = Depends(current_user),
    service: WebsiteSsoService = Depends(get_sso_service),
) -> SsoCodeResponse:
    response.headers["Cache-Control"] = "no-store"
    return await asyncio.get_running_loop().run_in_executor(
        None, service.issue, user, website_id, body, resolve_public_base(request)
    )


@router.post(
    "/app-sso/exchange",
    response_model=SsoExchangeResponse,
    summary="Exchange a single-use application identity code",
    description="Confidential application backend only. Authenticates the app using its secret and S256 verifier, then atomically consumes the code. Returns identity only, never Octop roles, permissions, provider tokens or JWTs. No Octop JWT is required.",
)
async def exchange_sso_code(
    body: SsoExchangeRequest,
    response: Response,
    service: WebsiteSsoService = Depends(get_sso_service),
) -> SsoExchangeResponse:
    response.headers["Cache-Control"] = "no-store"
    return await asyncio.get_running_loop().run_in_executor(None, service.exchange, body)
