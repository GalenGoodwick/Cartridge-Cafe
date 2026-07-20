'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'

export function usePushNotifications() {
  const { data: session } = useSession()
  const [isSupported, setIsSupported] = useState(false)
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [permission, setPermission] = useState<NotificationPermission>('default')

  useEffect(() => {
    const checkSupport = async () => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window
      setIsSupported(supported)

      if (supported) {
        setPermission(Notification.permission)

        // Check if already subscribed
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        setIsSubscribed(!!subscription)
      }

      setIsLoading(false)
    }

    checkSupport()
  }, [])

  const subscribe = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!session?.user) {
      return { success: false, error: 'Must be logged in to subscribe' }
    }

    setIsLoading(true)

    try {
      // Request permission
      const permission = await Notification.requestPermission()
      setPermission(permission)

      if (permission !== 'granted') {
        return { success: false, error: 'Notification permission denied' }
      }

      // Get VAPID public key from server
      const keyResponse = await fetch('/api/push/vapid-public-key')
      const { publicKey } = await keyResponse.json()

      // Subscribe to push
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })

      // Send subscription to server
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      })

      if (!response.ok) {
        const text = await response.text()
        console.error('Subscribe error - Status:', response.status, 'Body:', text)
        let errorMsg = `Status ${response.status}`
        try {
          const data = JSON.parse(text)
          errorMsg = data.details || data.error || errorMsg
        } catch {
          errorMsg = text.slice(0, 200) || errorMsg
        }
        return { success: false, error: errorMsg }
      }

      setIsSubscribed(true)
      return { success: true }
    } catch (err) {
      console.error('Push subscription error:', err)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    } finally {
      setIsLoading(false)
    }
  }, [session])

  const unsubscribe = useCallback(async () => {
    setIsLoading(true)

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()

      if (subscription) {
        // Unsubscribe from browser
        await subscription.unsubscribe()

        // Remove from server
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
      }

      setIsSubscribed(false)
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    isSupported,
    isSubscribed,
    isLoading,
    permission,
    subscribe,
    unsubscribe,
  }
}

// Helper to convert VAPID key
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }

  return outputArray.buffer as ArrayBuffer
}
