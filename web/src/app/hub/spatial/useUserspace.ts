'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Socket } from 'socket.io-client'

export interface UserspaceNode {
  userId: string
  hostName: string
  hostColor: string
  spaceSlug?: string | null
  occupancy: number
  currentChant: string | null
  activeTab: string
}

export interface UserspaceNavState {
  dockedPostId: string | null
  activeSubspaceId: string | null
  activeTab: string
}

interface UserspaceVisitor {
  userId: string
  name: string
  color: string
}

interface UseUserspaceOptions {
  socketRef: React.MutableRefObject<Socket | null>
  userId: string
  connected: boolean
}

interface UseUserspaceReturn {
  /** All active user subspaces (for spatial canvas) */
  activeSubspaces: UserspaceNode[]
  /** Current host's nav state when visiting a userspace */
  hostNavState: UserspaceNavState | null
  /** Visitors in the user's own subspace */
  visitors: UserspaceVisitor[]
  /** Enter a host's userspace */
  enterUserspace: (hostUserId: string) => void
  /** Leave current userspace */
  leaveUserspace: (hostUserId: string) => void
  /** Broadcast own nav state to subspace visitors (when user is a host) */
  broadcastNavUpdate: (state: UserspaceNavState) => void
}

const PRESENCE_URL = process.env.NEXT_PUBLIC_PRESENCE_URL || 'http://localhost:8080'

export function useUserspace({ socketRef, userId, connected }: UseUserspaceOptions): UseUserspaceReturn {
  const [activeSubspaces, setActiveSubspaces] = useState<UserspaceNode[]>([])
  const [hostNavState, setHostNavState] = useState<UserspaceNavState | null>(null)
  const [visitors, setVisitors] = useState<UserspaceVisitor[]>([])
  const lastBroadcastRef = useRef<string>('')

  // Poll /userspaces for spatial canvas data
  useEffect(() => {
    let mounted = true
    const poll = () => {
      fetch(`${PRESENCE_URL}/userspaces`)
        .then(r => r.json())
        .then((data: Record<string, Omit<UserspaceNode, 'userId'>>) => {
          if (!mounted) return
          const nodes: UserspaceNode[] = Object.entries(data)
            .filter(([id]) => id !== userId) // don't show self
            .map(([id, info]) => ({ userId: id, ...info }))
          setActiveSubspaces(nodes)
        })
        .catch(() => {})
    }
    poll()
    const timer = setInterval(poll, 3_000)
    return () => { mounted = false; clearInterval(timer) }
  }, [userId])

  // Listen for userspace socket events
  useEffect(() => {
    const socket = socketRef.current
    if (!socket || !connected) return

    const handleHostNavigated = (data: { hostUserId: string } & UserspaceNavState) => {
      setHostNavState({
        dockedPostId: data.dockedPostId,
        activeSubspaceId: data.activeSubspaceId,
        activeTab: data.activeTab,
      })
    }

    const handleUserspaceInfo = (data: { hostUserId: string; navState: UserspaceNavState }) => {
      if (data.navState) {
        setHostNavState(data.navState)
      }
    }

    const handleVisitorJoined = (data: UserspaceVisitor) => {
      setVisitors(prev => {
        if (prev.find(v => v.userId === data.userId)) return prev
        return [...prev, data]
      })
    }

    const handleVisitorLeft = (data: { userId: string }) => {
      setVisitors(prev => prev.filter(v => v.userId !== data.userId))
    }

    const handleHostDisconnected = () => {
      setHostNavState(null)
    }

    socket.on('host-navigated', handleHostNavigated)
    socket.on('userspace-info', handleUserspaceInfo)
    socket.on('userspace-visitor-joined', handleVisitorJoined)
    socket.on('userspace-visitor-left', handleVisitorLeft)
    socket.on('host-disconnected', handleHostDisconnected)

    return () => {
      socket.off('host-navigated', handleHostNavigated)
      socket.off('userspace-info', handleUserspaceInfo)
      socket.off('userspace-visitor-joined', handleVisitorJoined)
      socket.off('userspace-visitor-left', handleVisitorLeft)
      socket.off('host-disconnected', handleHostDisconnected)
    }
  }, [socketRef, connected])

  const enterUserspace = useCallback((hostUserId: string) => {
    const socket = socketRef.current
    if (!socket?.connected) return
    socket.emit('enter-userspace', { hostUserId })
  }, [socketRef])

  const leaveUserspace = useCallback((hostUserId: string) => {
    const socket = socketRef.current
    if (!socket?.connected) return
    socket.emit('leave-userspace', { hostUserId })
    setHostNavState(null)
  }, [socketRef])

  const broadcastNavUpdate = useCallback((state: UserspaceNavState) => {
    const socket = socketRef.current
    if (!socket?.connected) return
    // Debounce: don't broadcast if state hasn't changed
    const key = JSON.stringify(state)
    if (key === lastBroadcastRef.current) return
    lastBroadcastRef.current = key
    socket.emit('host-nav-update', state)
  }, [socketRef])

  return {
    activeSubspaces,
    hostNavState,
    visitors,
    enterUserspace,
    leaveUserspace,
    broadcastNavUpdate,
  }
}
