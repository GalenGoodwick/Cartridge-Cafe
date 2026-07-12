'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="text-center px-6">
        <div className="text-6xl mb-4">Something went wrong</div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Unexpected Error</h1>
        <p className="text-muted mb-8 max-w-md">
          We encountered an error while loading this page. Please try again.
        </p>
        <div className="flex gap-4 justify-center">
          <button
            onClick={reset}
            className="bg-accent hover:bg-accent-hover text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            Try Again
          </button>
          <Link
            href="/"
            className="bg-surface hover:bg-border text-foreground px-6 py-2 rounded-lg font-medium transition-colors border border-border"
          >
            Go Home
          </Link>
        </div>
        {error.digest && (
          <p className="text-muted-light text-xs mt-8">
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  )
}
