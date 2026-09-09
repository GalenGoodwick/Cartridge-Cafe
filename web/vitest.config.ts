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
    // dev-DB integration suites talk to serverless Neon — cold starts + parallel
    // load make 5s timeouts a flake machine (pages-flow, Sep 8). Units still
    // finish in ms; a hang still fails, just honestly.
    testTimeout: 30_000,
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup-env.ts'],
  },
})
