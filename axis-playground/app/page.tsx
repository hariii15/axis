"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface ModelInfo {
  name: string;
  axes: string[];
  metrics: string[];
  description?: string | null;
}

interface IndexInfo {
  model: string;
  index: string;
  docs?: number;
  error?: string;
}

interface ArchitectureInfo {
  name: string;
  datasource: string;
  models: string[];
  default: boolean;
}

interface FilterRow {
  field: string;
  operator: string;
  value: string;
}

interface OrderRow {
  field: string;
  direction: "asc" | "desc";
}

interface SendResult {
  status: number | null;
  ms: number | null;
  body: unknown;
  sentUrl: string;
  sentBody: unknown;
  error?: string;
}

const OPERATORS = [
  "equals", "notEquals", "greaterThan", "greaterThanOrEqual",
  "lessThan", "lessThanOrEqual", "in", "notIn", "contains",
  "startsWith", "endsWith", "isNull", "isNotNull",
];

const NO_VALUE_OPS = new Set(["isNull", "isNotNull"]);

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return trimmed;
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.trim().split(".");
    if (parts.length !== 3 || !parts[1]) return null;
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default function Home() {
  const [baseUrl, setBaseUrl] = useState("http://localhost:3000");
  const [token, setToken] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [indices, setIndices] = useState<IndexInfo[]>([]);
  const [architectures, setArchitectures] = useState<ArchitectureInfo[]>([]);
  const [architecture, setArchitecture] = useState("A2");
  const [connectError, setConnectError] = useState("");
  const [tab, setTab] = useState<"builder" | "json">("builder");

  // builder state
  const [model, setModel] = useState("PurchaseRequisitions");
  const [axes, setAxes] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<string[]>(["newCount"]);
  const [searchType, setSearchType] = useState("none");
  const [searchText, setSearchText] = useState("");
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [orderBy, setOrderBy] = useState<OrderRow[]>([]);
  const [limit, setLimit] = useState("10");
  const [offset, setOffset] = useState("0");

  const [rawJson, setRawJson] = useState(
    JSON.stringify(
      { model: "PurchaseRequisitions", axes: ["department"], metrics: ["newCount"], limit: 10 },
      null,
      2,
    ),
  );
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  useEffect(() => {
    try {
      const b = localStorage.getItem("axis.baseUrl");
      if (b) setBaseUrl(b);
      const t = localStorage.getItem("axis.token");
      if (t) setToken(t);
      const th = localStorage.getItem("axis.theme");
      if (th === "dark" || th === "light") {
        setTheme(th);
      } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        setTheme("dark");
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("axis.theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const connect = useCallback(async () => {
    setConnectError("");
    const base = baseUrl.replace(/\/$/, "");
    try {
      const [mRes, iRes, aRes] = await Promise.all([
        fetch(`${base}/models`),
        fetch(`${base}/os/indices`),
        fetch(`${base}/architectures`),
      ]);
      if (!mRes.ok) throw new Error(`GET /models -> ${mRes.status}`);
      const mJson = (await mRes.json()) as { data: ModelInfo[] };
      setModels(mJson.data ?? []);
      if (mJson.data?.length > 0 && mJson.data[0]) setModel(mJson.data[0].name);
      if (iRes.ok) {
        const iJson = (await iRes.json()) as { data: IndexInfo[] };
        setIndices(iJson.data ?? []);
      } else {
        setIndices([]);
      }
      if (aRes.ok) {
        const aJson = (await aRes.json()) as {
          data: ArchitectureInfo[];
          meta: { default: string };
        };
        setArchitectures(aJson.data ?? []);
        if (aJson.meta?.default) setArchitecture(aJson.meta.default);
        // Root the builder in the default architecture's first model so
        // multi-model architectures (A2) start on a member model.
        const defEntry = (aJson.data ?? []).find((a) => a.name === aJson.meta?.default);
        if (defEntry?.models[0]) {
          setModel(defEntry.models[0]);
          setAxes([]);
          setMetrics([]);
        }
      } else {
        setArchitectures([]);
      }
      try {
        localStorage.setItem("axis.baseUrl", base);
      } catch {
        /* ignore */
      }
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err));
      setModels([]);
      setIndices([]);
    }
  }, [baseUrl]);

  useEffect(() => {
    void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeModel = useMemo(
    () => models.find((m) => m.name === model),
    [models, model],
  );

  // Member models of the selected architecture (from GET /architectures).
  // Single-model architectures resolve to [root]; A2 resolves to all three,
  // each rendered with its own field section below.
  const memberNames = useMemo(() => {
    const entry = architectures.find((a) => a.name === architecture);
    if (entry && entry.models.length > 0) return [...entry.models];
    return activeModel ? [activeModel.name] : [];
  }, [architectures, architecture, activeModel]);

  const memberModels = useMemo(
    () =>
      memberNames
        .map((n) => models.find((m) => m.name === n))
        .filter((m): m is ModelInfo => m !== undefined),
    [memberNames, models],
  );

  const joinedNames = useMemo(
    () => memberNames.filter((n) => n !== model),
    [memberNames, model],
  );

  // Query ref for a field: bare on the root model, `Model.field` elsewhere.
  const refFor = (modelName: string, field: string) =>
    modelName === model ? field : `${modelName}.${field}`;

  const allFilterFields = useMemo(() => {
    const fields: string[] = [...(activeModel?.axes ?? [])];
    for (const m of memberModels) {
      if (m.name === model) continue;
      for (const a of m.axes) fields.push(`${m.name}.${a}`);
    }
    return fields;
  }, [activeModel, memberModels, model]);

  const allOrderFields = useMemo(() => {
    const fields = [...(activeModel?.axes ?? []), ...(activeModel?.metrics ?? [])];
    for (const m of memberModels) {
      if (m.name === model) continue;
      for (const a of m.axes) fields.push(`${m.name}.${a}`);
      for (const mt of m.metrics) fields.push(`${m.name}.${mt}`);
    }
    return fields;
  }, [activeModel, memberModels, model]);

  // Rebase a `Model.field`/bare ref from one root model to another so
  // switching the root never silently drops selected fields.
  const rebaseRef = (ref: string, oldRoot: string, newRoot: string) => {
    const dot = ref.indexOf(".");
    const owner = dot < 0 ? oldRoot : ref.slice(0, dot);
    const field = dot < 0 ? ref : ref.slice(dot + 1);
    return owner === newRoot ? field : `${owner}.${field}`;
  };

  const changeRootModel = (newRoot: string) => {
    if (newRoot === model) return;
    const oldRoot = model;
    setModel(newRoot);
    setAxes((prev) => prev.map((r) => rebaseRef(r, oldRoot, newRoot)));
    setMetrics((prev) => prev.map((r) => rebaseRef(r, oldRoot, newRoot)));
    setFilters((prev) =>
      prev.map((f) => ({ ...f, field: rebaseRef(f.field, oldRoot, newRoot) })),
    );
    setOrderBy((prev) =>
      prev.map((o) => ({ ...o, field: rebaseRef(o.field, oldRoot, newRoot) })),
    );
  };

  const changeArchitecture = (name: string) => {
    setArchitecture(name);
    const entry = architectures.find((a) => a.name === name);
    const first = entry?.models[0];
    if (first && first !== model) {
      setModel(first);
      setAxes([]);
      setMetrics([]);
      setFilters([]);
      setOrderBy([]);
    }
  };

  const builtBody = useMemo(() => {
    const body: Record<string, unknown> = { model };
    if (axes.length > 0) body.axes = axes;
    if (metrics.length > 0) body.metrics = metrics;
    if (searchType !== "none" && searchText.trim() !== "") {
      body.search = { type: searchType, text: searchText.trim() };
    }
    if (filters.length > 0) {
      body.filters = filters.map((f) =>
        NO_VALUE_OPS.has(f.operator)
          ? { field: f.field, operator: f.operator }
          : { field: f.field, operator: f.operator, value: parseValue(f.value) },
      );
    }
    if (orderBy.length > 0) body.orderBy = orderBy;
    const lim = Number(limit);
    if (Number.isFinite(lim)) body.limit = lim;
    const off = Number(offset);
    if (Number.isFinite(off)) body.offset = off;
    return body;
  }, [model, axes, metrics, searchType, searchText, filters, orderBy, limit, offset]);

  const decoded = useMemo(() => (token.trim() === "" ? null : decodeJwt(token)), [token]);

  const send = useCallback(
    async (body: unknown) => {
      setSending(true);
      setResult(null);
      const url = `${baseUrl.replace(/\/$/, "")}/search`;
      const started = performance.now();
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token.trim() !== "") headers.Authorization = `Bearer ${token.trim()}`;
        headers["X-Axis-Target"] = architecture;
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* keep raw text */
        }
        setResult({ status: res.status, ms: Math.round(performance.now() - started), body: parsed, sentUrl: url, sentBody: body });
      } catch (err) {
        setResult({
          status: null, ms: Math.round(performance.now() - started), body: null,
          sentUrl: url, sentBody: body, error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setSending(false);
        try {
          localStorage.setItem("axis.token", token);
        } catch {
          /* ignore */
        }
      }
    },
    [baseUrl, token, architecture],
  );
  const sendBuilder = useCallback(() => void send(builtBody), [send, builtBody]);

  const sendRaw = useCallback(() => {
    try {
      void send(JSON.parse(rawJson) as unknown);
    } catch (err) {
      setResult({
        status: null, ms: null, body: null, sentUrl: "", sentBody: null,
        error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, [send, rawJson]);

  const toggle = (list: string[], v: string, set: (x: string[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const statusClass = result?.status == null ? "idle" : result.status >= 200 && result.status < 300 ? "ok" : "err";

  return (
    <div className="container">
      <header className="top">
        <button className="theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
        <h1>Axis Playground</h1>
      </header>

      <div className="card">
        <h2>Connection</h2>
        <div className="row">
          <div>
            <label className="lbl" htmlFor="base">Middleware base URL</label>
            <input id="base" type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
            <button className="btn-ghost" onClick={() => void connect()}>Connect</button>
          </div>
        </div>
        {connectError !== "" && <div className="err-text">{connectError} — is the middleware running?</div>}
        {models.length > 0 && indices.length === 0 && (
          <div className="hint">Index counts unavailable — restart the middleware (it serves /os/indices) and hit Connect.</div>
        )}
        <div className="models-list">
        {models.map((m) => {
          const idx = indices.find((i) => i.model === m.name);
          return (
            <div className="model-card" key={m.name}>
              <span className="name">{m.name}</span>{" "}
              <span className="idx">
                index: {idx?.index ?? "?"} · docs: {idx?.docs ?? (idx?.error ?? "?")}
              </span>
              <div className="hint">axes: {m.axes.join(", ") || "—"}</div>
              <div className="hint">metrics: {m.metrics.join(", ") || "—"}</div>
            </div>
          );
        })}
        </div>
      </div>

      <div className="grid-2">
        <div>
          <div className="card">
            <div className="tabs">
              <button className={tab === "builder" ? "active" : ""} onClick={() => setTab("builder")}>Query Builder</button>
              <button className={tab === "json" ? "active" : ""} onClick={() => setTab("json")}>Raw JSON</button>
            </div>

            {tab === "builder" && (
              <>
                <div className="row">
                  <div style={{ flex: 1 }}>
                    <label className="lbl" htmlFor="arch">Architecture (X-Axis-Target)</label>
                    <select id="arch" value={architecture} onChange={(e) => changeArchitecture(e.target.value)}>
                      {(architectures.length > 0
                        ? architectures.map((a) => a.name)
                        : ["A", "A2", "C"]
                      ).map((name) => (
                        <option key={name} value={name}>
                          {name}
                          {architectures.find((a) => a.name === name)
                            ? ` — ${architectures.find((a) => a.name === name)?.datasource}`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 2 }}>
                    <label className="lbl" htmlFor="model">Root model</label>
                    <select id="model" value={model} onChange={(e) => changeRootModel(e.target.value)}>
                      {(memberNames.length > 0 ? memberNames : models.map((m) => m.name)).map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {architectures.length > 0 && (
                  <div className="hint">
                    {architectures.find((a) => a.name === architecture)?.models.join(", ") ?? ""}
                    {" → "}
                    {architectures.find((a) => a.name === architecture)?.datasource ?? ""}
                    {architecture === "C" ? " (not implemented yet — expect 501)" : ""}
                    {joinedNames.length > 0
                      ? ` · root ${model} joins ${joinedNames.join(", ")} (1:N)`
                      : ""}
                  </div>
                )}

                <h3>Axes (group by)</h3>
                {(memberModels.length > 0 ? memberModels : activeModel ? [activeModel] : []).map((m) => (
                  <div key={`axes-${m.name}`}>
                    {memberNames.length > 1 && (
                      <div className="hint" style={{ margin: "6px 0 2px" }}>
                        {m.name}{m.name === model ? " (root — bare names)" : " (joined — sent as Model.field)"}
                      </div>
                    )}
                    <div className="chips">
                      {m.axes.map((a) => {
                        const ref = refFor(m.name, a);
                        return (
                          <label key={ref} className={`chip${axes.includes(ref) ? " on" : ""}`}>
                            <input type="checkbox" checked={axes.includes(ref)} onChange={() => toggle(axes, ref, setAxes)} />{ref}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <h3>Metrics (aggregations)</h3>
                {(memberModels.length > 0 ? memberModels : activeModel ? [activeModel] : []).map((m) => (
                  <div key={`metrics-${m.name}`}>
                    {memberNames.length > 1 && (
                      <div className="hint" style={{ margin: "6px 0 2px" }}>
                        {m.name}{m.name === model ? " (root — bare names)" : " (joined — sent as Model.metric)"}
                      </div>
                    )}
                    <div className="chips">
                      {m.metrics.map((mt) => {
                        const ref = refFor(m.name, mt);
                        return (
                          <label key={ref} className={`chip${metrics.includes(ref) ? " on" : ""}`}>
                            <input type="checkbox" checked={metrics.includes(ref)} onChange={() => toggle(metrics, ref, setMetrics)} />{ref}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <h3>Search</h3>
                <div className="row">
                  <div>
                    <label className="lbl">Type</label>
                    <select value={searchType} onChange={(e) => setSearchType(e.target.value)}>
                      <option value="none">none</option>
                      <option value="fulltext">fulltext</option>
                      <option value="semantic">semantic</option>
                      <option value="hybrid">hybrid</option>
                    </select>
                  </div>
                  <div style={{ flex: 3 }}>
                    <label className="lbl">Text</label>
                    <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="e.g. Engineering" />
                  </div>
                </div>

                <h3>Filters</h3>
                {filters.map((f, i) => (
                  <div className="filter-row" key={i}>
                    <select value={f.field} onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>
                      {allFilterFields.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                    <select value={f.operator} onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, operator: e.target.value } : x)))}>
                      {OPERATORS.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                    <input
                      type="text" value={f.value} disabled={NO_VALUE_OPS.has(f.operator)}
                      onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                      placeholder={f.operator === "in" || f.operator === "notIn" ? "[1, 2]" : "value (JSON: 1, true, [1,2])"}
                    />
                    <button className="btn-danger-ghost" onClick={() => setFilters(filters.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
                <button
                  className="btn-ghost"
                  onClick={() => setFilters([...filters, { field: allFilterFields[0] ?? "", operator: "equals", value: "" }])}
                >
                  + Add filter
                </button>

                <h3>Order by</h3>
                {orderBy.map((o, i) => (
                  <div className="filter-row" key={i} style={{ gridTemplateColumns: "1fr 1fr auto" }}>
                    <select value={o.field} onChange={(e) => setOrderBy(orderBy.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>
                      {allOrderFields.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                    <select value={o.direction} onChange={(e) => setOrderBy(orderBy.map((x, j) => (j === i ? { ...x, direction: e.target.value as "asc" | "desc" } : x)))}>
                      <option value="asc">asc</option>
                      <option value="desc">desc</option>
                    </select>
                    <button className="btn-danger-ghost" onClick={() => setOrderBy(orderBy.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
                <button
                  className="btn-ghost"
                  onClick={() => setOrderBy([...orderBy, { field: allOrderFields[0] ?? "", direction: "asc" }])}
                >
                  + Add order
                </button>

                <div className="row" style={{ marginTop: 12 }}>
                  <div>
                    <label className="lbl">Limit</label>
                    <input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} />
                  </div>
                  <div>
                    <label className="lbl">Offset</label>
                    <input type="number" value={offset} onChange={(e) => setOffset(e.target.value)} />
                  </div>
                </div>

                <h3>Body preview</h3>
                <pre className="preview">{JSON.stringify(builtBody, null, 2)}</pre>
                <div className="btn-row">
                  <button className="btn-primary" disabled={sending} onClick={sendBuilder}>
                    {sending ? "Sending…" : "Send → POST /search"}
                  </button>
                </div>
              </>
            )}

            {tab === "json" && (
              <>
                <label className="lbl" htmlFor="raw">Request body (sent to POST /search as-is)</label>
                <textarea id="raw" value={rawJson} onChange={(e) => setRawJson(e.target.value)} spellCheck={false} />
                <div className="btn-row">
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      try {
                        setRawJson(JSON.stringify(JSON.parse(rawJson) as unknown, null, 2));
                      } catch {
                        /* keep as-is; send will report the error */
                      }
                    }}
                  >
                    Format
                  </button>
                  <button className="btn-primary" disabled={sending} onClick={sendRaw}>
                    {sending ? "Sending…" : "Send → POST /search"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div>
          <div className="card">
            <h2>Auth</h2>
            <label className="lbl" htmlFor="jwt">Bearer JWT (sent as Authorization header)</label>
            <textarea
              id="jwt" value={token} onChange={(e) => setToken(e.target.value)}
              spellCheck={false} style={{ minHeight: 90, fontSize: 12 }} placeholder="paste JWT here"
            />
            <div className="btn-row">
              <button className="btn-ghost" onClick={() => { setToken(""); try { localStorage.removeItem("axis.token"); } catch { /* ignore */ } }}>
                Clear token
              </button>
            </div>
            <h3>Decoded payload</h3>
            <pre className="preview" style={{ maxHeight: 180 }}>
              {token.trim() === "" ? "(no token — requests go unauthenticated)" : JSON.stringify(decoded ?? "(not a decodable JWT)", null, 2)}
            </pre>
            <h3>Headers sent</h3>
            <table className="kv">
              <tbody>
                <tr><td>Content-Type</td><td>application/json</td></tr>
                <tr><td>Authorization</td><td>{token.trim() === "" ? "(omitted)" : `Bearer ${token.trim().slice(0, 18)}…`}</td></tr>
                <tr><td>X-Axis-Target</td><td>{architecture}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Response</h2>
            {result == null && <span className="status idle">no request sent yet</span>}
            {result != null && (
              <>
                <span className={`status ${statusClass}`}>
                  {result.status == null ? "NETWORK ERROR" : `${result.status}`}
                </span>{" "}
                <span className="meta-line">{result.ms != null ? `${result.ms} ms` : ""}</span>
                <div className="meta-line">{result.sentUrl !== "" ? `POST ${result.sentUrl}` : ""}</div>
                {result.error && <div className="err-text">{result.error}</div>}
                <pre className="out">{JSON.stringify(result.body, null, 2)}</pre>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
