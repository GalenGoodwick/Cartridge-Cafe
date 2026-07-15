'use client'

import { useState } from 'react'
import FieldEngine from '@/app/engine/FieldEngine'
import SpaceToolbar from './SpaceToolbar'

/** Client shell for a space page: holds the one piece of state the engine and
 *  the toolbar must share — the live bottom of the engine's top-right UI dock —
 *  so the VOTE button seats itself under the AI lamp instead of bottom-center,
 *  the same as it does inside the cafe shell. */
export default function SpaceStage({ spaceId, spaceSlug, engineOwner, isOwner, versionView, name, ownerName }: {
  spaceId: string
  spaceSlug: string
  engineOwner: boolean
  isOwner: boolean
  versionView?: number
  name: string
  ownerName: string | null
}) {
  const [dockBottom, setDockBottom] = useState(0)
  return (
    <>
      <FieldEngine
        spaceId={spaceId}
        spaceSlug={spaceSlug}
        isOwner={engineOwner}
        versionView={versionView}
        onDockRect={setDockBottom}
      />
      <SpaceToolbar
        slug={spaceSlug}
        name={name}
        ownerName={ownerName}
        isOwner={isOwner}
        versionView={versionView}
        railTop={dockBottom ? dockBottom + 8 : undefined}
      />
    </>
  )
}
