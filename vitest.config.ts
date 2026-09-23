import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Integration tests share one physical test database — files must not
    // run in parallel or they truncate each other's fixtures.
    fileParallelism: false,
    // Integration tests (governance) run against the throwaway test database.
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://worldloom:worldloom@localhost:43133/worldloom_test'
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});
