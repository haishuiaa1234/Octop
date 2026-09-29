"""Fork-specific website configuration in the existing settings KV table.

One namespaced key per entry avoids both upstream migration-number conflicts
and lost updates when different websites are edited concurrently.
"""

from octop.infra.db.pool import DatabasePool

_PREFIX = "custom.websites.v1."


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
