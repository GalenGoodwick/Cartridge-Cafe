'use client'
import { useEffect } from 'react'
import { installQuiet } from '@/lib/quiet'

// mounts the one idle gate (src/lib/quiet.ts) for the whole app — renders nothing
export function QuietWhenIdle() {
  useEffect(() => { installQuiet() }, [])
  return null
}
