/** Pure activation-funnel math — no DB, no IO, so it unit-tests cleanly.
 *  The analytics route counts distinct visitors (vid) at each Visit `kind`
 *  stage and hands the raw counts here; this turns them into the rates Galen
 *  asked for: % of visitors who play, who edit, who publish, plus the per-world
 *  virality (new visitors generated per share). */

export interface FunnelCounts {
  visitors: number   // distinct vid with a 'page' view in the window
  players: number    // distinct vid with a 'play' event
  editors: number    // distinct vid with an 'edit' event
  publishers: number // distinct vid with a 'publish' event
  mcpLogins: number  // 'mcp' connect events (raw count — a connect is the event)
  shares: number     // 'share' events (raw count)
}

export interface FunnelRates extends FunnelCounts {
  playRate: number    // players / visitors
  editRate: number    // editors / visitors
  publishRate: number // publishers / visitors
}

/** A percentage in [0,100], one decimal, safe on a zero denominator (→ 0). */
export function pct(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

export function computeFunnel(c: FunnelCounts): FunnelRates {
  return {
    ...c,
    playRate: pct(c.players, c.visitors),
    editRate: pct(c.editors, c.visitors),
    publishRate: pct(c.publishers, c.visitors),
  }
}

export interface WorldRow { path: string; shares: number; newcomers: number }
export interface WorldVirality extends WorldRow { k: number } // new visitors per share

/** Per published world: how many new visitors each share brought (the viral
 *  coefficient k). Sorted by newcomers, then k. Guards shares=0 → k=0. */
export function worldVirality(rows: WorldRow[]): WorldVirality[] {
  return rows
    .map(r => ({ ...r, k: r.shares > 0 ? Math.round((r.newcomers / r.shares) * 100) / 100 : 0 }))
    .sort((a, b) => b.newcomers - a.newcomers || b.k - a.k)
}
