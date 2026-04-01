import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    // Resolve TypeScript .ts files when imports use .js extensions
    // (required for Node16 module resolution compatibility)
    extensions: ['.ts', '.js'],
  },
})
