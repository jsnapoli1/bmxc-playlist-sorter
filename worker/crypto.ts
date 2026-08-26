/**
 * Secret handling for the Worker.
 *
 * Two separate concerns:
 *  - Spotify refresh tokens are *encrypted* (AES-GCM) because we must be
 *    able to read them back to call Spotify.
 *  - Session tokens are *hashed* (SHA-256) because we only ever need to
 *    check whether a presented token matches, never to recover it.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function base64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function unbase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** Derive an AES-GCM key from the ENCRYPTION_KEY secret. */
async function keyFrom(secret: string): Promise<CryptoKey> {
  // The secret is arbitrary text; hash it to get exactly 256 bits.
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/** Encrypt to base64(iv || ciphertext). */
export async function encryptSecret(plaintext: string, secret: string): Promise<string> {
  const key = await keyFrom(secret)
  // A fresh 96-bit IV per encryption; reusing one with AES-GCM is fatal.
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext)),
  )
  const joined = new Uint8Array(iv.length + ciphertext.length)
  joined.set(iv, 0)
  joined.set(ciphertext, iv.length)
  return base64(joined)
}

export async function decryptSecret(encoded: string, secret: string): Promise<string> {
  const key = await keyFrom(secret)
  const joined = unbase64(encoded)
  const iv = joined.slice(0, 12)
  const ciphertext = joined.slice(12)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return decoder.decode(plaintext)
}

/** SHA-256, hex. Used for session tokens stored in D1. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/**
 * A URL-safe random token. The alphabet omits look-alike characters so a
 * share link can be read aloud or copied off a screen without ambiguity.
 */
export function randomToken(length = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

/**
 * Constant-time string comparison, so comparing a presented token against a
 * stored one cannot be timed to recover it character by character.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Password hashing for collaborators.
 *
 * PBKDF2 rather than a bare SHA-256: these are camp passwords people will
 * choose badly and reuse, and a plain digest is fast enough to brute-force
 * a whole leaked table. 100k iterations costs a few milliseconds per sign-in
 * — irrelevant next to the D1 round trip — and makes that attack expensive.
 *
 * Not bcrypt/scrypt/argon2 only because WebCrypto in Workers offers PBKDF2
 * natively and pulling in a KDF library is not worth it here.
 */
const PBKDF2_ITERATIONS = 100_000

/** A fresh random salt, hex. One per password, never reused. */
export function newSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Derive the stored hash for a password with its salt. Hex. */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    256,
  )
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Whether a presented password matches the stored hash. */
export async function verifyPassword(
  password: string,
  salt: string,
  expected: string,
): Promise<boolean> {
  return timingSafeEqual(await hashPassword(password, salt), expected)
}
