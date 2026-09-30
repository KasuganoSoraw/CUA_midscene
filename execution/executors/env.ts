import { applyEnvironmentFiles } from '../cua/environment.js';

applyEnvironmentFiles();

export function warnIfNodeVersionIsOld(): void {
  const [major = 0, minor = 0, patch = 0] = process.versions.node.split('.').map(Number);
  const isTooOld = major < 20
    || (major === 20 && (minor < 18 || (minor === 18 && patch < 1)));
  if (isTooOld) {
    console.warn(
      `Warning: cua-midscene requires Node >=20.18.1; current Node is ${process.versions.node}. Upgrade Node before running computer use.`,
    );
  }
}

export const requiredModelEnv = [
  'MIDSCENE_MODEL_BASE_URL',
  'MIDSCENE_MODEL_NAME',
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_FAMILY',
] as const;

export function checkRequiredModelEnv(): void {
  const missing = requiredModelEnv.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}
