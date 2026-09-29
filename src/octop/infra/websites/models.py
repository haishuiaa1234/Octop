"""Validated website configuration, independent of HTTP transport."""

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


class WebsiteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80, description="Literal menu label.")
    url: str = Field(
        max_length=2048, description="Absolute HTTP(S) URL; credentials are forbidden."
    )
    open_mode: Literal["embed", "new_tab"] = "embed"
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

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
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
    sort_order: int


class WebsiteUser(BaseModel):
    id: int
    username: str
    display_name: str | None
    disabled: bool
