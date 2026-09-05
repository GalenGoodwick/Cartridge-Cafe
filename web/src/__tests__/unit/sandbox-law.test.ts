import { describe, expect, it } from 'vitest'
import { effectiveBuild, policyOf } from '@/lib/world-policy'

/** THE SANDBOX LAW (Galen, Sep 5: "all worlds open buildable for membership.
 *  its the only way. Except for premium games... and proprietary. Kids have
 *  to share the sandbox."). */
describe('the sandbox law — build access resolves open except premium/proprietary', () => {
  it('an ordinary world is open buildable regardless of its declared contract', () => {
    expect(effectiveBuild({}, false)).toBe('anyone')
    expect(effectiveBuild({ policy: { build: 'owner', play: 'everyone' } }, false)).toBe('anyone')
    expect(effectiveBuild({ policy: { build: 'invited', play: 'everyone' } }, false)).toBe('anyone')
  })

  it('a PREMIUM game keeps its declared contract (closed by default)', () => {
    expect(effectiveBuild({ premium: { usd: 5 } }, false)).toBe(policyOf({}).build)
    expect(effectiveBuild({ premium: { usd: 5 }, policy: { build: 'anyone', play: 'everyone' } }, false)).toBe('anyone')
  })

  it("a PROPRIETARY (IP-control) owner's world keeps its declared contract", () => {
    expect(effectiveBuild({}, true)).toBe(policyOf({}).build)
    expect(effectiveBuild({ policy: { build: 'anyone', play: 'everyone' } }, true)).toBe('anyone')
  })

  it('a zero/invalid premium price does not close a world', () => {
    expect(effectiveBuild({ premium: { usd: 0 } }, false)).toBe('anyone')
    expect(effectiveBuild({ premium: {} }, false)).toBe('anyone')
  })
})
