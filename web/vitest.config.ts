import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Minimal config so unit tests can resolve the `@/…` path alias (mirrors
// tsconfig `paths`). Node environment — the pure helpers under test need no DOM.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
})
