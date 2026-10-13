import { runModel } from "./run";
import { runSensitivity } from "./sensitivity";
import type { SensitivityReport } from "./sensitivity";
import type { Assumptions, ModelOutput } from "./types";

export type WorkerRequest =
  | { kind: "model"; id: number; assumptions: Assumptions; slot?: string }
  | { kind: "sensitivity"; id: number; assumptions: Assumptions };

export type WorkerResponse =
  | { kind: "model"; id: number; output: ModelOutput; slot?: string }
  | { kind: "progress"; id: number; done: number; total: number; p5?: number; p50?: number; p95?: number; slot?: string }
  | { kind: "sensitivity"; id: number; report: SensitivityReport }
  | { kind: "error"; id: number; message: string; slot?: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    if (message.kind === "sensitivity") {
      const report = runSensitivity(message.assumptions);
      const response: WorkerResponse = { kind: "sensitivity", id: message.id, report };
      self.postMessage(response);
      return;
    }
    const output = runModel(message.assumptions, {
      onProgress: (done, total, snapshot) => {
        const progress: WorkerResponse = {
          kind: "progress",
          id: message.id,
          done,
          total,
          p5: snapshot?.p5,
          p50: snapshot?.p50,
          p95: snapshot?.p95,
          slot: message.slot,
        };
        self.postMessage(progress);
      },
    });
    const response: WorkerResponse = { kind: "model", id: message.id, output, slot: message.slot };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      kind: "error",
      id: message.id,
      slot: message.kind === "model" ? message.slot : undefined,
      message: error instanceof Error ? error.message : "The model run failed.",
    };
    self.postMessage(response);
  }
};
