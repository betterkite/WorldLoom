import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

let ownedFixture: { id: string; name: string } | null = null;

// A timed-out test loses its original request context. Use a fresh teardown
// context so cleanup still runs, and never discover/delete fixtures by prefix.
test.afterEach(async ({ playwright, baseURL }) => {
  if (!ownedFixture) return;
  const api = await playwright.request.newContext({ baseURL, timeout: 10_000 });
  try {
    const detail = await api.get(`/api/worlds/${ownedFixture.id}`);
    expect(detail.ok()).toBe(true);
    expect((await detail.json()).world.name).toBe(ownedFixture.name);
    expect((await api.delete(`/api/worlds/${ownedFixture.id}`)).ok()).toBe(true);
    expect((await api.get(`/api/worlds/${ownedFixture.id}`)).status()).toBe(404);
    ownedFixture = null;
  } finally {
    await api.dispose();
  }
});

test('desktop palette filters, selects with arrow keys, and restores focus', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/dashboard/overview');
  const trigger = page.getByRole('button', { name: '打开命令面板' });
  await trigger.focus();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: '命令面板' });
  await expect(dialog).toBeVisible();
  const input = page.getByRole('combobox', { name: '搜索命令' });
  await expect(input).toBeFocused();
  await input.fill('模式');
  const selected = dialog.locator('[cmdk-item][data-selected="true"]');
  await expect(selected).toContainText('切换明暗模式');
  const idle = dialog.getByRole('option', { name: '使用浅色模式' });
  const selectedBackground = await selected.evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  const idleBackground = await idle.evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  expect(selectedBackground).not.toBe(idleBackground);
  await page.keyboard.press('ArrowDown');
  await expect(selected).toContainText('使用浅色模式');
  await page.keyboard.press('ArrowUp');
  await expect(selected).toContainText('切换明暗模式');
  await input.fill('');
  const appearance = await page.locator('html').getAttribute('class');
  await page.keyboard.press('d');
  await page.keyboard.press('d');
  expect(await page.locator('html').getAttribute('class')).toBe(appearance);
  await input.fill('不存在的命令-unique');
  await expect(dialog.getByText('没有找到匹配的命令。')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Meta+k');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Meta+k');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(dialog).toBeVisible();
  await input.fill('技能库');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard\/skills$/);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('出了点问题')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('phone palette has a touch entry and remains inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto('/dashboard/overview');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: '打开命令面板' }).click();
  const dialog = page.getByRole('dialog', { name: '命令面板' });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  await page.getByRole('combobox', { name: '搜索命令' }).fill('评测平台');
  await dialog.getByRole('option', { name: '评测平台' }).click();
  await expect(page).toHaveURL(/\/dashboard\/evals$/);
  await expect(dialog).toHaveCount(0);
});

test('malformed world-list responses stay recoverable without a global render error', async ({
  page
}) => {
  for (const payload of [{}, { worlds: null }, { worlds: [null] }]) {
    await page.route('**/api/worlds', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload)
      })
    );
    await page.goto('/dashboard/overview');
    await expect(page.getByText('世界列表暂时无法加载')).toBeVisible();
    await expect(page.getByText('出了点问题')).toHaveCount(0);
    await page.unroute('**/api/worlds');
    await page.getByRole('button', { name: '重新加载世界列表' }).click();
    await expect(page.getByText('世界列表暂时无法加载')).toHaveCount(0);
  }
});

test('palette world destinations use the actual current world, not a placeholder', async ({
  page,
  request
}) => {
  const name = `命令面板测试-${randomUUID()}`;
  const created = await request.post('/api/worlds', { data: { name, premise: '临时导航验收' } });
  expect(created.ok()).toBe(true);
  const { world } = await created.json();
  expect(world.id).toBeTruthy();
  ownedFixture = { id: world.id, name };
  await page.goto(`/dashboard/worlds/${world.id}/story`);
  await page.getByRole('button', { name: '打开命令面板' }).click();
  await page.getByRole('combobox', { name: '搜索命令' }).fill('时间线');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/dashboard/worlds/${world.id}/timeline`);
  await expect(page.getByText('出了点问题')).toHaveCount(0);
});

test('palette falls back safely when the world list is unavailable', async ({ page }) => {
  await page.route('**/api/worlds', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{}'
    })
  );
  await page.goto('/dashboard/skills');
  await page.getByRole('button', { name: '打开命令面板' }).click();
  await page.getByRole('combobox', { name: '搜索命令' }).fill('故事创作');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard\/overview$/);
  await expect(page.getByText('出了点问题')).toHaveCount(0);
  await expect(page.getByText('世界列表暂时无法加载')).toBeVisible();
  await expect(page.getByRole('button', { name: '打开命令面板' })).toBeVisible();
  await page.unroute('**/api/worlds');
  await page.getByRole('button', { name: '重新加载世界列表' }).click();
  await expect(page.getByText('世界列表暂时无法加载')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '世界总览' })).toBeVisible();
});

test('D D changes appearance and G W navigates without conflicting', async ({ page }) => {
  await page.goto('/dashboard/skills');
  await page.getByRole('button', { name: '打开命令面板' }).focus();
  const before = await page.locator('html').getAttribute('class');
  await page.keyboard.press('d');
  await page.keyboard.press('d');
  await expect.poll(() => page.locator('html').getAttribute('class')).not.toBe(before);
  await expect(page).toHaveURL(/\/dashboard\/skills$/);
  await page.keyboard.press('g');
  await page.keyboard.press('w');
  await expect(page).toHaveURL(/\/dashboard\/overview$/);
});
