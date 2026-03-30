import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    globalSetup: ['./tests/utils/globalSetup.ts'],
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/int/**/*.int.spec.ts', 'tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    // Run test files sequentially to avoid MongoDB race conditions
    fileParallelism: false,
    // Also run tests within files sequentially
    sequence: {
      concurrent: false,
    },
    // Handle CSS imports from node_modules
    css: true,
    // Integration tests need more time to initialize Payload + MongoMemoryServer
    hookTimeout: 30000,
    // Single-threaded so globalSetup env vars are inherited by tests
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
  resolve: {
    alias: {
      'react-image-crop/dist/ReactCrop.css': '/dev/null',
    },
  },
})
