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
    // Run test files sequentially — Payload's pg pool is shared and the
    // schema push happens once in globalSetup.
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
    css: true,
    // Integration tests need extra time to pull the postgres image, start
    // the testcontainer, and run Payload's push:true schema sync against it.
    hookTimeout: 120000,
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
