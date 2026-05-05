export interface MicroModelParams {
  cutoff: number;
  slidingWindow: number;
  stepSize: number;
  inputScale?: number;
  inputZeroPoint?: number;
}

export function loadTFLite(): Promise<unknown>;
export function createIsolatedModelRunner(
  _runtimeHandle: unknown,
  modelName: string,
): Promise<unknown>;
export function getMicroModelParams(modelName: string): MicroModelParams;
export function releaseMicroModels(): Promise<void>;
