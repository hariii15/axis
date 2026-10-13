const DEFAULT_TIMEOUT_MS = 30_000;
function normalizeBaseURL(baseURL) {
    return baseURL.replace(/\/+$/, "");
}
async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
function authHeaders(apiKey) {
    if (apiKey === undefined || apiKey.length === 0) {
        return {};
    }
    return { Authorization: `Bearer ${apiKey}` };
}
/**
 * Provider for any OpenAI-compatible embeddings endpoint
 * (OpenAI, vLLM, Ollama `/v1/embeddings`, TEI OpenAI-compat routers).
 *
 * `POST {baseURL}/embeddings` with `{ input, model }`.
 */
export class OpenAICompatibleEmbeddingProvider {
    name = "openai-compatible";
    baseURL;
    model;
    apiKey;
    timeoutMs;
    knownDimensions;
    constructor(options) {
        if (!options.baseURL) {
            throw new Error("OpenAICompatibleEmbeddingProvider requires baseURL.");
        }
        if (!options.model) {
            throw new Error("OpenAICompatibleEmbeddingProvider requires model.");
        }
        this.baseURL = normalizeBaseURL(options.baseURL);
        this.model = options.model;
        this.apiKey = options.apiKey;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.knownDimensions = options.dimensions;
    }
    async embed(text) {
        const [vector] = await this.embedBatch([text]);
        if (vector === undefined) {
            throw new Error("Embedding service returned no vector.");
        }
        return vector;
    }
    async embedBatch(texts) {
        const response = await fetchWithTimeout(`${this.baseURL}/embeddings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...authHeaders(this.apiKey),
            },
            body: JSON.stringify({ input: texts, model: this.model }),
        }, this.timeoutMs);
        if (!response.ok) {
            throw new Error(`Embedding request failed: ${response.status} ${response.statusText}`);
        }
        const payload = (await response.json());
        if (!Array.isArray(payload.data) || payload.data.length === 0) {
            throw new Error("Embedding service returned an empty result.");
        }
        const ordered = [...payload.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        const vectors = ordered.map((entry) => {
            if (!Array.isArray(entry.embedding)) {
                throw new Error("Embedding service returned a malformed vector.");
            }
            return entry.embedding;
        });
        this.knownDimensions = vectors[0]?.length ?? this.knownDimensions;
        return vectors;
    }
    getDimensions() {
        if (this.knownDimensions === undefined) {
            throw new Error("Embedding dimensions unknown: configure dimensions or call embed() first.");
        }
        return this.knownDimensions;
    }
    async healthCheck() {
        try {
            const response = await fetchWithTimeout(`${this.baseURL}/models`, { method: "GET", headers: { ...authHeaders(this.apiKey) } }, this.timeoutMs);
            return response.ok;
        }
        catch {
            return false;
        }
    }
    async close() {
        // Stateless HTTP client — nothing to release.
    }
}
/**
 * Provider for Ollama's native embedding endpoint
 * (`POST {baseURL}/api/embed` with `{ model, input }`).
 */
export class OllamaEmbeddingProvider {
    name = "ollama";
    baseURL;
    model;
    timeoutMs;
    knownDimensions;
    constructor(options) {
        if (!options.baseURL) {
            throw new Error("OllamaEmbeddingProvider requires baseURL.");
        }
        if (!options.model) {
            throw new Error("OllamaEmbeddingProvider requires model.");
        }
        this.baseURL = normalizeBaseURL(options.baseURL);
        this.model = options.model;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.knownDimensions = options.dimensions;
    }
    async embed(text) {
        const [vector] = await this.embedBatch([text]);
        if (vector === undefined) {
            throw new Error("Embedding service returned no vector.");
        }
        return vector;
    }
    async embedBatch(texts) {
        const response = await fetchWithTimeout(`${this.baseURL}/api/embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: this.model, input: texts }),
        }, this.timeoutMs);
        if (!response.ok) {
            throw new Error(`Embedding request failed: ${response.status} ${response.statusText}`);
        }
        const payload = (await response.json());
        if (!Array.isArray(payload.embeddings) || payload.embeddings.length === 0) {
            throw new Error("Embedding service returned an empty result.");
        }
        this.knownDimensions =
            payload.embeddings[0]?.length ?? this.knownDimensions;
        return payload.embeddings;
    }
    getDimensions() {
        if (this.knownDimensions === undefined) {
            throw new Error("Embedding dimensions unknown: configure dimensions or call embed() first.");
        }
        return this.knownDimensions;
    }
    async healthCheck() {
        try {
            const response = await fetchWithTimeout(`${this.baseURL}/api/tags`, { method: "GET" }, this.timeoutMs);
            return response.ok;
        }
        catch {
            return false;
        }
    }
    async close() {
        // Stateless HTTP client — nothing to release.
    }
}
//# sourceMappingURL=providers.js.map