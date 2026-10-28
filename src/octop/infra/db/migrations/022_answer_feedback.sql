CREATE TABLE IF NOT EXISTS answer_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feedback_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    rating TEXT NOT NULL CHECK (rating IN ('helpful','unhelpful')),
    reason TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    correction TEXT NOT NULL DEFAULT '',
    reference TEXT NOT NULL DEFAULT '',
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_id,thread_id,message_id)
);
CREATE INDEX IF NOT EXISTS answer_feedback_created ON answer_feedback(created_at);
CREATE TABLE IF NOT EXISTS agent_share_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('user', 'role')),
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(agent_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_share_targets_lookup
  ON agent_share_targets(target_type, target_id, agent_id);
UPDATE _schema_version SET version = 22;
