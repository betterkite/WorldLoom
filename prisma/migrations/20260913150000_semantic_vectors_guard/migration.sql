-- WorldLoom 语义检索基础设施的幂等 schema guard。
-- 无论数据库从空库初始化还是从已有迁移基线升级，都确保该表存在。
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS semantic_vectors (
  id TEXT PRIMARY KEY,
  "worldId" TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  target_kind TEXT NOT NULL,
  "targetUid" TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  dims INTEGER NOT NULL,
  embedding vector,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_semantic_vectors_lookup ON semantic_vectors ("worldId", version, target_kind);
