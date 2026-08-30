import { describe, it, expect } from 'vitest'
import { canFork, forkFactsOf, worldIsForkable, type ForkFacts } from '@/lib/fork-policy'

const facts = (o: Partial<ForkFacts> = {}): ForkFacts => ({
  premium: false, proprietary: false, liveEdit: false, explicitOff: false, base: false, ...o,
})

describe('canFork — the default-on decision', () => {
  it('DEFAULTS ON: an ordinary world forks', () => {
    expect(canFork(facts())).toBe(true)
  })
  it('premium worlds do NOT fork', () => {
    expect(canFork(facts({ premium: true }))).toBe(false)
  })
  it('proprietary worlds do NOT fork', () => {
    expect(canFork(facts({ proprietary: true }))).toBe(false)
  })
  it('live-edit (open building) worlds do NOT fork', () => {
    expect(canFork(facts({ liveEdit: true }))).toBe(false)
  })
  it('the maker may opt OUT explicitly', () => {
    expect(canFork(facts({ explicitOff: true }))).toBe(false)
  })
  it('a base forks past live-edit and explicit opt-out', () => {
    expect(canFork(facts({ base: true, liveEdit: true, explicitOff: true }))).toBe(true)
  })
  it('premium/proprietary block forking EVEN a base (Galen: no forking premium games)', () => {
    expect(canFork(facts({ base: true, premium: true }))).toBe(false)
    expect(canFork(facts({ base: true, proprietary: true }))).toBe(false)
  })
})

describe('forkFactsOf — reading worldData (once)', () => {
  it('bare worldData → forkable by default', () => {
    expect(worldIsForkable({}, false)).toBe(true)
    expect(worldIsForkable(null, false)).toBe(true)
  })
  it('premium.usd > 0 marks premium; usd 0/absent does not', () => {
    expect(forkFactsOf({ premium: { usd: 5 } }, false).premium).toBe(true)
    expect(forkFactsOf({ premium: { usd: 0 } }, false).premium).toBe(false)
    expect(forkFactsOf({ premium: {} }, false).premium).toBe(false)
    expect(worldIsForkable({ premium: { usd: 5 } }, false)).toBe(false)
  })
  it('IP-control standing OR a closed/proprietary flag marks proprietary', () => {
    expect(forkFactsOf({}, true).proprietary).toBe(true)
    expect(forkFactsOf({ proprietary: true }, false).proprietary).toBe(true)
    expect(forkFactsOf({ closed: true }, false).proprietary).toBe(true)
    expect(worldIsForkable({}, true)).toBe(false)
  })
  it('policy.build === anyone is live-edit; owner/invited are not', () => {
    expect(forkFactsOf({ policy: { build: 'anyone' } }, false).liveEdit).toBe(true)
    expect(forkFactsOf({ policy: { build: 'owner' } }, false).liveEdit).toBe(false)
    expect(forkFactsOf({ policy: { build: 'invited' } }, false).liveEdit).toBe(false)
    expect(forkFactsOf({}, false).liveEdit).toBe(false)   // undeclared = default owner-build
    expect(worldIsForkable({ policy: { build: 'anyone' } }, false)).toBe(false)
  })
  it('forkable === false is the ONLY explicit opt-out (true/absent are not)', () => {
    expect(forkFactsOf({ forkable: false }, false).explicitOff).toBe(true)
    expect(forkFactsOf({ forkable: true }, false).explicitOff).toBe(false)
    expect(forkFactsOf({}, false).explicitOff).toBe(false)
    expect(worldIsForkable({ forkable: false }, false)).toBe(false)
  })
  it('__base === true marks a base — but a PREMIUM base still does not fork', () => {
    expect(forkFactsOf({ __base: true }, false).base).toBe(true)
    expect(worldIsForkable({ __base: true }, false)).toBe(true)
    expect(worldIsForkable({ __base: true, premium: { usd: 9 } }, false)).toBe(false)
  })
})
