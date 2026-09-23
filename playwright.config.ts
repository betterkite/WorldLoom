import { defineConfig, devices } from '@playwright/test';

/**
 * D-3 端到端测试：真实浏览器跑核心用户旅程。
 *
 * 前置：数据库已迁移（pnpm db:deploy）、应用可访问。
 * 本地默认复用已在 4310 运行的服务；CI 中由 webServer 自行 `pnpm start`。
 * 设 E2E_BASE_URL 可指向其它实例（此时不启动 webServer）。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 共用同一个开发数据库，串行执行避免互相干扰
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4310',
    trace: 'on-first-retry',
    locale: 'zh-CN'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm start',
        url: 'http://localhost:4310/api/health',
        reuseExistingServer: true,
        timeout: 120_000
      }
});
