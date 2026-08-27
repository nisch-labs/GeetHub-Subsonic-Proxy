/** Subsonic salted-MD5 token auth (matches SubsonicCredentials.swift).
 *
 * Every request appends `u=<user>&t=md5(password+salt)&s=<salt>&c=<client>&v=<v>&f=json`.
 * The salt is a fresh random string per-request so the token can't be replayed. */

export interface Credentials {
  baseURL: string       // e.g. "https://music.example.com"
  username: string
  password: string
  clientName: string    // e.g. "GeetHub Web"
}

const API_VERSION = '1.16.1'

function randomSalt(): string {
  // 12 hex chars — matches the app's salt length.
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** MD5(utf8-bytes(password + salt)) as lowercase hex.
 * Web Crypto doesn't ship MD5, so we implement it inline (RFC 1321).
 * Subsonic auth is not a security-sensitive hash — it's a shared-secret token
 * over HTTPS. MD5 is required by the protocol. */
export function md5(input: string): string {
  return md5Hex(new TextEncoder().encode(input))
}

export function token(password: string, salt: string): string {
  return md5(password + salt)
}

/** Build the shared query params for any Subsonic request. */
export function authQueryItems(creds: Credentials, extra: Record<string, string | number | undefined> = {}): URLSearchParams {
  const s = randomSalt()
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === null) continue
    params.set(k, String(v))
  }
  params.set('u', creds.username)
  params.set('t', token(creds.password, s))
  params.set('s', s)
  params.set('c', creds.clientName)
  params.set('v', API_VERSION)
  params.set('f', 'json')
  return params
}

// ============================================================
// MD5 — minimal inline implementation (RFC 1321).
// ~1KB, no dependency, fast enough for auth-token generation.
// ============================================================
function md5Hex(bytes: Uint8Array): string {
  // Padding
  const len = bytes.length
  const bitLen = len * 8
  const paddedLen = Math.ceil((len + 9) / 64) * 64
  const padded = new Uint8Array(paddedLen)
  padded.set(bytes)
  padded[len] = 0x80
  // Append 64-bit little-endian length
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLen - 8, bitLen >>> 0, true)
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true)

  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476

  const k = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ]
  const r = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]

  for (let chunk = 0; chunk < paddedLen; chunk += 64) {
    const M = new Uint32Array(16)
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(chunk + i * 4, true)

    let A = a, B = b, C = c, D = d
    for (let i = 0; i < 64; i++) {
      let F: number, g: number
      if (i < 16)      { F = (B & C) | (~B & D);  g = i }
      else if (i < 32) { F = (D & B) | (~D & C);  g = (5 * i + 1) % 16 }
      else if (i < 48) { F = B ^ C ^ D;            g = (3 * i + 5) % 16 }
      else             { F = C ^ (B | ~D);         g = (7 * i) % 16 }
      const temp = D
      D = C
      C = B
      const sum = (A + F + k[i] + M[g]) >>> 0
      B = (B + leftRotate(sum, r[i])) >>> 0
      A = temp
    }
    a = (a + A) >>> 0
    b = (b + B) >>> 0
    c = (c + C) >>> 0
    d = (d + D) >>> 0
  }

  return [a, b, c, d].map(u32ToHexLE).join('')
}

function leftRotate(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0
}
function u32ToHexLE(x: number): string {
  const b0 = x & 0xff, b1 = (x >>> 8) & 0xff, b2 = (x >>> 16) & 0xff, b3 = (x >>> 24) & 0xff
  return [b0, b1, b2, b3].map((b) => b.toString(16).padStart(2, '0')).join('')
}
