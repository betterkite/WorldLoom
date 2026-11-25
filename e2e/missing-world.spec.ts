import { expect, test } from '@playwright/test';

const missingWorldId = 'worldloom-missing-world-for-e2e';

test('invalid story deep link keeps the recovery path and mobile sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  const childRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(`/api/worlds/${missingWorldId}/`)) {
      childRequests.push(request.url());
    }
  });

  const response = await page.goto(`/dashboard/worlds/${missingWorldId}/story`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: '世界不存在或已移除' })).toBeVisible();
  await expect(page.getByText('出了点问题')).toHaveCount(0);
  expect(childRequests).toEqual([]);

  const reloaded = await page.reload();
  expect(reloaded?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: '世界不存在或已移除' })).toBeVisible();
  await expect(page.getByText('出了点问题')).toHaveCount(0);

  await page.getByRole('button', { name: '切换侧边栏' }).click();
  await expect(page.getByRole('link', { name: '世界列表' })).toBeVisible();
  await page.getByRole('link', { name: '世界列表' }).click();
  await expect(page).toHaveURL(/\/dashboard\/overview$/);
  await expect(page.getByRole('dialog', { name: 'Sidebar' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '世界总览' })).toBeVisible();
});

test('invalid world version deep link has a desktop recovery link', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const response = await page.goto(`/dashboard/worlds/${missingWorldId}/versions`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: '世界不存在或已移除' })).toBeVisible();
  await page.getByRole('link', { name: '返回世界列表' }).click();
  await expect(page).toHaveURL(/\/dashboard\/overview$/);
});

test('every world workbench route recovers when the world is missing', async ({ request }) => {
  const sections = [
    '',
    'assistant',
    'entities',
    'entities/missing-entity',
    'events',
    'genesis',
    'graph',
    'lint',
    'manuscript',
    'ops',
    'review',
    'sources',
    'story',
    'timeline',
    'versions'
  ];

  for (const section of sections) {
    const response = await request.get(`/dashboard/worlds/${missingWorldId}/${section}`);
    expect(response.status(), section || 'world root').toBe(404);
    expect(await response.text(), section || 'world root').toContain('世界不存在或已移除');
  }
});

test('phone-width navigation closes the sidebar after changing pages', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto('/dashboard/overview');
  await page.locator('[data-sidebar=trigger]').click();
  await page.getByRole('link', { name: '技能库' }).click();
  await expect(page).toHaveURL(/\/dashboard\/skills$/);
  await expect(page.getByRole('dialog', { name: 'Sidebar' })).toHaveCount(0);
  await expect(page.getByText('出了点问题')).toHaveCount(0);
});

test('stale saved and current world IDs never become sidebar destinations', async ({
  page,
  request
}) => {
  const worldsResponse = await request.get('/api/worlds');
  expect(worldsResponse.ok()).toBe(true);
  const { worlds } = (await worldsResponse.json()) as { worlds: { id: string }[] };
  const firstWorldId = worlds[0]?.id;
  const expectedStoryHref = firstWorldId
    ? `/dashboard/worlds/${firstWorldId}/story`
    : '/dashboard/overview';

  await page.goto('/dashboard/skills');
  await page.evaluate((id) => localStorage.setItem('worldloom:lastWorld', id), missingWorldId);
  await page.reload();

  const storyLink = page.locator('a[aria-label="故事创作"]');
  await expect(storyLink).toHaveAttribute('href', expectedStoryHref);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('worldloom:lastWorld')))
    .toBeNull();

  await page.goto(`/dashboard/worlds/${missingWorldId}/story`);
  await expect(page.getByRole('heading', { name: '世界不存在或已移除' })).toBeVisible();
  await expect(storyLink).toHaveAttribute('href', expectedStoryHref);

  if (firstWorldId) {
    await page.goto(`/dashboard/worlds/${firstWorldId}/story`);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('worldloom:lastWorld')))
      .toBe(firstWorldId);
  }
});

test('world-list failure does not reuse a saved stale world ID', async ({ page }) => {
  await page.goto('/dashboard/skills');
  await page.evaluate((id) => localStorage.setItem('worldloom:lastWorld', id), missingWorldId);
  await page.route('**/api/worlds', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
  );
  await page.reload();

  await expect(page.locator('a[aria-label="故事创作"]')).toHaveAttribute(
    'href',
    '/dashboard/overview'
  );
  await expect(page.getByText('出了点问题')).toHaveCount(0);
});
