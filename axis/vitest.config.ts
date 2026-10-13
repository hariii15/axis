import { defineConfig } from "vitest/config";

// Live-PostgreSQL tests run COUNT(*) over a multi-million-row table,
// which takes seconds on its own and longer under parallel workers.
// The 5s default flakes under full-suite load; 30s keeps it reliable.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
