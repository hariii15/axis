import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OllamaEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
} from "../../src/core/embeddings/providers.js";
import { Axis } from "../../src/core/axis.js";

const UNREACHABLE_DB = "postgres://127.0.0.1:1/postgres";

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => payload,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Phase 7: OpenAICompatibleEmbeddingProvider", () => {
  it("embeds a batch via POST /embeddings", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          { embedding: [0.1, 0.2], index: 0 },
          { embedding: [0.3, 0.4], index: 1 },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatibleEmbeddingProvider({
      baseURL: "http://embeddings:8000",
      model: "test-model",
    });
    const vectors = await provider.embedBatch(["a", "b"]);
    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://embeddings:8000/embeddings");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "test-model",
    });
    expect(provider.getDimensions()).toBe(2);
  });

  it("embed() returns the single vector", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ data: [{ embedding: [1, 2, 3], index: 0 }] }),
      ),
    );
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseURL: "http://embeddings:8000",
      model: "m",
    });
    await expect(provider.embed("hello")).resolves.toEqual([1, 2, 3]);
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, false, 500)),
    );
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseURL: "http://embeddings:8000",
      model: "m",
    });
    await expect(provider.embed("hi")).rejects.toThrow(/500/);
  });

  it("healthCheck returns false when unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseURL: "http://embeddings:8000",
      model: "m",
    });
    await expect(provider.healthCheck()).resolves.toBe(false);
  });
});

describe("Phase 7: OllamaEmbeddingProvider", () => {
  it("embeds a batch via POST /api/embed", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ embeddings: [[0.5, 0.6]] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaEmbeddingProvider({
      baseURL: "http://ollama:11434",
      model: "nomic-embed-text",
    });
    const vectors = await provider.embedBatch(["hello"]);
    expect(vectors).toEqual([[0.5, 0.6]]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://ollama:11434/api/embed");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "nomic-embed-text",
    });
    expect(provider.getDimensions()).toBe(2);
  });
});

describe("Phase 7: Axis embeddings wiring", () => {
  it("axis.embeddings is undefined without config", async () => {
    const axis = new Axis({ database: { url: UNREACHABLE_DB } });
    try {
      expect(axis.embeddings).toBeUndefined();
    } finally {
      await axis.close();
    }
  });

  it("axis exposes the injected provider instance", async () => {
    const provider = new OllamaEmbeddingProvider({
      baseURL: "http://ollama:11434",
      model: "nomic-embed-text",
      dimensions: 768,
    });
    const axis = new Axis({
      database: { url: UNREACHABLE_DB },
      embeddings: { instance: provider },
    });
    try {
      expect(axis.embeddings).toBe(provider);
      expect(axis.embeddings?.getDimensions()).toBe(768);
    } finally {
      await axis.close();
    }
  });
});
