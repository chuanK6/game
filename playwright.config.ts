import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  webServer: [
    { command: 'npm run dev:api', url: 'http://127.0.0.1:8787/api/health', reuseExistingServer: true, timeout: 120_000 },
    { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 120_000 },
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-edge', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-edge', use: { ...devices['iPhone 13'], browserName: 'chromium', channel: 'msedge' } },
  ],
})
