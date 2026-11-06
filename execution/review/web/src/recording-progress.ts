export interface RecordingProgress { completed: number; total: number }

export function recordingProgress(log: string): RecordingProgress | undefined {
  let progress: RecordingProgress | undefined;
  for (const match of log.matchAll(/^CUA_TRACE_PROGRESS (\{[^\r\n]*\})\r?$/gm)) {
    try {
      const value = JSON.parse(match[1]) as RecordingProgress;
      if (Number.isSafeInteger(value.total) && value.total > 0 && Number.isSafeInteger(value.completed)
        && value.completed >= 0 && value.completed <= value.total) progress = value;
    } catch { /* 未完成的输出行等待下一次轮询。 */ }
  }
  return progress;
}
