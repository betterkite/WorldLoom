-- Record the embedding model that produced each vector. A model change must
-- not silently reuse vectors from a different semantic space.
ALTER TABLE semantic_vectors
  ADD COLUMN IF NOT EXISTS "embeddingModel" TEXT;
