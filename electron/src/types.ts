export interface WorkerConfig {
  serverWsUrl: string;
  workerId: string;
  workerName: string;
  workerSecret: string;
}

export interface InstallDefaults {
  serverWsUrl?: string;
  workerSecret?: string;
  workerId: string;
  workerName: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface WorkerStatus {
  installed: boolean;
  running: boolean;
}
