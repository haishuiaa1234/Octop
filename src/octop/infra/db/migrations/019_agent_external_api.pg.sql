-- Per-agent third-party API configuration; contains only hashed credentials.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS external_api_json TEXT;

UPDATE _schema_version SET version = 19;
