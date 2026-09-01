export type ServerMessageType =
  | "assign_job"
  | "ping"
  | "acknowledge"
  | "update_available";

export interface UpdateAvailableMessage {
  type: "update_available";
  version: string;
  sha256: string;
  url: string;
  mandatory: boolean;
}

export type WorkerMessageType =
  | "register"
  | "heartbeat"
  | "job_ack"
  | "job_status"
  | "job_done"
  | "job_error"
  | "pong";

export interface RegisterMessage {
  type: "register";
  workerId: string;
  secret: string;
  name: string;
  maxConcurrentJobs: number;
  version?: string;
}

export interface HeartbeatMessage {
  type: "heartbeat";
  workerId: string;
  status: "idle" | "busy";
  currentJobId?: string;
}

export interface JobAckMessage {
  type: "job_ack";
  workerId: string;
  jobId: string;
}

export interface JobStatusMessage {
  type: "job_status";
  workerId: string;
  jobId: string;
  status: string;
}

export interface JobDoneMessage {
  type: "job_done";
  workerId: string;
  jobId: string;
  azuracastFileId: string;
  azuracastPath: string;
  duration: number;
  ignored?: boolean;
}

export interface JobErrorMessage {
  type: "job_error";
  workerId: string;
  jobId: string;
  error: string;
  retryable: boolean;
}

export type WorkerMessage =
  | RegisterMessage
  | HeartbeatMessage
  | JobAckMessage
  | JobStatusMessage
  | JobDoneMessage
  | JobErrorMessage
  | { type: "pong"; workerId: string };

export interface AssignJobMessage {
  type: "assign_job";
  jobId: string;
  videoId: string;
  url: string;
  title: string;
  channelId: string;
  maxDurationSeconds: number;
  uploadProxyUrl: string;
  azuracast: {
    baseUrl: string;
    apiKey: string;
    stationId: string;
    playlistId: string;
  };
}
