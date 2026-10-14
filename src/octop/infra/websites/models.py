"""Validated website configuration, independent of HTTP transport."""

from ipaddress import ip_address
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    TypeAdapter,
    field_validator,
    model_validator,
)

from octop.i18n import tr


def url_origin(value: str) -> tuple[str, str, int]:
    # Use browser-compatible host normalization (IDNA, encoded hosts and default ports).
    parsed = TypeAdapter(HttpUrl).validate_python(value)
    return (
        parsed.scheme.lower(),
        (parsed.host or "").lower(),
        parsed.port if parsed.port is not None else (443 if parsed.scheme == "https" else 80),
    )


def _loopback(host: str) -> bool:
    if host.lower().rstrip(".") == "localhost":
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


class WebsiteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80, description="Literal menu label.")
    url: str = Field(
        max_length=2048, description="Absolute HTTP(S) URL; credentials are forbidden."
    )
    open_mode: Literal["embed", "new_tab"] = "embed"
    auth_mode: Literal["none", "octop"] = Field(
        default="none",
        description="Optional Octop identity SSO; external apps manage their own sessions and permissions.",
    )
    sso_callback_url: str | None = Field(
        default=None,
        max_length=2048,
        description="Exact registered SSO callback; must share the app entry origin, without credentials or fragments.",
    )
    sort_order: int = Field(default=0, ge=-100000, le=100000)
    enabled: bool = True
    visibility: Literal["all", "selected"] = Field(
        default="all",
        description="All signed-in users or selected user IDs; admins bypass the audience restriction.",
    )
    user_ids: list[int] = Field(
        default_factory=list,
        max_length=10000,
        description="Existing Octop user IDs when visibility is selected.",
    )

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("url", "sso_callback_url")
    @classmethod
    def validate_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            parsed = urlsplit(value)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or "\\" in value
                or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in value)
            ):
                raise ValueError
            _ = parsed.port
            TypeAdapter(HttpUrl).validate_python(value)
        except ValueError as exc:
            raise ValueError(tr("websites.invalid_url", "en")) from exc
        return value

    @model_validator(mode="after")
    def validate_sso(self) -> Self:
        if self.auth_mode == "octop":
            callback = self.sso_callback_url
            parsed = urlsplit(self.url)
            if (
                not callback
                or url_origin(self.url) != url_origin(callback)
                or urlsplit(callback).fragment
                or (parsed.scheme != "https" and not _loopback(parsed.hostname or ""))
            ):
                raise ValueError(tr("websites.invalid_sso_config", "en"))
        return self

    @model_validator(mode="after")
    def validate_audience(self) -> Self:
        self.user_ids = sorted(set(self.user_ids)) if self.visibility == "selected" else []
        if self.visibility == "selected" and not self.user_ids:
            raise ValueError(tr("websites.users_required", "en"))
        return self


class WebsiteRecord(WebsiteInput):
    website_id: str


class WebsiteLink(BaseModel):
    """Public projection deliberately excludes other users' access grants."""

    website_id: str
    name: str
    url: str
    open_mode: Literal["embed", "new_tab"]
    auth_mode: Literal["none", "octop"] = "none"
    sso_callback_url: str | None = None
    sort_order: int


class WebsiteUser(BaseModel):
    id: int
    username: str
    display_name: str | None
    disabled: bool
