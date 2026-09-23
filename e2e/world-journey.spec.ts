import { expect, request as playwrightRequest, test } from '@playwright/test';

/**
 * D-3 核心用户旅程（真实浏览器）：
 * 建世界 → 提交设定条目 → 审阅合并 → 条目入正史 → 全路由渲染 → 评测页联动 → 删除世界。
 *
 * 每次运行使用唯一世界名，结束时通过 UI 删除；失败时在同一测试生命周期内兜底清理。
 */

const WORLD_NAME = `E2E 世界 ${Date.now()}`;
const ENTITY_NAME = '自动化角色';
const PLACE_NAME = '自动化地点';

test.describe.serial('世界生命周期（UI 端到端）', () => {
  test('create → submit → review merge → render → delete', async ({ page }) => {
    let worldId: string | null = null;
    let deleted = false;

    try {
      // 1. 世界总览
      await page.goto('/dashboard/overview');
      await expect(page.getByRole('heading', { name: '世界总览' })).toBeVisible();

      // 2. 新建世界
      await page.getByRole('button', { name: /新建世界/ }).click();
      await page.getByLabel('名称').fill(WORLD_NAME);
      await page.getByLabel('一句话前提').fill('端到端自动化验证用世界');
      await page.getByRole('button', { name: '创建' }).click();

      const card = page.getByLabel(`打开世界 ${WORLD_NAME}`);
      await expect(card).toBeVisible();

      // 3. 进入世界工作台（/worlds/:id 重定向到 /entities）
      await card.click();
      await page.waitForURL(/\/entities$/);
      worldId = new URL(page.url()).pathname.split('/')[3] ?? null;
      const worldPath = `/dashboard/worlds/${worldId}`;
      await expect(page.getByText(WORLD_NAME).first()).toBeVisible();

      // 4. 提交两条设定条目（走变更审阅链；一并验证多变更合并）
      for (const [name, kind] of [
        [ENTITY_NAME, 'character'],
        [PLACE_NAME, 'location']
      ] as const) {
        await page.getByRole('button', { name: /新建条目/ }).click();
        await page.getByLabel('名称').fill(name);
        await page.getByLabel('类型').fill(kind);
        await page.getByLabel('摘要').fill('由 Playwright E2E 提交');
        await page.getByRole('button', { name: '提交审阅' }).click();
        await expect(page.getByText('已提交审阅').first()).toBeVisible();
      }

      // 5. 侧边栏导航到审阅并合并
      await page.getByRole('link', { name: '审阅' }).first().click();
      await page.waitForURL(/\/review$/);
      await page.getByRole('button', { name: /合并全部/ }).click();
      await expect(page.getByText(/已合并为 v/).first()).toBeVisible();

      // 6. 两条条目都进入正史（合并后列表必须立即刷新——onSettled 失效回归点）
      await page.getByRole('link', { name: '设定条目' }).first().click();
      await page.waitForURL(/\/entities$/);
      await expect(page.getByText(ENTITY_NAME).first()).toBeVisible();
      await expect(page.getByText(PLACE_NAME).first()).toBeVisible();

      // 7. 世界级路由逐个渲染（200 且非错误/不存在页面）
      const routes = [
        'timeline',
        'graph',
        'lint',
        'versions',
        'ops',
        'manuscript',
        'assistant',
        'genesis',
        'sources',
        'story',
        'entities',
        'events',
        'review'
      ];
      for (const route of routes) {
        const response = await page.goto(`${worldPath}/${route}`);
        expect(response?.status(), `${route} 状态码`).toBe(200);
        const body = page.locator('body');
        await expect(body, `${route} 页面`).not.toContainText('Application error');
        await expect(body, `${route} 内容`).not.toContainText('条目不存在');
        await expect(body, `${route} 内容`).not.toContainText('世界不存在');
      }

      // 8. 图谱实际渲染出 Reagraph 画布
      await page.goto(`${worldPath}/graph`);
      await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 });

      // 9. 评测页能选中该世界
      await page.goto('/dashboard/evals');
      await expect(page.locator('select#eval-world')).toContainText(WORLD_NAME);

      // 10. 回到总览删除世界（UI 确认弹窗）
      await page.goto('/dashboard/overview');
      await page.getByLabel(`删除世界 ${WORLD_NAME}`).click();
      await page.getByRole('button', { name: /确认|Continue|删除/ }).click();
      await expect(page.getByLabel(`打开世界 ${WORLD_NAME}`)).toHaveCount(0);
      deleted = true;
    } finally {
      // Cleanup stays inside the test lifecycle and can never mask the assertion failure.
      if (worldId && !deleted) {
        const api = await playwrightRequest.newContext({
          baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4310'
        });
        try {
          await api.delete(`/api/worlds/${worldId}`, { timeout: 10_000 });
        } catch {
          // Cleanup must never mask the original browser assertion.
        } finally {
          await api.dispose();
        }
      }
    }
  });
});
