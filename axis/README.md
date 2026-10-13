# Axis — Semantic Layer for PostgreSQL

Axis lets an Express app expose governed analytics without hand-writing SQL per endpoint.
You define **models** (tables → named axes/dimensions + metrics), register them once,
then accept a small JSON query DSL that Axis validates (`Validator`) → parses to an
AST (`AST builder`) → resolves against the model (`Resolver`) → compiles to
parameterized SQL (`Compiler`) → runs on PostgreSQL (`PostgreSQLExecutor`).

Pipeline (see `src/core/query-engine/query-engine.ts`):

```
JSON → parseAxisQuery → buildQueryAST → registry.get(model)
     → resolveQuery → compileQuery → executor.execute
```

## 1. Install in any Express app

Axis is ESM-only (`"type": "module"` in `axis/package.json`, entry
`./dist/index.js` via `exports`). Your Express app must also be ESM:

```json
// axis-middleware/package.json
{
  "type": "module",
  "dependencies": {
    "axis": "file:../axis/axis-1.0.0.tgz",
    "express": "^5.2.1"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "@types/express": "^5.0.6",
    "@types/node": "^22.0.0"
  }
}
```

```json
// axis-middleware/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

Build / pack / consume (from the `axis/` repo):

```bash
npm run build   # tsc → dist/
npm pack        # produces axis-1.0.0.tgz containing dist/ + package.json only
```

Then in the Express app:

```bash
npm install --save "file:../axis/axis-1.0.0.tgz"
npm run build   # tsc, proves `import ... from "axis"` resolves
```

> If `import ... from "axis"` is not detected, check: `axis` `main` is
> `./dist/index.js`, `exports["."].import` points there, and you re-ran
> `npm pack` + `npm install` after changing `src/index.ts`. A stale
> `node_modules/axis` is the most common cause.

## 2. Minimal Express wiring

```ts
// src/server.ts
import express, { type Request, type Response } from "express";
import { Axis } from "axis";

const app = express();
app.use(express.json());

const axis = new Axis({
  database: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/postgres" },
});

