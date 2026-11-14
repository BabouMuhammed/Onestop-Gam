import { randomInt } from 'node:crypto'
import argon2 from 'argon2'

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id })
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}

/** Verified when the username is unknown, so the response time does not reveal which usernames exist. */
export const DUMMY_HASH = await hashPassword('not-a-real-account-password')

// No look-alike characters (0/O, 1/l/I): a manager reads this aloud or writes it down.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

/** A one-time password for a new account or a reset. The user must replace it at first sign-in. */
export function temporaryPassword(length = 14): string {
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}
