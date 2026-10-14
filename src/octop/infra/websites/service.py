"""Access-controlled website catalog; never fetches or proxies website URLs."""

from uuid import uuid4

from octop.infra.db.services import SharedServices
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.users.identity import User
from octop.infra.websites.models import WebsiteInput, WebsiteLink, WebsiteRecord, WebsiteUser


class WebsiteService:
    def __init__(self, services: SharedServices) -> None:
        self.services = services

    @staticmethod
    def _admin(user: User) -> None:
        if not user.is_admin:
            raise OctopError.localized(ErrorCode.FORBIDDEN, user.locale)

    def _records(self) -> list[WebsiteRecord]:
        return sorted(
            (
                WebsiteRecord.model_validate_json(raw)
                for raw in self.services.website_repo.list_values()
            ),
            key=lambda site: (site.sort_order, site.name.casefold(), site.website_id),
        )

    @staticmethod
    def _allowed(site: WebsiteRecord, user: User) -> bool:
        return site.enabled and (
            user.is_admin or site.visibility == "all" or user.id in site.user_ids
        )

    @staticmethod
    def _link(site: WebsiteRecord) -> WebsiteLink:
        return WebsiteLink.model_validate(site.model_dump())

    def list_visible(self, user: User) -> list[WebsiteLink]:
        return [self._link(site) for site in self._records() if self._allowed(site, user)]

    def get_visible(self, user: User, website_id: str) -> WebsiteLink:
        raw = self.services.website_repo.get(website_id)
        if raw:
            site = WebsiteRecord.model_validate_json(raw)
            if self._allowed(site, user):
                return self._link(site)
        raise OctopError.localized(ErrorCode.NOT_FOUND, user.locale)

    def list_managed(self, user: User) -> list[WebsiteRecord]:
        self._admin(user)
        return self._records()

    def users(self, user: User) -> list[WebsiteUser]:
        self._admin(user)
        return [
            WebsiteUser(
                id=row.id,
                username=row.username,
                display_name=row.display_name,
                disabled=bool(row.disabled),
            )
            for row in self.services.user_repo.list(include_disabled=True)
        ]

    def save(self, user: User, data: WebsiteInput, website_id: str | None = None) -> WebsiteRecord:
        self._admin(user)
        if not data.sso_transport_allowed(self.services.config.website_sso_http_origins):
            raise OctopError.localized(ErrorCode.WEBSITE_SSO_HTTPS_REQUIRED, user.locale)
        if any(self.services.user_repo.get(user_id) is None for user_id in data.user_ids):
            raise OctopError.localized(ErrorCode.NOT_FOUND, user.locale, status=422)
        record = WebsiteRecord(website_id=website_id or uuid4().hex, **data.model_dump())
        if website_id is None:
            self.services.website_repo.create(record.website_id, record.model_dump_json())
        elif not self.services.website_repo.update(website_id, record.model_dump_json()):
            raise OctopError.localized(ErrorCode.NOT_FOUND, user.locale)
        self.services.audit_repo.user_event(
            user.username,
            "website.update" if website_id else "website.create",
            target=record.website_id,
        )
        return record

    def delete(self, user: User, website_id: str) -> None:
        self._admin(user)
        if not self.services.website_repo.delete(website_id):
            raise OctopError.localized(ErrorCode.NOT_FOUND, user.locale)
        self.services.audit_repo.user_event(user.username, "website.delete", target=website_id)
