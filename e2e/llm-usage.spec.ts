import { expect, test, type Page } from '@playwright/test';

// UI contract fixtures only: intercept every API, never create/delete a world,
// call a provider, or use these responses as persistent-usage/DB evidence.
function summary(input = '10', output = '20', calls = '1') {
  const totals = {
    calls,
    knownUsageCalls: calls,
    unknownUsageCalls: '0',
    pendingCalls: '0',
    failedCalls: '0',
    inputTokens: input,
    outputTokens: output,
    totalTokens: (BigInt(input) + BigInt(output)).toString()
  };
  return {
    scope: 'local-recorded-chat-attempts',
    recordedFrom: '2026-10-01T00:00:00.000Z',
    updatedAt: calls === '1' ? '2026-10-01T01:00:00.000Z' : '2026-10-01T01:05:00.000Z',
    totals,
    profiles: [{ profileId: 'ui-fixture', model: 'mock-only', ...totals }],
    recording: { currentProcessWriteFailures: '0' }
  };
}

function card(page: Page) {
  return page.locator('[aria-label="累计模型用量"]');
}

function total(page: Page) {
  return card(page).getByText('已知总 token', { exact: true }).locator('..').locator('dd');
}

test.beforeEach(async ({ page }) => {
  // Later exact routes take precedence. Unexpected APIs are blocked, not sent
  // through to a real DB or model. The HTML/assets still need a fresh candidate.
  await page.route('**/api/**', (route) => route.abort('blockedbyclient'));
  await page.route('**/api/worlds', (route) => route.fulfill({ json: { worlds: [] } }));
});

test('initial usage failure stays local and manual refresh recovers without a zero snapshot', async ({
  page
}) => {
  let reads = 0;
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 375, height: 850 });
  await page.route('**/api/llm/usage', (route) => {
    reads += 1;
    return reads === 1
      ? route.fulfill({ status: 503, body: 'private-ui-response-sentinel' })
      : route.fulfill({ json: summary() });
  });
  await page.goto('/dashboard/overview');
  await expect(card(page).getByRole('alert')).toContainText('不表示累计用量为零');
  await expect(card(page).locator('dl')).toHaveCount(0);
  await expect(card(page)).not.toContainText('private-ui-response-sentinel');
  await expect(page.getByRole('heading', { name: '世界总览' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建世界' })).toBeEnabled();
  await page.getByRole('button', { name: '切换侧边栏' }).click();
  await expect(page.getByRole('link', { name: '世界列表' })).toBeVisible();
  await expect(page.getByRole('link', { name: '世界列表' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Sidebar' })).toHaveCount(0);

  await card(page).getByRole('button', { name: '刷新用量' }).click();
  await expect(total(page)).toHaveText('30');
  await expect(card(page).getByRole('alert')).toHaveCount(0);
  await expect(card(page).getByRole('status')).toContainText('统计快照');
  await expect(card(page)).toContainText('非实时统计');
  expect(reads).toBe(2);
  expect(pageErrors).toEqual([]);
});

test('a failed refresh labels the previous snapshot stale and a later refresh replaces it', async ({
  page
}) => {
  let reads = 0;
  await page.route('**/api/llm/usage', (route) => {
    reads += 1;
    if (reads === 2) return route.fulfill({ contentType: 'application/json', body: '{}' });
    return route.fulfill({ json: reads === 1 ? summary() : summary('20', '40', '2') });
  });
  await page.goto('/dashboard/overview');
  await expect(total(page)).toHaveText('30');
  await card(page).getByRole('button', { name: '刷新用量' }).click();
  await expect(card(page).getByRole('alert')).toContainText('上次成功读取的快照，不是当前用量');
  await expect(card(page).getByRole('status')).toContainText('非当前值');
  await expect(total(page)).toHaveText('30');
  await expect(card(page).getByRole('button', { name: '刷新用量' })).toBeEnabled();
  await card(page).getByRole('button', { name: '刷新用量' }).click();
  await expect(total(page)).toHaveText('60');
  await expect(card(page).getByRole('alert')).toHaveCount(0);
  await expect(card(page).getByRole('status')).not.toContainText('非当前值');
  await expect(page.getByText('出了点问题')).toHaveCount(0);
  expect(reads).toBe(3);
});

test('a stalled request times out, re-enables refresh and does not block the world list', async ({
  page
}) => {
  await page.clock.install();
  let reads = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/llm/usage', async (route) => {
    reads += 1;
    if (reads === 1) {
      await held;
      await route.abort('aborted').catch(() => {}); // May already be cancelled.
    } else {
      await route.fulfill({ json: summary() });
    }
  });
  try {
    await page.goto('/dashboard/overview');
    await expect.poll(() => reads).toBe(1);
    await expect(card(page).getByRole('button', { name: '正在读取...' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '新建世界' })).toBeEnabled();
    await page.clock.fastForward(10_100);
    await expect(card(page).getByRole('alert')).toContainText('读取超时');
    await expect(card(page).getByRole('button', { name: '刷新用量' })).toBeEnabled();
    await card(page).getByRole('button', { name: '刷新用量' }).click();
    await expect(total(page)).toHaveText('30');
    await expect(card(page).getByRole('alert')).toHaveCount(0);
    expect(reads).toBe(2);
  } finally {
    release();
  }
});

test('phone layout preserves exact large tokens and separates pending unknown usage', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 850 });
  let unknown = false;
  await page.route('**/api/llm/usage', (route) => {
    if (!unknown) return route.fulfill({ json: summary('9007199254740993', '2') });
    const value = summary();
    const counters = {
      calls: '1',
      knownUsageCalls: '0',
      unknownUsageCalls: '1',
      pendingCalls: '1',
      failedCalls: '0',
      inputTokens: null,
      outputTokens: null,
      totalTokens: null
    };
    return route.fulfill({
      json: {
        ...value,
        totals: counters,
        profiles: [{ profileId: 'ui-fixture', model: 'mock-only', ...counters }]
      }
    });
  });
  await page.goto('/dashboard/overview');
  await expect(total(page)).toHaveText('9,007,199,254,740,995');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  unknown = true;
  await card(page).getByRole('button', { name: '刷新用量' }).click();
  await expect(total(page)).toHaveText('暂无完整用量');
  await expect(card(page)).toContainText('未知用量 1 次');
  await expect(card(page)).toContainText('待结算/中断 1 次');
  await expect(card(page).getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('出了点问题')).toHaveCount(0);
});
