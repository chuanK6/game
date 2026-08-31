import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('首页、游戏库和详情页可用', async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '下一段冒险，从这里启程' })).toBeVisible()
  await expect(page.locator('.game-card')).toHaveCount(4)
  await expect(page.locator('.hero-zoom-layer')).toHaveCSS('background-image', /hero-[1-4]\.webp/)
  await expect(page.locator('.hero-zoom-layer')).toHaveCSS('animation-name', 'hero-kenburns')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: `test-results/home-${testInfo.project.name}.png` })

  await page.goto('/games?category=simulation')
  await expect(page.locator('.results-header')).toContainText('1 个结果')
  await expect(page.locator('.game-card')).toHaveCount(1)
  await page.locator('.game-card').first().click()
  await expect(page.getByRole('heading', { name: '浮岛工坊' })).toBeVisible()
  await expect(page.getByText('登录后获取下载地址')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  expect(consoleErrors).toEqual([])
})

test('注册、会话恢复和会员工单流程可用', async ({ page }) => {
  const username = `e2e${Date.now().toString().slice(-8)}`
  await page.goto('/auth')
  await page.locator('.auth-tabs button').filter({ hasText: '注册' }).click()
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码', { exact: true }).fill('Demo123456')
  await page.getByLabel('确认密码').fill('Demo123456')
  await page.locator('.auth-submit').click()
  await expect(page).toHaveURL('http://127.0.0.1:5173/')

  await page.goto('/profile?tab=membership')
  await expect(page.getByRole('heading', { name: '会员中心' })).toBeVisible()
  await page.locator('.plan-card.featured .button').click()
  await expect(page.getByRole('dialog')).toContainText('开通终身会员')
  await expect(page.getByRole('dialog').getByText(username)).toBeVisible()
  await page.getByRole('button', { name: '我已付款，提交工单' }).click()
  await expect(page.getByText('终身会员开通申请')).toBeVisible()

  await page.reload()
  await expect(page.locator('.profile-user')).toContainText(username)
  await expectNoHorizontalOverflow(page)
})

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}
