import { expect, test } from '@playwright/test';

test('desktop sidebar shows only working product destinations', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/dashboard/overview');

  await expect(page.getByRole('button', { name: 'Account' })).toHaveCount(0);
  await expect(page.getByText('Sign in to manage your account')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '世界列表' })).toBeVisible();
  await page.getByRole('link', { name: '技能库' }).click();
  await expect(page).toHaveURL(/\/dashboard\/skills$/);
  await expect(page.getByText('出了点问题')).toHaveCount(0);
});

test('phone sidebar has no placeholder account or notification menu', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto('/dashboard/overview');
  await page.locator('[data-sidebar=trigger]').click();

  await expect(page.getByRole('link', { name: '世界列表' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account' })).toHaveCount(0);
  await expect(page.getByText('Sign in to manage your account')).toHaveCount(0);
  await page.getByRole('link', { name: '技能库' }).click();
  await expect(page).toHaveURL(/\/dashboard\/skills$/);
});
