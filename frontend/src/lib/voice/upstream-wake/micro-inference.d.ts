export class MicroWakeWordInference {
  static create(
    keywordConfigs: unknown[],
    log: { log: (category: string, message: string) => void },
    sensitivityLabel: string,
    energyGateEnabled?: boolean,
  ): Promise<{
    processChunk(samples: Float32Array): Promise<unknown>;
    destroy(): void;
  }>;
}
