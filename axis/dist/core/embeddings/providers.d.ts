import type { EmbeddingProvider } from "./types.js";
export interface HttpEmbeddingProviderOptions {
    baseURL: string;
    model: string;
    apiKey?: string;
    dimensions?: number;
    timeoutMs?: number;
}
/**
 * Provider for any OpenAI-compatible embeddings endpoint
 * (OpenAI, vLLM, Ollama `/v1/embeddings`, TEI OpenAI-compat routers).
 *
 * `POST {baseURL}/embeddings` with `{ input, model }`.
 */
export declare class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
    readonly name = "openai-compatible";
    private readonly baseURL;
    private readonly model;
    private readonly apiKey;
    private readonly timeoutMs;
    private knownDimensions;
    constructor(options: HttpEmbeddingProviderOptions);
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    getDimensions(): number;
    healthCheck(): Promise<boolean>;
    close(): Promise<void>;
}
/**
 * Provider for Ollama's native embedding endpoint
 * (`POST {baseURL}/api/embed` with `{ model, input }`).
 */
export declare class OllamaEmbeddingProvider implements EmbeddingProvider {
    readonly name = "ollama";
    private readonly baseURL;
    private readonly model;
    private readonly timeoutMs;
    private knownDimensions;
    constructor(options: HttpEmbeddingProviderOptions);
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    getDimensions(): number;
    healthCheck(): Promise<boolean>;
    close(): Promise<void>;
}
//# sourceMappingURL=providers.d.ts.map