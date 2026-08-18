function configuredCollections(config) {
  const collections = config?.collections;
  if (!collections || typeof collections !== "object" || Array.isArray(collections)) {
    return {};
  }
  return collections;
}

export function validateEmbeddingPolicy(config) {
  for (const [name, collection] of Object.entries(configuredCollections(config))) {
    if (!collection || typeof collection !== "object" || Array.isArray(collection)) continue;
    if (collection.embedding !== undefined && typeof collection.embedding !== "boolean") {
      throw new Error(`Collection '${name}' embedding must be true or false`);
    }
  }
}

export function embeddingEnabledCollectionNames(config) {
  validateEmbeddingPolicy(config);
  return Object.entries(configuredCollections(config))
    .filter(([, collection]) => collection?.embedding !== false)
    .map(([name]) => name);
}

export function collectionEmbeddingEnabled(config, name) {
  validateEmbeddingPolicy(config);
  const collection = configuredCollections(config)[name];
  return Boolean(collection) && collection.embedding !== false;
}

export function assertSearchEmbeddingPolicy(config, options) {
  validateEmbeddingPolicy(config);
  const collections = configuredCollections(config);
  const explicit = [
    ...(options?.collection ? [options.collection] : []),
    ...(options?.collections || []),
  ];
  const selected = explicit.length > 0
    ? explicit
    : Object.entries(collections)
      .filter(([, collection]) => collection?.includeByDefault !== false)
      .map(([name]) => name);
  const lexicalOnly = selected.filter((name) => collections[name]?.embedding === false);
  if (lexicalOnly.length === 0) return;

  const searches = options?.queries;
  const lexicalOnlyRequest = Array.isArray(searches)
    && searches.length > 0
    && searches.every((search) => search?.type === "lex");
  if (!lexicalOnlyRequest) {
    throw new Error(
      `Collection(s) ${lexicalOnly.join(", ")} have embedding disabled and support only explicit lex searches`,
    );
  }
}

export function countPendingEmbeddingHashes(db, config, model, fingerprint, selectedCollections) {
  const enabled = embeddingEnabledCollectionNames(config);
  const selected = selectedCollections ? new Set(selectedCollections) : null;
  const collections = selected ? enabled.filter((name) => selected.has(name)) : enabled;
  if (collections.length === 0) return 0;

  const placeholders = collections.map(() => "?").join(", ");
  const stmt = db.prepare(`
    SELECT COUNT(DISTINCT d.hash) AS count
    FROM documents d
    LEFT JOIN (
      SELECT hash, COUNT(*) AS chunk_count, MAX(total_chunks) AS expected_chunks
      FROM content_vectors
      WHERE model = ? AND embed_fingerprint = ?
      GROUP BY hash, model, embed_fingerprint
    ) v ON d.hash = v.hash
    WHERE d.active = 1
      AND d.collection IN (${placeholders})
      AND (v.hash IS NULL OR v.chunk_count < v.expected_chunks)
  `);
  const result = stmt.get(model, fingerprint, ...collections);
  return Number(result?.count || 0);
}

export function effectiveEmbeddingStatus(status, needsEmbedding) {
  return { ...status, needsEmbedding };
}
