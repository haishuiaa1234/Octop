"""Application-scoped identity grants, never Octop access tokens."""

import base64
import hashlib
import secrets
import time

from pydantic import BaseModel, ConfigDict, Field

from octop.infra.db.services import SharedServices
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.users.identity import User
from octop.infra.websites.models import WebsiteRecord, url_origin
from octop.infra.websites.service import WebsiteService

_SECRET_PREFIX = "custom.website-sso.secret.v1."
_BASE64URL = r"^[A-Za-z0-9_-]+$"
_CODE_TTL = 60


class SsoCodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: str = Field(
        min_length=32,
        max_length=128,
        pattern=_BASE64URL,
        description="App-generated random state, bound to the browser's pre-login session.",
    )
    code_challenge: str = Field(
        min_length=43,
        max_length=43,
        pattern=_BASE64URL,
        description="BASE64URL(SHA256(code_verifier)), without padding; only S256 is supported.",
    )


class SsoCodeResponse(BaseModel):
    code: str
    state: str
    expires_in: int
    callback_url: str


class SsoSecretResponse(BaseModel):
    client_secret: str = Field(
        description="Shown only in this response. Save it securely in the external app backend."
    )


class SsoExchangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    website_id: str = Field(min_length=1, max_length=128)
    client_secret: str = Field(
        min_length=1,
        max_length=256,
        description="Confidential application credential; never send it from a browser.",
    )
    code: str = Field(min_length=43, max_length=128, pattern=_BASE64URL)
    state: str = Field(min_length=32, max_length=128, pattern=_BASE64URL)
    code_verifier: str = Field(
        min_length=43,
        max_length=128,
        pattern=_BASE64URL,
        description="Original verifier from the application's pre-login session.",
    )


class SsoUser(BaseModel):
    id: int
    username: str
    display_name: str | None
    locale: str


class SsoExchangeResponse(BaseModel):
    user: SsoUser = Field(
        description="Identity only. Octop roles, permissions and tokens are never granted to external apps."
    )


class _Grant(BaseModel):
    website_id: str
    user_id: int
    secret_hash: str
    website_hash: str
    state: str
    code_challenge: str
    callback_url: str
    expires_at: int


def _hash(value: str) -> bytes:
    return hashlib.sha256(value.encode()).digest()


class WebsiteSsoService:
    def __init__(self, services: SharedServices) -> None:
        self.services = services

    def _site(self, website_id: str) -> tuple[str, WebsiteRecord] | None:
        raw = self.services.website_repo.get(website_id)
        if raw is None:
            return None
        site = WebsiteRecord.model_validate_json(raw)
        if not site.sso_transport_allowed(self.services.config.website_sso_http_origins):
            return None
        return raw, site

    def _user(self, user_id: int) -> User | None:
        row = self.services.user_repo.get(user_id)
        if row is None or row.disabled:
            return None
        return User(row.id, row.username, row.role, row.display_name, row.locale)

    def rotate_secret(self, user: User, website_id: str) -> SsoSecretResponse:
        WebsiteService._admin(user)
        loaded = self._site(website_id)
        if loaded is None:
            raise OctopError.localized(ErrorCode.NOT_FOUND, user.locale)
        if loaded[1].auth_mode != "octop":
            raise OctopError.localized(ErrorCode.WEBSITE_SSO_NOT_CONFIGURED, user.locale)
        secret = secrets.token_urlsafe(48)
        self.services.secret_repo.set(_SECRET_PREFIX + website_id, _hash(secret))
        self.services.audit_repo.user_event(
            user.username, "website.sso-secret.rotate", target=website_id
        )
        return SsoSecretResponse(client_secret=secret)

    def issue(
        self, user: User, website_id: str, data: SsoCodeRequest, public_base: str
    ) -> SsoCodeResponse:
        active_user = self._user(user.id)
        if active_user is None:
            raise OctopError.localized(ErrorCode.USER_DISABLED, user.locale)
        loaded = self._site(website_id)
        if loaded is None or not WebsiteService._allowed(loaded[1], active_user):
            raise OctopError.localized(ErrorCode.NOT_FOUND, user.locale)
        raw_site, site = loaded
        secret_hash = self.services.secret_repo.get(_SECRET_PREFIX + website_id)
        if site.auth_mode != "octop" or site.sso_callback_url is None or secret_hash is None:
            raise OctopError.localized(ErrorCode.WEBSITE_SSO_NOT_CONFIGURED, user.locale)
        if url_origin(site.url) == url_origin(public_base):
            raise OctopError.localized(ErrorCode.WEBSITE_SSO_INVALID_ORIGIN, user.locale)
        now = int(time.time())
        self.services.website_repo.cleanup_sso_codes(now)
        code = secrets.token_urlsafe(48)
        grant = _Grant(
            website_id=website_id,
            user_id=active_user.id,
            secret_hash=secret_hash.hex(),
            website_hash=_hash(raw_site).hex(),
            state=data.state,
            code_challenge=data.code_challenge,
            callback_url=site.sso_callback_url,
            expires_at=now + _CODE_TTL,
        )
        self.services.website_repo.create_sso_code(
            _hash(code).hex(), f"{grant.expires_at:012d}:{grant.model_dump_json()}"
        )
        return SsoCodeResponse(
            code=code, state=data.state, expires_in=_CODE_TTL, callback_url=site.sso_callback_url
        )

    def exchange(self, data: SsoExchangeRequest) -> SsoExchangeResponse:
        failure = OctopError.localized(ErrorCode.AUTH_FAILED)
        now = int(time.time())
        repo = self.services.website_repo
        repo.cleanup_sso_codes(now)
        secret_key = _SECRET_PREFIX + data.website_id
        secret_hash = self.services.secret_repo.get(secret_key)
        if secret_hash is None or not secrets.compare_digest(
            secret_hash, _hash(data.client_secret)
        ):
            raise failure
        code_hash = _hash(data.code).hex()
        raw_grant = repo.get_sso_code(code_hash)
        if raw_grant is None:
            raise failure
        grant = _Grant.model_validate_json(raw_grant.partition(":")[2])
        challenge = base64.urlsafe_b64encode(_hash(data.code_verifier)).decode().rstrip("=")
        if (
            grant.expires_at <= now
            or grant.website_id != data.website_id
            or not secrets.compare_digest(grant.secret_hash, secret_hash.hex())
            or not secrets.compare_digest(grant.state, data.state)
            or not secrets.compare_digest(grant.code_challenge, challenge)
        ):
            raise failure
        loaded = self._site(data.website_id)
        user = self._user(grant.user_id)
        if loaded is None or user is None:
            raise failure
        raw_site, site = loaded
        if (
            site.auth_mode != "octop"
            or site.sso_callback_url != grant.callback_url
            or _hash(raw_site).hex() != grant.website_hash
            or not WebsiteService._allowed(site, user)
        ):
            raise failure
        if not repo.consume_sso_code(
            code_hash,
            raw_grant,
            website_id=data.website_id,
            website_value=raw_site,
            secret_key=secret_key,
            secret_hash=secret_hash,
            user_id=user.id,
            user_role=user.role,
        ):
            raise failure
        return SsoExchangeResponse(
            user=SsoUser(
                id=user.id,
                username=user.username,
                display_name=user.display_name,
                locale=user.locale,
            )
        )