app.post("/query", async (req: Request, res: Response) => {
  try {
    const result = await axis.query(req.body);
    res.json({ rows: result.rows, rowCount: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => console.log(`listening on ${port}`));

async function shutdown() {
  server.close();
  await axis.close(); // drains pg Pool
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

Run:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/mydb npm run dev  # tsx watch ./src/server.ts
# or
npm run build && DATABASE_URL=... npm start                        # node ./dist/server.js
```

Example request:

```bash
curl -X POST localhost:3000/query -H "Content-Type: application/json" -d '{
  "model": "PurchaseRequisitions",
  "axes": ["department"],
  "metrics": ["newCount"],
  "filters": [{ "field": "status", "operator": "equals", "value": 1 }],
  "orderBy": [{ "field": "newCount", "direction": "desc" }],
  "limit": 25
}'
```

Response shape (`QueryResult<T>`):

```json
{ "rows": [{ "department": "Sales", "newCount": 42 }], "rowCount": 1 }
```

## 3. Building the semantic layer: models

A model maps one table / SQL / function to governed names.
Real example: `tests/models/fixtures/purchase-requisitions.model.ts`.

```ts
import { defineModel, registerModel } from "axis";

const PurchaseRequisitions = defineModel({
  name: "PurchaseRequisitions",
  source: { type: "table", table: "upeg.requisition_deails" },
  // source can also be:
  // { type: "sql", sql: "SELECT ... FROM ..." }
  // { type: "function", name: "upeg.get_requisitions_for_user", args: ["userId"] }

  axes: {
    id:         { sql: "requisition_id",   type: "string", primaryKey: true },
    status:     { sql: "status",           type: "number" },
    businessUnit: { sql: "business_unit",  type: "string" },
    department: { sql: "department_name",  type: "string" },
    createdAt:  { sql: "created_date",     type: "time" },
    hasAssignedBuyer: {
      sql: `EXISTS (SELECT 1 FROM upeg.requisition_item ri
              WHERE ri.requisition_id = requisition_id
                AND ri.last_buyer_assignment_date IS NOT NULL)`,
      type: "boolean",
    },
  },

  metrics: {
    newCount: { type: "count", description: "Requisitions created in the selected period." },
    pendingCount: {
      type: "count",
      sql: "requisition_id",
      filters: [{ field: "status", operator: "equals", value: 1 }],
    },
  },

  security: {
    function: { name: "upeg.get_requisitions_for_user", args: ["userId"] },
  },
});

// Global registry (simplest for Express):
registerModel(PurchaseRequisitions);
```

Field reference:

| Part | Type | Notes |
|---|---|---|
| `name` | `string` | Unique per registry. Used as `AxisQuery.model`. |
| `source` | `ModelSource` | `table` / `sql` / `function` (see `src/model/types.ts`). |
| `axes` | `Record<string, AxisDefinition>` | `{ sql, type: "string" \| "number" \| "boolean" \| "time", primaryKey?, description? }`. `sql` is a column or expression. |
| `metrics` | `Record<string, MetricDefinition>` | `{ type: "count" \| "countDistinct" \| "sum" \| "avg" \| "min" \| "max", sql?, filters?, description? }`. `sql` may be omitted for bare `count`. `filters` are always AND-ed in. |
| `security` | `ModelSecurity` | `{ sql?, function?: { name, args } }` — row-level restriction hook. |

Rules of thumb:

- One model = one business entity / grain (e.g. requisitions, orders).
- Put raw columns in `axes`, aggregations in `metrics`. Never let clients send SQL.
- Prefer `EXISTS` / expressions inside an axis over exposing join tables.
- Use metric-level `filters` for canned definitions (`pendingCount`, `assignedCount`).
- Use `security.function` for per-user row filtering rather than per-route `WHERE`.

## 4. Query DSL (`AxisQuery`)

Type: `src/core/query/types.ts`.

```ts
import type { AxisQuery } from "axis";

const q: AxisQuery = {
  model: "PurchaseRequisitions", // required, must be registered
  axes: ["department"],          // group-by dimensions (model axis names)
  metrics: ["newCount", "pendingCount"],
  filters: [{ field: "status", operator: "equals", value: 1 }],
  orderBy: [{ field: "newCount", direction: "desc" }], // axis or metric name
  limit: 25,
  offset: 0,
};
```

Filter operators (`FilterOperator`):

`equals`, `notEquals`, `greaterThan`, `greaterThanOrEqual`, `lessThan`,
`lessThanOrEqual`, `in`, `notIn`, `contains`, `startsWith`, `endsWith`,
`isNull`, `isNotNull`.

`FilterValue = string | number | boolean | null | string[] | number[] | boolean[]`
(`in` / `notIn` take arrays; `isNull` / `isNotNull` omit `value`).

`axis.query(input: unknown)` validates this at runtime with `parseAxisQuery`
and throws `ValidationError` on bad shapes — so you can pass `req.body` directly.

## 5. API reference (what `axis` exports)

From `src/index.ts`:

### Facade (use this in Express)

```ts
import { Axis } from "axis";
import type { AxisConfig, DatabaseConfig, QueryResult } from "axis";

const axis = new Axis({ database: { url }, registry?: ModelRegistry });
const out: QueryResult = await axis.query(req.body); // generic: axis.query<MyRow>(...)
await axis.close();
```

- `new Axis(config: AxisConfig)` — creates its own `Database` (pg `Pool`) + `AxisQueryEngine`. `AxisConfig = { database: DatabaseConfig; registry?: ModelRegistry }`. Omit `registry` to use the global `defaultModelRegistry`.
- `query<T>(input: unknown): Promise<QueryResult<T>>` — full pipeline (validate → AST → resolve → compile → execute). Returns `{ rows: T[]; rowCount: number }`.
- `close(): Promise<void>` — `pool.end()`. Call on shutdown.

### Lower-level composition (same result, more control)

```ts
import { Database, AxisQueryEngine, ModelRegistry } from "axis";

const database = new Database({ url: process.env.DATABASE_URL });
const registry = new ModelRegistry();
registry.register(PurchaseRequisitions);

const engine = new AxisQueryEngine(database, registry);
const result = await engine.query({ model: "PurchaseRequisitions", metrics: ["newCount"] });
engine.getRegistry(); // → ModelRegistry
await database.close();
```

- `Database` (`src/core/database/database.ts`): `new Database(config)`, `query(sql, params?)`, `testConnection()`, `close()`, `getPool(): Pool`. Pool created by `createPool` (`src/core/database/pool.ts`): requires `url` or `host`; defaults `maxConnections: 10`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`.
- `DatabaseConfig`: `{ url?, host?, port?, database?, user?, password?, maxConnections?, idleTimeoutMillis?, connectionTimeoutMillis? }`.
- `AxisQueryEngine`: `new AxisQueryEngine(database, registry = defaultModelRegistry)`, `query<T>(input)`, `getRegistry()`.
- `PostgreSQLExecutor` is internal (used by the engine); direct use is not exported.

### Models / registry

```ts
import { defineModel, ModelRegistry, defaultModelRegistry,
         registerModel, getModel, hasModel } from "axis";
import type { ModelDefinition, AxisDefinition, MetricDefinition,
              ModelSource, AxisType, MetricType, ModelSecurity } from "axis";

defineModel(def: ModelDefinition): ModelDefinition // identity helper with type-checking
registerModel(model)  // → defaultModelRegistry.register
getModel(name)        // → ModelDefinition or throw
hasModel(name)        // → boolean
```

`ModelRegistry` methods: `register(model)` (throws on duplicate name),
`get(name)` (throws if missing), `has(name)`, `remove(name): boolean`,
`clear()`, `size: number`, `getAll(): ModelDefinition[]`.

Use a private `new ModelRegistry()` + `new Axis({ database, registry })` for
multi-tenant isolation; use the global helpers for a single-tenant app.

### Request context / JWT (NOT in the library)

Authentication lives outside this package (see `axis-middleware`):
JWT verification, claim mapping, and Express wiring belong to the
application. The library only accepts a generic
`AxisContext = Record<string, unknown>` plus application-registered
`AxisSecurityConfig` mappings, and applies them as transaction-scoped
PostgreSQL session settings (`SET LOCAL` semantics) for RLS.

## 6. Larger Express example (models + listing + errors)

```ts
import express from "express";
import { Axis, registerModel, getModel } from "axis";
import { PurchaseRequisitions } from "./models/purchase-requisitions.js";

registerModel(PurchaseRequisitions);

const axis = new Axis({ database: { url: process.env.DATABASE_URL! } });
const app = express();
app.use(express.json());

app.get("/models", (_req, res) => {
  res.json({ models: [getModel("PurchaseRequisitions")] });
});

app.post("/query/:model?", async (req, res) => {
  try {
    const body = req.params.model ? { ...req.body, model: req.params.model } : req.body;
    res.json(await axis.query(body));
  } catch (err: any) {
    const status = err?.name === "ValidationError" ? 400 : 500;
    res.status(status).json({ error: err.message, issues: err.issues ?? undefined });
  }
});

app.listen(3000);
```

Isolated registry instead of global:

```ts
import { Axis, ModelRegistry } from "axis";
const registry = new ModelRegistry();
registry.register(PurchaseRequisitions);
const axis = new Axis({ database: { url }, registry });
```

## 7. Troubleshooting

- `Cannot find module 'axis'` / `has no exported member 'Database'`: you installed a stale `.tgz`. Rebuild + repack + reinstall (Section 1).
- `Database configuration requires either 'url' or 'host'`: `DATABASE_URL` is empty — `createPool` enforces this.
- `Model "X" is not registered`: you forgot `registerModel` (or passed a custom empty registry to `Axis`).
- `ValidationError`: inspect `err.issues: { path, message }[]` from `parseAxisQuery`.
- CJS app importing ESM `axis` fails with `ERR_REQUIRE_ESM`: convert the app to `"type": "module"` with `module/moduleResolution: NodeNext` and import with explicit `.js` extensions in relative imports.
