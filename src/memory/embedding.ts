export interface EmbeddingService {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  getDimensions(): number;
  isReady(): boolean;
}

export class RemoteEmbeddingService implements EmbeddingService {
  private ready = false;
  private dimensions: number;

  constructor(
    private apiUrl: string,
    private apiKey: string,
    private model: string,
    dimensions?: number
  ) {
    this.dimensions = dimensions ?? 1536;
    this.ready = true;
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.ready) throw new Error('Embedding service not ready');

    const response = await fetch(`${this.apiUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        ...(this.dimensions ? { dimensions: this.dimensions } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data.map((d) => {
      const arr = new Float32Array(d.embedding);
      return this.normalize(arr);
    });
  }

  getDimensions(): number {
    return this.dimensions;
  }

  isReady(): boolean {
    return this.ready;
  }

  private normalize(vec: Float32Array): Float32Array {
    let norm = 0;
    for (let i = 0; i < vec.length; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);
    if (norm === 0) return vec;
    const result = new Float32Array(vec.length);
    for (let i = 0; i < vec.length; i++) {
      result[i] = vec[i] / norm;
    }
    return result;
  }
}

export class NoopEmbeddingService implements EmbeddingService {
  private dimensions: number;
  private ready = false;

  constructor(dimensions = 0) {
    this.dimensions = dimensions;
  }

  async embed(_text: string): Promise<Float32Array> {
    return new Float32Array(this.dimensions);
  }

  async embedBatch(_texts: string[]): Promise<Float32Array[]> {
    return [new Float32Array(this.dimensions)];
  }

  getDimensions(): number {
    return this.dimensions;
  }

  isReady(): boolean {
    return this.ready;
  }

  setReady(ready: boolean): void {
    this.ready = ready;
  }
}

export function createEmbeddingService(config: {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  dimensions?: number;
}): EmbeddingService {
  if (config.apiUrl && config.apiKey && config.model) {
    return new RemoteEmbeddingService(
      config.apiUrl,
      config.apiKey,
      config.model,
      config.dimensions
    );
  }
  const noop = new NoopEmbeddingService();
  noop.setReady(true);
  return noop;
}
