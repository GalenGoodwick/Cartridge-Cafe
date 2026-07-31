// engine/VersionsPanel.tsx — the ⏱ VERSIONS modal (save/view/restore save
// points), carved out of FieldEngine.tsx (DESIGN-fieldengine-carve.md, Phase 4).
// Pure move, byte-identical body.
'use client'

import type { Dispatch, SetStateAction } from 'react'

export function VersionsPanel({ spaceSlug, playScene, spaceId, isOwner, versionBusy, setVersionBusy, versionList, loadVersions, showToast, setVersionsOpen }: {
  spaceSlug: string
  playScene?: string
  spaceId?: string
  isOwner?: boolean
  versionBusy: boolean
  setVersionBusy: Dispatch<SetStateAction<boolean>>
  versionList: Array<{ version: number; note: string | null; createdAt: string; author?: { name: string | null } | null }>
  loadVersions: () => Promise<void>
  showToast: (message: string, type?: 'info' | 'success' | 'error', subtitle?: string) => void
  setVersionsOpen: Dispatch<SetStateAction<boolean>>
}) {
  return (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setVersionsOpen(false)}>
              <div className="max-w-md w-[92%] max-h-[76%] overflow-y-auto rounded-xl border border-white/15 bg-black/85 backdrop-blur p-5 font-mono text-[17px] text-white/85" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[16px] tracking-[0.25em] text-white/50">⏱ VERSIONS OF {(playScene || spaceSlug || '').toUpperCase()}</div>
                  <button aria-label="Close" className="text-white/40 hover:text-white text-[18px] leading-none px-1.5 py-0.5 rounded border border-white/10 hover:border-white/30" onClick={() => setVersionsOpen(false)}>✕</button>
                </div>
                {(isOwner || !spaceId) && (
                  <button
                    disabled={versionBusy}
                    className="w-full text-left px-3 py-2 rounded-lg border border-emerald-400/30 text-emerald-200/90 hover:bg-emerald-400/10 transition-colors mb-3 disabled:opacity-40"
                    onClick={async () => {
                      setVersionBusy(true)
                      try {
                        const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/versions`, {
                          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
                        }).then(x => x.json())
                        showToast(r.deduped ? `no change since v${r.version?.version} — nothing to save` : `saved v${r.version?.version}`, 'success')
                        await loadVersions()
                      } catch { showToast('could not save version', 'error') } finally { setVersionBusy(false) }
                    }}
                  >
                    ＋ SAVE A VERSION <span className="text-white/40 text-[14px]">— snapshot the world as it stands (identical saves are skipped)</span>
                  </button>
                )}
                {versionList.length === 0 && <div className="text-white/35 text-[16px] px-1 py-2">no versions yet — save one, or the eye will as you build.</div>}
                {versionList.map(v => (
                  <div key={v.version} className="flex items-center gap-2 rounded-lg border border-white/10 mb-1.5 px-3 py-2">
                    <span className="text-amber-200/90 tracking-[0.1em]">v{v.version}</span>
                    <span className="flex-1 text-white/50 text-[14px] truncate">{v.note || (v.author?.name ? `by ${v.author.name}` : '—')}</span>
                    <button
                      className="text-[14px] text-white/50 hover:text-white px-1.5"
                      title="preview this version in a new tab"
                      onClick={() => window.open(`/space/${encodeURIComponent(spaceSlug)}?version=${v.version}`, '_blank')}
                    >VIEW</button>
                    {(isOwner || !spaceId) && (
                      <button
                        disabled={versionBusy}
                        className="text-[14px] border border-white/15 rounded px-2 py-0.5 text-white/60 hover:text-white hover:border-white/40 disabled:opacity-40"
                        title="set this version as MAIN — what everyone sees (current state is saved first)"
                        onClick={async () => {
                          if (!window.confirm(`Set v${v.version} as MAIN — the live world everyone sees? Your current state is saved as a new version first.`)) return
                          setVersionBusy(true)
                          try {
                            await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/versions/${v.version}`, {
                              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'apply' }),
                            })
                            showToast(`restored v${v.version} — reloading`, 'success')
                            setTimeout(() => window.location.reload(), 600)
                          } catch { showToast('restore failed', 'error') } finally { setVersionBusy(false) }
                        }}
                      >SET MAIN</button>
                    )}
                  </div>
                ))}
                <div className="text-[14px] text-white/30 mt-2">save points are versions · restoring never destroys — the live world is snapshotted first</div>
              </div>
            </div>
  )
}
