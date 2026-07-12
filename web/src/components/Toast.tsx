'use client'

import { useState, useEffect, createContext, useContext, useCallback } from 'react'

type ToastType = 'success' | 'error' | 'info' | 'celebration'

type Toast = {
  id: string
  message: string
  subtitle?: string
  type: ToastType
}

type ToastContextType = {
  showToast: (message: string, type?: ToastType, subtitle?: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    return {
      showToast: (message: string) => alert(message)
    }
  }
  return context
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, type: ToastType = 'info', subtitle?: string) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, message, type, subtitle }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  )
}

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  if (toasts.length === 0) return null

  const celebration = toasts.find(t => t.type === 'celebration')
  const regular = toasts.filter(t => t.type !== 'celebration')

  return (
    <>
      {celebration && (
        <CelebrationToast key={celebration.id} toast={celebration} onRemove={onRemove} />
      )}
      {regular.length > 0 && (
        <div
          className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
          role="status"
          aria-live="polite"
        >
          {regular.map(toast => (
            <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
          ))}
        </div>
      )}
    </>
  )
}

function CelebrationToast({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onRemove(toast.id)
    }, 8000)
    return () => clearTimeout(timer)
  }, [toast.id, onRemove])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
      <div
        role="alert"
        className="pointer-events-auto bg-background border-2 border-warning rounded-2xl shadow-2xl shadow-warning/20 px-8 py-6 max-w-md w-full text-center animate-in zoom-in-95 fade-in duration-300"
        onClick={() => onRemove(toast.id)}
      >
        <p className="text-3xl mb-2">&#9733;</p>
        <p className="text-lg font-bold text-warning">{toast.message}</p>
        {toast.subtitle && (
          <p className="text-sm text-foreground mt-2 leading-relaxed">{toast.subtitle}</p>
        )}
        <p className="text-xs text-muted mt-3">Tap to dismiss</p>
      </div>
    </div>
  )
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onRemove(toast.id)
    }, 4000)
    return () => clearTimeout(timer)
  }, [toast.id, onRemove])

  const colors = {
    success: 'bg-success text-white',
    error: 'bg-error text-white',
    info: 'bg-accent text-white',
    celebration: 'bg-warning text-white',
  }

  return (
    <div
      role="alert"
      className={`${colors[toast.type]} px-4 py-3 rounded-lg shadow-lg flex items-center justify-between gap-3 animate-in slide-in-from-right`}
    >
      <div>
        <p className="text-sm">{toast.message}</p>
        {toast.subtitle && <p className="text-xs opacity-90 mt-0.5">{toast.subtitle}</p>}
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        className="text-white/80 hover:text-white shrink-0"
        aria-label="Dismiss notification"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
