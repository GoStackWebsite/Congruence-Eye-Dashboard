import { Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/** Development fallback for RECORDER_SECRET. A warning is logged at boot while it is in use. */
export const DEV_RECORDER_SECRET = 'congruence-eye-dev-recorder-secret-change-me';
const PREFIX = 'v1:';

export const recorderSecretIsDefault = () => !process.env.RECORDER_SECRET;
const key = () => createHash('sha256').update(process.env.RECORDER_SECRET || DEV_RECORDER_SECRET, 'utf8').digest();

/**
 * AES-256-GCM. Stored as `v1:` + base64(iv[12] | tag[16] | ciphertext). The key is sha256(RECORDER_SECRET),
 * so any secret length works.
 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

/** Throws when the value was encrypted with a different RECORDER_SECRET or was tampered with. */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) throw new Error('Unknown secret format');
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

const log = new Logger('RecorderSecret');
const warned = new Set<string>();

/** Decrypts or returns null (logged once per value) so a wrong RECORDER_SECRET never breaks the edge config. */
export function tryDecryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch (e) {
    const k = stored.slice(0, 24);
    if (!warned.has(k)) {
      warned.add(k);
      log.error(`Cannot decrypt a recorder password (was RECORDER_SECRET changed?): ${(e as Error).message}`);
    }
    return null;
  }
}
