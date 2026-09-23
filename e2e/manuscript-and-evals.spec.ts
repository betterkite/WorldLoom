import { expect, request as playwrightRequest, test } from '@playwright/test';

/**
 * D-3 第二条旅程：作品导入 → 章节切片 → 评测跑分（全部不依赖真实模型）。
 * 世界与条目用 API 快速播种（UI 建世界的旅程由 world-journey.spec.ts 覆盖）。
 */

test.describe.serial('作品导入与评测跑分（UI 端到端）', () => {
  test('import manuscript → chapters → eval case → retrieval run', async ({ page }) => {
    const api = await playwrightRequest.newContext({
      baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4310'
    });
    const worldName = `E2E 评测世界 ${Date.now()}`;
    let worldId: string | null = null;

    try {
      const created = await api.post('/api/worlds', {
        data: { name: worldName, premise: '导入与评测旅程' },
        timeout: 10_000
      });
      worldId = ((await created.json()) as { world: { id: string } }).world.id;

      await api.post(`/api/worlds/${worldId}/changes`, {
        data: {
          kind: 'entity_upsert',
          payload: {
            kind: 'character',
            name: '向顶天',
            aliases: [],
            summary: '得书入梦的少年',
            content: '',
            confidence: 'INFERRED',
            tags: [],
            sourceRefs: []
          }
        },
        timeout: 10_000
      });
      await api.post(`/api/worlds/${worldId}/merge`, {
        data: { summary: '评测旅程播种' },
        timeout: 10_000
      });

      // 1. 粘贴导入两章半成品
      await page.goto(`/dashboard/worlds/${worldId}/manuscript`);
      await page.getByRole('button', { name: /新建\/导入作品/ }).click();
      await page.getByLabel('作品名').fill('E2E 作品');
      await page
        .getByLabel(/章节正文/)
        .fill(
          '第一章 残卷\n云隐子在枯井底拾得半卷残书。\n---\n第二章 入梦\n向顶天按图索骥，一夜入梦界。'
        );
      await page.getByRole('button', { name: '创建' }).click();

      // 2. 作品与章节切片可见
      await expect(page.getByText('E2E 作品').first()).toBeVisible();
      await expect(page.getByText('第一章 残卷').first()).toBeVisible();
      await expect(page.getByText('第二章 入梦').first()).toBeVisible();

      // 3. 评测平台：为该世界添加检索用例并跑分
      await page.goto('/dashboard/evals');
      await page.selectOption('select#eval-world', worldId);
      await page.getByLabel('查询').fill('向顶天');
      await page.selectOption('select#case-target', { label: '条目 · 向顶天' });
      await page.getByRole('button', { name: '添加用例' }).click();
      await expect(page.getByText('评测用例已添加')).toBeVisible();

      await page.getByRole('button', { name: /运行检索评测/ }).click();
      // 命中率 100% 或至少出现跑分结果区块
      await expect(page.getByText(/命中率/).first()).toBeVisible();
      await expect(page.getByText(/命中 #1/).first()).toBeVisible();
    } finally {
      if (worldId) await api.delete(`/api/worlds/${worldId}`, { timeout: 10_000 });
      await api.dispose();
    }
  });
});
