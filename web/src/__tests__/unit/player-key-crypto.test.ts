import { describe, it, expect } from 'vitest'
import { encryptRawKey, decryptRawKey } from '@/lib/player-token'

const SECRET = 'test-nextauth-secret'
const RAW = 'uc_pt_93322dfeedfacecafe0123456789abcdef012345'

describe('player-key encryption at rest — the always-copyable path', () => {
  it('roundtrips: encrypt then decrypt returns the raw key', () => {
    const enc = encryptRawKey(RAW, SECRET)
    expect(enc).toBeTruthy()
    expect(decryptRawKey(enc!, SECRET)).toBe(RAW)
  })

  it('every encryption is unique (random IV) yet all decrypt', () => {
    const a = encryptRawKey(RAW, SECRET)!, b = encryptRawKey(RAW, SECRET)!
    expect(a).not.toBe(b)
    expect(decryptRawKey(a, SECRET)).toBe(RAW)
    expect(decryptRawKey(b, SECRET)).toBe(RAW)
  })

  it('wrong secret decrypts to null, never garbage (GCM auth)', () => {
    const enc = encryptRawKey(RAW, SECRET)!
    expect(decryptRawKey(enc, 'some-other-secret')).toBeNull()
  })

  it('no secret configured → store nothing, decrypt nothing', () => {
    expect(encryptRawKey(RAW, '')).toBeNull()
    expect(decryptRawKey('whatever', '')).toBeNull()
  })

  it('corrupt/truncated blob → null, no throw', () => {
    const enc = encryptRawKey(RAW, SECRET)!
    expect(decryptRawKey(enc.slice(0, 12), SECRET)).toBeNull()
    expect(decryptRawKey('not-base64!!!', SECRET)).toBeNull()
    // flipped ciphertext bit fails the auth tag
    const buf = Buffer.from(enc, 'base64')
    buf[buf.length - 1] ^= 0xff
    expect(decryptRawKey(buf.toString('base64'), SECRET)).toBeNull()
  })
})
