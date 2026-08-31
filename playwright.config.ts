import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
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
