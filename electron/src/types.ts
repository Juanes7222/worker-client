export interface WorkerConfig {
  serverWsUrl: string;
  workerId: string;
  workerName: string;
  workerSecret: string;
  azuracastBaseUrl: string;
  azuracastApiKey: string;
  azuracastStationId: string;
  azuracastPlaylistId?: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface WorkerStatus {
  installed: boolean;
  running: boolean;
}