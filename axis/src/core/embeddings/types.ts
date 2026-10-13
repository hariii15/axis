export interface EmbeddingsConfig {
  enabled?: boolean;
  provider?: "openai" | "huggingface" | "local" | "ollama" | string;
  model?: string;
  dimensions?: number;
  /**
   * Pre-built provider instance (Phase 7). Built and injected by the
   * middleware/application — the library never reads env or constructs
   * HTTP clients from raw URLs itself.
   */
  instance?: EmbeddingProvider;
}

export interface EmbeddingProvider {
  name: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}

export interface EmbeddingRequest {
  input: string | string[];
  model?: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

export interface OpenAIEmbeddingConfig extends EmbeddingsConfig {
  provider: "openai";
  apiKey: string;
  model?: string;
  baseURL?: string;
  organization?: string;
  dimensions?: number;
}

export interface HuggingFaceEmbeddingConfig extends EmbeddingsConfig {
  provider: "huggingface";
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export interface LocalEmbeddingConfig extends EmbeddingsConfig {
  provider: "local";
  modelPath: string;
  model?: string;
}

export interface OllamaEmbeddingConfig extends EmbeddingsConfig {
  provider: "ollama";
  baseURL: string;
  model?: string;
}