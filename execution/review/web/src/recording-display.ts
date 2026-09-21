import type { RecorderStatus } from '../../shared/types.js';

export function shouldDetectDisplays(phase: RecorderStatus['phase']): boolean {
  return phase === 'idle' || phase === 'failed';
}
