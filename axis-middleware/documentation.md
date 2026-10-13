# Axis — Documentation

Axis is a lightweight analytics layer for your Postgres database.

Instead of writing raw SQL on the frontend or building one-off REST endpoints for every dashboard, you:

1. **Define a Model** once (what table to read, what fields exist).
2. **Query it** with a simple JSON object (what to group by, what to count).

Axis takes care of generating safe, correct SQL for you.

Think of it like React, but for data:

- React: you describe *what UI you want*, React renders the DOM.
- Axis: you describe *what data you want*, Axis fetches it from Postgres.

You never write SQL when querying. You only pick **axes** (group by) and **metrics** (numbers).

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Core Concepts](#2-core-concepts)
3. [Querying Data](#3-querying-data)
4. [Filters](#4-filters)
5. [Sorting and Pagination](#5-sorting-and-pagination)
6. [Defining a Model](#6-defining-a-model)
7. [Axes in Detail](#7-axes-in-detail)
8. [Metrics in Detail](#8-metrics-in-detail)
9. [API Reference](#9-api-reference)
10. [Error Handling](#10-error-handling)
11. [Full Example](#11-full-example)
12. [FAQ](#12-faq)

---

## 1. Quick Start

### 1.1. Start the server

```bash
# 1. Set your database connection
# .env
DATABASE_URL=postgresql://postgres:password@localhost:5432/purchase
PORT=3000

# 2. Install and run
npm install
npm run dev
```

Check it is running:

```bash
curl http://localhost:3000/health
# { "ok": true }
```

### 1.2. See what models are available

A **model** is a named dataset you can query, e.g. `PurchaseRequisitions`.

```bash
curl http://localhost:3000/models
```

```json
{
  "data": [
    {
      "name": "PurchaseRequisitions",
      "axes": ["id", "status", "businessUnit", "department", "createdAt", "hasAssignedBuyer"],
      "metrics": ["newCount", "pendingCount", "assignedCount"],
      "description": null
    }
  ]
}
```

This tells you everything you can ask for. You do not need to know table names or column names.

### 1.3. Run your first query

Count all purchase requisitions, grouped by department:

```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{
    "model": "PurchaseRequisitions",
    "axes": ["department"],
    "metrics": ["newCount"]
  }'
```

Response:

```json
{
  "data": {
    "rows": [
      { "department": "Sales", "newCount": 42 },
      { "department": "Engineering", "newCount": 18 }
    ],
    "rowCount": 2
  },
  "meta": {
    "model": "PurchaseRequisitions"
  }
}
```

That is the whole flow. Let's break down *why* it works.

---

## 2. Core Concepts

There are only three things you need to learn:

| Concept | What it is | Example |
|---|---|---|
| **Model** | A named dataset you can query. One model = one business question area. | `PurchaseRequisitions` |
| **Axis** | A field you **group by** or **see as a column**. Answers *"split it by what?"* | `department`, `status`, `createdAt` |
| **Metric** | A number that is **calculated** for you. Answers *"how many / how much?"* | `newCount`, `pendingCount` |

A query is always:

> **From this Model**, show me these **Axes** with these **Metrics**, optionally **filtered**, **sorted**, and **paginated**.

```js
// The shape of every query
const query = {
  model: "PurchaseRequisitions", // required: which dataset
  axes: ["department"],          // optional: group by / show columns
  metrics: ["newCount"],         // optional: numbers to calculate
  filters: [],                   // optional: narrow rows down
  orderBy: [],                   // optional: sort rows
  limit: 100,                    // optional: page size
  offset: 0                      // optional: page start
};

// You must include at least one of `axes` or `metrics`.
```

In JavaScript:

```js
const res = await fetch("http://localhost:3000/query", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "PurchaseRequisitions",
    axes: ["department"],
    metrics: ["newCount"],
  }),
});

const { data } = await res.json();
console.log(data.rows);
// [{ department: "Sales", newCount: 42 }, ...]
```

---

## 3. Querying Data

There are two equivalent ways to query. Use whichever is cleaner for you.

### Option A: `POST /query` (model in the body)

```json
{
  "model": "PurchaseRequisitions",
  "axes": ["department"],
  "metrics": ["newCount"]
}
```

### Option B: `POST /query/:model` (model in the URL)

```bash
curl -X POST http://localhost:3000/query/PurchaseRequisitions \
  -H "Content-Type: application/json" \
  -d '{
    "axes": ["department"],
    "metrics": ["newCount"]
  }'
```

Both return the same shape:

```json
{
  "data": {
    "rows": [{ "department": "Sales", "newCount": 42 }],
    "rowCount": 1
  },
  "meta": {
    "model": "PurchaseRequisitions",
    "limit": 10,
    "offset": 0
  }
}
```

- `data.rows` — the actual results. Each key is an axis or metric name you asked for.
- `data.rowCount` — how many rows were returned.
- `meta` — echoes back `model`, `limit`, and `offset` (only if you sent them).

### Three common query patterns

**1. Just numbers (no grouping)**

Get a single total:

```json
{
  "model": "PurchaseRequisitions",
  "metrics": ["newCount", "pendingCount", "assignedCount"]
}
```

```json
{
  "data": {
    "rows": [{ "newCount": 120, "pendingCount": 30, "assignedCount": 85 }],
    "rowCount": 1
  }
}
```

**2. Just breakdown (no numbers)**

List all departments:

```json
{
  "model": "PurchaseRequisitions",
  "axes": ["department"]
}
```

**3. Grouped numbers (most common)**

Count per department:

```json
{
  "model": "PurchaseRequisitions",
  "axes": ["department"],
  "metrics": ["newCount", "pendingCount"]
}
```

> Rule: a query must contain at least one `axes` entry or one `metrics` entry. An empty query is rejected.

---

## 4. Filters

Filters narrow down *which rows* are counted. Each filter has a `field`, an `operator`, and a `value` (except `isNull` / `isNotNull`, which take no value).

```json
{
  "model": "PurchaseRequisitions",
  "metrics": ["newCount"],
  "filters": [
    { "field": "status", "operator": "equals", "value": 1 }
  ]
}
```

You can combine multiple filters (they are AND-ed together):

```json
{
  "model": "PurchaseRequisitions",
  "axes": ["department"],
  "metrics": ["newCount"],
  "filters": [
    { "field": "status", "operator": "equals", "value": 1 },
    { "field": "businessUnit", "operator": "equals", "value": "Retail" }
  ]
}
```

### All operators

| Operator | Meaning | Example value |
|---|---|---|
| `equals` | Exactly matches | `{ "field": "status", "operator": "equals", "value": 1 }` |
| `notEquals` | Does not match | `{ "field": "status", "operator": "notEquals", "value": 2 }` |
| `greaterThan` | `>` | `{ "field": "status", "operator": "greaterThan", "value": 1 }` |
| `greaterThanOrEqual` | `>=` | `{ "field": "status", "operator": "greaterThanOrEqual", "value": 1 }` |
| `lessThan` | `<` | `{ "field": "status", "operator": "lessThan", "value": 5 }` |
| `lessThanOrEqual` | `<=` | `{ "field": "status", "operator": "lessThanOrEqual", "value": 5 }` |
| `in` | Value is one of a list | `{ "field": "status", "operator": "in", "value": [1, 2, 3] }` |
| `notIn` | Value is none of a list | `{ "field": "status", "operator": "notIn", "value": [0, 9] }` |
| `contains` | Text contains substring | `{ "field": "department", "operator": "contains", "value": "sales" }` |
| `startsWith` | Text starts with | `{ "field": "department", "operator": "startsWith", "value": "Eng" }` |
| `endsWith` | Text ends with | `{ "field": "department", "operator": "endsWith", "value": "ing" }` |
| `isNull` | Field is empty (no `value`) | `{ "field": "department", "operator": "isNull" }` |
| `isNotNull` | Field is not empty (no `value`) | `{ "field": "department", "operator": "isNotNull" }` |

> Tip: `field` refers to an **axis name** (like `department`, `status`), not a raw database column. If you are unsure, check `GET /models`.

---

## 5. Sorting and Pagination

### Sorting with `orderBy`

Sort by any axis or metric you selected:

```json
{
  "model": "PurchaseRequisitions",
  "axes": ["department"],
  "metrics": ["newCount"],
  "orderBy": [{ "field": "newCount", "direction": "desc" }]
}
```

- `direction` is either `"asc"` (small → large, A → Z) or `"desc"` (large → small, Z → A).
- You can sort by multiple fields — the first entry has the highest priority:

```json
"orderBy": [
  { "field": "department", "direction": "asc" },
  { "field": "newCount", "direction": "desc" }
]
```

### Pagination with `limit` and `offset`

```json
{
  "model": "PurchaseRequisitions",
  "axes": ["department"],
  "metrics": ["newCount"],
  "limit": 10,
  "offset": 20
}
```

- `limit` — max rows to return. Must be a positive whole number (e.g. `10`).
- `offset` — how many rows to skip. Must be `0` or higher. Use it for "page 2", "page 3", etc.

```js
// Page 1
{ model: "PurchaseRequisitions", axes: ["department"], limit: 10, offset: 0 }
// Page 2
{ model: "PurchaseRequisitions", axes: ["department"], limit: 10, offset: 10 }
// Page 3
{ model: "PurchaseRequisitions", axes: ["department"], limit: 10, offset: 20 }
```

---

## 6. Defining a Model

> This section is for **backend developers** who create new datasets. If you only consume the API, you can skip to [API Reference](#9-api-reference).

A model is defined once in TypeScript with `defineModel`. It maps friendly names (`department`) to database columns (`department_name`).

```ts
import { defineModel } from "axis";

export const PurchaseRequisitions = defineModel({
  name: "PurchaseRequisitions",

  source: {
    type: "table",
    table: "upeg.requisition_deails",
  },

  axes: {
    id: { sql: "requisition_id", type: "string", primaryKey: true },
    status: { sql: "status", type: "number" },
    businessUnit: { sql: "business_unit", type: "string" },
    department: { sql: "department_name", type: "string" },
    createdAt: { sql: "created_date", type: "time" },
  },

  metrics: {
    newCount: {
      type: "count",
      description: "Requisitions created in the selected period.",
    },
    pendingCount: {
      type: "count",
      sql: "requisition_id",
      filters: [{ field: "status", operator: "equals", value: 1 }],
    },
  },
});
```

Then register it so the server can serve it:

```ts
import { Axis, ModelRegistry } from "axis";
import { PurchaseRequisitions } from "./models/purchase-requisitions.js";

const registry = new ModelRegistry();
registry.register(PurchaseRequisitions);

const axis = new Axis({
  database: { url: process.env.DATABASE_URL },
  registry,
});
```

That's it. The model now appears in `GET /models` and can be queried via `POST /query`.

### The three parts of a model

| Part | Purpose | Example |
|---|---|---|
| `source` | Which table (or SQL / function) the data comes from. | `{ type: "table", table: "upeg.requisition_deails" }` |
| `axes` | The fields users can see, group by, filter, and sort. | `department: { sql: "department_name", type: "string" }` |
| `metrics` | The pre-built calculations users can request. | `pendingCount: { type: "count", ... }` |

---

## 7. Axes in Detail

An axis is a **named, readable field**. Users pick axes when they want to *see* or *group by* something.

```ts
axes: {
  department: { sql: "department_name", type: "string" },
  status: { sql: "status", type: "number" },
  createdAt: { sql: "created_date", type: "time" },
  hasAssignedBuyer: { sql: "...", type: "boolean" },
}
```

Each axis has:

| Property | Required | What it means |
|---|---|---|
| `sql` | Yes | The database column or expression behind this name. Users never see this. |
| `type` | Yes | One of `"string"`, `"number"`, `"boolean"`, `"time"`. Tells Axis how to handle the value. |
| `primaryKey` | No | Mark the unique ID axis (e.g. `id`). Helps Axis identify rows. |
| `description` | No | Human-readable hint shown in docs / tooling. |

**Axis types:**

- `string` — text (`department`, `businessUnit`)
- `number` — numeric (`status`)
- `boolean` — true/false (`hasAssignedBuyer`)
- `time` — dates and timestamps (`createdAt`)

**When to add an axis:** whenever the frontend needs to display, group, filter, or sort by that field. If it should never be shown to users, don't expose it as an axis.

---

## 8. Metrics in Detail

A metric is a **pre-built number**. Users pick metrics when they want to know *how many* or *how much* — without writing aggregation logic themselves.

```ts
metrics: {
  // Simple row count — no `sql` needed
  newCount: {
    type: "count",
    description: "Requisitions created in the selected period.",
  },

  // Count with a built-in filter — always counts only pending rows
  pendingCount: {
    type: "count",
    sql: "requisition_id",
    filters: [{ field: "status", operator: "equals", value: 1 }],
  },
}
```

Each metric has:

| Property | Required | What it means |
|---|---|---|
| `type` | Yes | How to calculate it: `"count"`, `"countDistinct"`, `"sum"`, `"avg"`, `"min"`, `"max"`. |
| `sql` | Sometimes | Which column to calculate on. Optional for plain `count` (counts rows); required for `sum`, `avg`, `min`, `max`, `countDistinct`. |
| `filters` | No | Conditions baked into the metric. Every time someone asks for `pendingCount`, the `status = 1` filter is applied automatically. |
| `description` | No | Human-readable hint for API consumers. |

**Metric types:**

| Type | What it calculates | Needs `sql`? |
|---|---|---|
| `count` | Number of rows (or non-empty values) | No — omit to count rows |
| `countDistinct` | Number of unique values | Yes |
| `sum` | Total of a numeric column | Yes |
| `avg` | Average of a numeric column | Yes |
| `min` | Smallest value | Yes |
| `max` | Largest value | Yes |

**Example — all metric types:**

```ts
metrics: {
  newCount: { type: "count" },
  uniqueDepartments: { type: "countDistinct", sql: "department_name" },
  totalAmount: { type: "sum", sql: "amount" },
  averageAmount: { type: "avg", sql: "amount" },
  smallestAmount: { type: "min", sql: "amount" },
  largestAmount: { type: "max", sql: "amount" },
}
```

> Guideline: put business logic in metrics, not in frontend code. If "pending" always means `status = 1`, encode that in a `pendingCount` metric so every dashboard counts it the same way.

---

## 9. API Reference

### `GET /health`

Check the server is up. No input needed.

```bash
curl http://localhost:3000/health
# { "ok": true }
```

### `GET /models`

List every available model with its axes and metrics.

```bash
curl http://localhost:3000/models
```

```json
{
  "data": [
    {
      "name": "PurchaseRequisitions",
      "axes": ["id", "status", "businessUnit", "department"],
      "metrics": ["newCount", "pendingCount"],
      "description": null
    }
  ]
}
```

### `POST /query` and `POST /query/:model`

Run a query. Request body:

| Field | Type | Required | Rules |
|---|---|---|---|
| `model` | `string` | Yes (or via URL `:model`) | Must match a name from `GET /models`. |
| `axes` | `string[]` | At least one of `axes` / `metrics` | Each must be a valid axis name. No empty strings. |
| `metrics` | `string[]` | At least one of `axes` / `metrics` | Each must be a valid metric name. No empty strings. |
| `filters` | `Filter[]` | No | Each needs `field`, valid `operator`, and a matching `value` (except `isNull` / `isNotNull`). |
| `orderBy` | `{ field, direction }[]` | No | `field` must be a selected axis/metric; `direction` is `"asc"` or `"desc"`. |
| `limit` | `number` | No | Positive whole number (`1`, `10`, `100`). |
| `offset` | `number` | No | Zero or higher whole number (`0`, `10`). |

Success response (`200`):

```json
{
  "data": { "rows": [...], "rowCount": 2 },
  "meta": { "model": "PurchaseRequisitions", "limit": 10, "offset": 0 }
}
```

---

## 10. Error Handling

All errors use the same envelope:

```json
{
  "error": {
    "message": "Human-readable reason",
    "code": "ValidationError",
    "issues": [...]
  }
}
```

| Status | Code | What it means | What to do |
|---|---|---|---|
| `400` | `ValidationError` | The query shape is invalid (missing model, empty axes/metrics, bad limit, bad operator, etc.). `issues` lists each problem. | Fix the request body. |
| `400` | `InvalidJson` | The request body is not valid JSON. | Check for trailing commas / broken quotes. |
| `422` | `ResolutionError` / `CompilationError` | The shape is valid, but a name is wrong (unknown model, axis, or metric). | Call `GET /models` and use exact names. |
| `404` | `NotFound` | Wrong URL or wrong HTTP method (e.g. `GET /query`). | Use `POST /query` or `POST /query/:model`. |
| `502` | `ExecutionError` / `DatabaseError` | The query was fine, but the database failed. | Retry; if it persists, check the database. |
| `500` | `InternalError` | Unexpected server error. | Check server logs. |

Example — unknown metric:

```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{ "model": "PurchaseRequisitions", "metrics": ["nope"] }'
# Status: 422
# { "error": { "message": "... does not exist ...", "code": "ResolutionError" } }
```

Frontend pattern:

```js
const res = await fetch("http://localhost:3000/query", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(query),
});

const body = await res.json();

if (!res.ok) {
  // body.error.message is safe to show or log
  // body.error.issues (only on 400) lists field-level problems
  throw new Error(body.error.message);
}

return body.data.rows;
```

---

## 11. Full Example

Dashboard: "Pending requisitions by department, top 5."

```js
async function getPendingByDepartment() {
  const res = await fetch("http://localhost:3000/query/PurchaseRequisitions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      axes: ["department"],
      metrics: ["pendingCount", "newCount"],
      filters: [
        { field: "businessUnit", operator: "equals", value: "Retail" },
      ],
      orderBy: [{ field: "pendingCount", direction: "desc" }],
      limit: 5,
      offset: 0,
    }),
  });

  const body = await res.json();
  if (!res.ok) throw new Error(body.error.message);

  // body.data.rows =
  // [
  //   { department: "Sales", pendingCount: 12, newCount: 40 },
  //   { department: "Support", pendingCount: 9, newCount: 25 },
  //   ...
  // ]

  return body.data.rows;
}
```

Equivalent `curl`:

```bash
curl -X POST http://localhost:3000/query/PurchaseRequisitions \
  -H "Content-Type: application/json" \
  -d '{
    "axes": ["department"],
    "metrics": ["pendingCount", "newCount"],
    "filters": [
      { "field": "businessUnit", "operator": "equals", "value": "Retail" }
    ],
    "orderBy": [{ "field": "pendingCount", "direction": "desc" }],
    "limit": 5,
    "offset": 0
  }'
```

---

## 12. FAQ

**Do I need to know SQL?**
No — if you only *query*. Pick a model, axes, and metrics. You only need SQL if you *define* new models on the backend.

**What is the difference between an axis and a metric?**
An axis is something you group by (`department`). A metric is something calculated (`newCount`). If it answers "split by what?", it's an axis. If it answers "how many?", it's a metric.

**Where do I find valid axis / metric names?**
Call `GET /models`. Names are case-sensitive — `department` and `Department` are different.

**Why did my query fail with 400?**
The request shape is wrong. Read `error.issues` — it tells you exactly which field failed (e.g. `limit` must be positive, `operator` must be `equals`, not `equal`).

**Why did my query fail with 422?**
The shape is fine, but a name doesn't exist. You asked for a model, axis, or metric that isn't defined. Compare against `GET /models`.

**Can I filter on anything?**
Filter `field` should be an axis name from the model. Operators like `contains` / `startsWith` are meant for text axes; comparison operators (`greaterThan`, etc.) for numbers and dates.

**How do I add a new dataset?**
Define a model with `defineModel`, register it in the server, restart. It will show up in `GET /models` automatically — no frontend changes needed for discovery.

---

*This document is structured so it can be converted to HTML later with no content changes — headings, tables, and code blocks map directly to styled sections.*
