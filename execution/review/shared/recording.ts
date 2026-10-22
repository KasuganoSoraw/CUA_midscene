export interface RecordingAssets {
  recordingRoot: string;
  processedLogPath: string;
  screenshotsDir: string;
  stepCount: number;
  timingsMs: { log: number; screenshots: number; total: number };
}

export interface RecordingProgress {
  type: 'recording.progress';
  message: string;
  data: {
    source: 'recorder';
    phase: 'armed' | 'recording' | 'received' | 'processing' | 'extracting'
      | 'completed' | 'cancelled' | 'failed';
  };
}

export type RecordingResult =
  | { status: 'completed'; message: string; recordingId: string; assets: RecordingAssets;
      timingsMs: { receivedToPrepare: number } }
  | { status: 'cancelled'; message: string; assets: null; reason: string }
  | { status: 'failed'; message: string; assets: null; error: string };

export type RecorderCompletion =
  | { status: 'completed'; recordingId: string; recordingPath: string; completedAt?: number }
  | { status: 'cancelled'; reason: string }
  | { status: 'failed'; error: string };
