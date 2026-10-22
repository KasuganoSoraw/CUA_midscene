import type { ReviewEvidence, ReviewOperation } from '../../shared/types.js';

export type EvidenceMode = 'full' | 'crop' | 'reference' | 'placeholder';

export function resolveEvidenceMode(
  requested: EvidenceMode,
  operation: ReviewOperation,
  evidence?: ReviewEvidence,
): EvidenceMode {
  const supportsReference = operation === 'click' || operation === 'doubleClick' || operation === 'rightClick';
  if (requested === 'reference' && supportsReference) return 'reference';
  if (requested === 'crop' && evidence?.crop) return 'crop';
  if (requested === 'full' && evidence?.full) return 'full';
  if (evidence?.crop) return 'crop';
  if (evidence?.full) return 'full';
  return supportsReference ? 'reference' : 'placeholder';
}
