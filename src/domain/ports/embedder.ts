export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>;
  readonly dimension: number;
}
