"""Fork-specific website configuration in the existing settings KV table.

One namespaced key per entry avoids both upstream migration-number conflicts
and lost updates when different websites are edited concurrently.
"""

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import now_ts

_PREFIX = "custom.websites.v1."
_SSO_CODE_PREFIX = "custom.website-sso.code.v1."


class WebsiteRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def list_values(self) -> list[str]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT value FROM settings WHERE key LIKE ?", (_PREFIX + "%",)
            ).fetchall()
        return [str(row["value"]) for row in rows]

    def get(self, website_id: str) -> str | None:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT value FROM settings WHERE key = ?", (_PREFIX + website_id,)
            ).fetchone()
        return str(row["value"]) if row else None

    def create(self, website_id: str, value: str) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO settings(key, value) VALUES (?, ?)", (_PREFIX + website_id, value)
            )

    def update(self, website_id: str, value: str) -> bool:
        with self._db.transaction() as conn:
            return bool(
                conn.execute(
                    "UPDATE settings SET value = ? WHERE key = ?", (value, _PREFIX + website_id)
                ).rowcount
            )

    def delete(self, website_id: str) -> bool:
        with self._db.transaction() as conn:
            return bool(
                conn.execute("DELETE FROM settings WHERE key = ?", (_PREFIX + website_id,)).rowcount
            )

    def create_sso_code(self, code_hash: str, value: str) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO settings(key, value) VALUES (?, ?)",
                (_SSO_CODE_PREFIX + code_hash, value),
            )

    def get_sso_code(self, code_hash: str) -> str | None:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT value FROM settings WHERE key = ?", (_SSO_CODE_PREFIX + code_hash,)
            ).fetchone()
        return str(row["value"]) if row else None

    def cleanup_sso_codes(self, now: int) -> None:
        # Grants start with a fixed-width expiry so cleanup works without dialect-specific JSON SQL.
        with self._db.transaction() as conn:
            conn.execute(
                "DELETE FROM settings WHERE key LIKE ? AND value < ?",
                (_SSO_CODE_PREFIX + "%", f"{now + 1:012d}:"),
            )

    def consume_sso_code(
        self,
        code_hash: str,
        value: str,
        *,
        website_id: str,
        website_value: str,
        secret_key: str,
        secret_hash: bytes,
        user_id: int,
        user_role: str,
    ) -> bool:
        with self._db.transaction() as conn:
            return bool(
                conn.execute(
                    "DELETE FROM settings WHERE key = ? AND value = ? AND value >= ? "
                    "AND EXISTS (SELECT 1 FROM settings website WHERE website.key = ? AND website.value = ?) "
                    "AND EXISTS (SELECT 1 FROM secrets WHERE k = ? AND v = ?) "
                    "AND EXISTS (SELECT 1 FROM users WHERE id = ? AND disabled = 0 AND role = ?)",
                    (
                        _SSO_CODE_PREFIX + code_hash,
                        value,
                        f"{now_ts() + 1:012d}:",
                        _PREFIX + website_id,
                        website_value,
                        secret_key,
                        secret_hash,
                        user_id,
                        user_role,
                    ),
                ).rowcount
            )
