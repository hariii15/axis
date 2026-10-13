import { Pool } from "pg";

import type { DatabaseConfig } from "./types.js";

export function createPool(config: DatabaseConfig): Pool {
  if (!config.url && !config.host) {
    throw new Error(
      "Database configuration requires either 'url' or 'host'.",
    );
  }

  return new Pool({
    connectionString: config.url,

    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,

    max: config.maxConnections ?? 10,

    idleTimeoutMillis:
      config.idleTimeoutMillis ?? 30_000,

    connectionTimeoutMillis:
      config.connectionTimeoutMillis ?? 5_000,
  });
}