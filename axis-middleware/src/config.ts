

import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got: ${raw}`);
  }
  return parsed;
}

export const config = {
  port: optionalInt("PORT", 3000),
  databaseUrl: required("DATABASE_URL", "postgres://localhost:5432/postgres"),
  // AXIS_JWT_SECRET: when set, /query requires `Authorization: Bearer <JWT>`
  // and registers tenant/user security mappings (PostgreSQL RLS).
  // When empty, /query stays open (local dev / tests).
  jwtSecret: process.env.AXIS_JWT_SECRET ?? "",
  defaultLimit: optionalInt("AXIS_DEFAULT_LIMIT", 100),
  // --- caching (caching.md §13) — all TTLs in milliseconds ---
  // CACHE_ENABLED: "false" disables caching; anything else (incl. unset) keeps it on.
  cacheEnabled: process.env.CACHE_ENABLED !== "false",
  // CACHE_TTL_MS: default entry lifetime in ms.
  cacheTtlMs: optionalInt("CACHE_TTL_MS", 60_000),
  // VALKEY_URL: when set (non-empty), the middleware uses ValkeyCache;
  // when empty/unset it uses in-process MemoryCache (dev default).
  // Switch to Valkey later by just setting VALKEY_URL — no code change.
  valkeyUrl: process.env.VALKEY_URL ?? "",
  // --- OpenSearch (Phase 2) ---
  // OPENSEARCH_URL: when set, enables OpenSearch adapter
  opensearchUrl: process.env.OPENSEARCH_URL ?? "",
  opensearchUsername: process.env.OPENSEARCH_USERNAME ?? "",
  opensearchPassword: process.env.OPENSEARCH_PASSWORD ?? "",
  opensearchIndexPrefix: process.env.OPENSEARCH_INDEX_PREFIX ?? "",
  opensearchSslRejectUnauthorized: process.env.OPENSEARCH_SSL_REJECT_UNAUTHORIZED !== "false",
  // --- Embeddings (Phase 7) ---
  // EMBEDDING_URL: when set, enables the embedding provider.
  // EMBEDDING_PROVIDER: "ollama" (native /api/embed) or
  // "openai-compatible" (POST /embeddings). @default "ollama"
  // EMBEDDING_MODEL: model name pulled in the container.
  embeddingUrl: process.env.EMBEDDING_URL ?? "",
  embeddingProvider: process.env.EMBEDDING_PROVIDER ?? "ollama",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "",
  embeddingApiKey: process.env.EMBEDDING_API_KEY ?? "",
  embeddingDimensions: process.env.EMBEDDING_DIMENSIONS
    ? Number.parseInt(process.env.EMBEDDING_DIMENSIONS, 10)
    : undefined,
} as const;
