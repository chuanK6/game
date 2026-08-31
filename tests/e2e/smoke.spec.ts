import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
})

test('首页、游戏库和详情页可用', async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '下一段冒险，从这里启程' })).toBeVisible()
  await expect(page.locator('.game-card')).toHaveCount(4)
  await expect(page.locator('.home-hero')).toHaveCSS('background-image', /hero-[1-4]\.webp/)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: `test-results/home-${testInfo.project.name}.png`, fullPage: true })

  await page.goto('/games?category=模拟经营')
  await expect(page.locator('.results-header')).toContainText('2 个结果')
  await expect(page.locator('.game-card')).toHaveCount(2)
  await page.locator('.game-card').first().click()
  await expect(page.getByRole('heading', { name: '浮岛工坊' })).toBeVisible()
  await expect(page.getByText('登录后获取下载地址')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  expect(consoleErrors).toEqual([])
})

test('登录后可打开会员付款工单流程', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('用户名').fill('demo_user')
  await page.getByLabel('密码', { exact: true }).fill('123456')
  await page.locator('.auth-submit').click()
  await expect(page).toHaveURL('http://127.0.0.1:5173/')

  await page.goto('/profile?tab=membership')
  await expect(page.getByRole('heading', { name: '会员中心' })).toBeVisible()
  await page.locator('.plan-card.featured .button').click()
  await expect(page.getByRole('dialog')).toContainText('开通终身会员')
  await expect(page.getByRole('dialog').getByText('demo_user')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}
