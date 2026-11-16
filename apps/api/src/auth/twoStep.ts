import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto'
import { authenticator } from 'otplib'
import QRCode from 'qrcode'
import { COMPANY_NAME } from '@onestop/shared'
import { env, isProduction } from '../env'
import { hashPassword, verifyPassword } from './password'

// Accept the code from the 30-second step before and after the current one (clock drift).
authenticator.options = { window: 1, step: 30 }

/**
 * The AES-256 key, derived from TOTP_ENCRYPTION_KEY. Outside production a fixed key is used
 * so development and tests work without setup; production refuses to start without one.
 */
function key(): Buffer {
  const secret = env.TOTP_ENCRYPTION_KEY || (isProduction ? '' : 'development-only-two-step-key-not-for-real-use')
  if (!secret) throw new Error('TOTP_ENCRYPTION_KEY is not set')
  return createHash('sha256').update(secret).digest()
}

/** Encrypt with AES-256-GCM: "v1.<iv>.<tag>.<ciphertext>", each part base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split('.')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unreadable two-step secret')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}

export function newSecret() {
  return authenticator.generateSecret()
}

/** What the authenticator app scans: an otpauth:// link as a QR code image. */
export async function setupDetails(username: string, secret: string) {
  const otpauthUrl = authenticator.keyuri(username, `${COMPANY_NAME} OneStop`, secret)
  return { otpauthUrl, qr: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 }), secret }
}

/**
 * Check a 6-digit code. Returns the 30-second step it belongs to, or null. A step at or
 * before `lastStep` is refused, so a code that was seen (over a shoulder, in a log) cannot
 * be used again.
 */
export function checkCode(secret: string, code: string, lastStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const delta = authenticator.checkDelta(code, secret)
  if (delta === null) return null
  const step = Math.floor(Date.now() / 30_000) + delta
  if (lastStep !== null && step <= lastStep) return null
  return step
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789' // no 0/o, 1/l/i

/** Eight one-time recovery codes like "k7m2-q9xa", and their hashes for storing. */
export async function newRecoveryCodes(): Promise<{ codes: string[]; hashes: string[] }> {
  const codes = Array.from({ length: 8 }, () => {
    const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
    return `${chars.slice(0, 4)}-${chars.slice(4)}`
  })
  return { codes, hashes: await Promise.all(codes.map((c) => hashPassword(c))) }
}

/** Which stored code (by id) matches, if any. Codes are compared with or without the dash. */
export async function matchRecoveryCode(code: string, stored: { id: string; codeHash: string }[]): Promise<string | null> {
  const normal = code.replace('-', '')
  const dashed = `${normal.slice(0, 4)}-${normal.slice(4)}`
  for (const candidate of stored) {
    if (await verifyPassword(candidate.codeHash, dashed)) return candidate.id
  }
  return null
}
