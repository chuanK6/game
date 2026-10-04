import { expect, test } from '@playwright/test'

test('切换页面不会叠高，筛选保留位置，详情返回后可以打开另一款游戏', async ({ page }) => {
  const warnings: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('[Vue warn]')) warnings.push(message.text())
  })
  await page.goto('/')
  await page.getByRole('link', { name: '查看全部' }).click()
  await expect(page.locator('.game-card')).toHaveCount(4)
  await expect(page.locator('.route-page')).toHaveCount(1)
  await page.getByRole('button', { name: '模拟经营', exact: true }).scrollIntoViewIfNeeded()
  const filterScroll = await page.evaluate(() => window.scrollY)
  await page.getByRole('button', { name: '模拟经营', exact: true }).click()
  await expect(page.locator('.game-card')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(filterScroll, 0)
  await page.locator('.game-card').click()
  await expect(page.getByRole('heading', { name: '浮岛工坊', exact: true })).toBeVisible()
  await expect(page.locator('.route-page')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await page.getByRole('link', { name: '查看配置' }).click()
  await expect.poll(async () => {
    const box = await page.locator('#requirements').boundingBox()
    return box ? box.y >= 62 && box.y + box.height <= (page.viewportSize()?.height ?? 0) : false
  }).toBe(true)
  await page.getByRole('link', { name: '返回游戏库' }).click()
  await expect(page.locator('.game-card')).toHaveCount(4)
  await page.locator('.game-card').filter({ hasText: '星海漂流者' }).click()
  await expect(page.getByRole('heading', { name: '星海漂流者', exact: true })).toBeVisible()
  await expect(page.locator('.download-panel')).toContainText('会员专享资源')
  await page.getByRole('button', { name: '登录下载', exact: true }).click()
  await expect(page).toHaveURL(/\/auth\?redirect=/)
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/games/stellar-drifter')
  expect(warnings).toEqual([])
})

test('详情加载失败可重试，缺失封面和配置仍可浏览，维护资源显示状态', async ({ page }) => {
  let respond: (() => void) | undefined
  const responseGate = new Promise<void>((resolve) => { respond = resolve })
  let attempts = 0
  await page.route('**/api/games/detail-preview', async (route) => {
    attempts += 1
    if (attempts === 1) {
      await responseGate
      await route.fulfill({ status: 503, json: { ok: false, error: { code: 'UNAVAILABLE', message: '暂时无法加载，请重试。' } } })
      return
    }
    await route.fulfill({ json: { ok: true, data: {
      id: 99, slug: 'detail-preview', name: '一款拥有很长名称的游戏 / A Very Long Game Title',
      cover: '/missing-cover.webp', category: { name: '模拟经营', slug: 'simulation' }, tags: [],
      description: '第一段介绍。\n\n第二段介绍。', minConfig: [], resourceType: 'free',
      resourceStatus: 'checking', publishAt: '2026-08-24',
    } } })
  })
  await page.route('**/missing-cover.webp', (route) => route.abort())
  await page.goto('/games/detail-preview')
  await expect(page.getByRole('status', { name: '正在加载游戏详情' })).toBeVisible()
  respond?.()
  await expect(page.getByRole('heading', { name: '游戏不可用' })).toBeVisible()
  await page.getByRole('button', { name: '重新加载' }).click()
  await expect(page.locator('.detail-cover-fallback')).toBeVisible()
  await expect(page.locator('#requirements')).toContainText('配置要求正在补充中')
  await expect(page.locator('#downloads')).toContainText('资源维护中')
  await expect(page.getByRole('button', { name: '登录下载' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
})

test('减少动态效果时关闭页面位移和首页轮播动画', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.hero-zoom-layer')).toBeVisible()
  await page.getByRole('link', { name: '查看全部' }).click()
  await expect(page.locator('.game-card')).toHaveCount(4)
  await expect(page.locator('.route-page')).toHaveCount(1)
  await expect(page.locator('.route-page')).toHaveCSS('transform', 'none')
  await expect(page.locator('.route-page')).toHaveCSS('transition-duration', '1e-05s')
  await page.locator('.game-card').first().click()
  await expect(page.locator('.detail-hero')).toBeVisible()
  await expect(page.locator('.detail-hero')).toHaveCSS('animation-duration', '1e-05s')
})
