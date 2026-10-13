import { createApp } from "./app.js";
import { config } from "./config.js";

const { app, axis, architectures, defaultArchitecture, searchBackendKind, embeddingsBackendKind, authEnabled } = createApp(config.databaseUrl, {
  // NOTE: no cache options — caching is disabled in the middleware (always-miss).
  jwtSecret: config.jwtSecret,
  opensearchUrl: config.opensearchUrl,
  opensearchUsername: config.opensearchUsername,
  opensearchPassword: config.opensearchPassword,
  opensearchIndexPrefix: config.opensearchIndexPrefix,
  opensearchSslRejectUnauthorized: config.opensearchSslRejectUnauthorized,
  embeddingUrl: config.embeddingUrl,
  embeddingProvider: config.embeddingProvider,
  embeddingModel: config.embeddingModel,
  embeddingApiKey: config.embeddingApiKey,
  embeddingDimensions: config.embeddingDimensions,
});

const server = app.listen(config.port, () => {
  console.log(`axis-middleware listening on port ${config.port}`);
  console.log(
    `cache: DISABLED (middleware is OpenSearch-only; every request executes)`,
  );
  console.log(
    `search: ${searchBackendKind}${searchBackendKind === "opensearch" ? ` (url=${config.opensearchUrl})` : ""}`,
  );
  console.log(
    `embeddings: ${embeddingsBackendKind}${embeddingsBackendKind !== "none" ? ` (provider=${config.embeddingProvider}, model=${config.embeddingModel})` : ""}`,
  );
  console.log(
    `architectures: ${architectures.join(", ")} (default=${defaultArchitecture}, select via X-Axis-Target)`,
  );
  console.log(
    authEnabled
      ? "auth: enabled (/search requires Bearer JWT, RLS security mappings on)"
      : "auth: DISABLED (/search open — set AXIS_JWT_SECRET to enforce)",
  );
});

async function shutdown(signal: string): Promise<void> {
  console.log(`received ${signal}, shutting down...`);
  server.close();
  try {
    await axis.close();
  } catch (err) {
    console.error("error closing database pool:", err);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection:", reason);
});
