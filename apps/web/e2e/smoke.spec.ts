import { expect, test } from '@playwright/test';

test('app shell renders and reaches the API', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByTestId('api-health')).toHaveAttribute('data-state', 'ok');
});

test('theme can be switched to dark', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Change theme' }).click();
  await page.getByRole('menuitem', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('navigation reaches the self-service area', async ({ page, isMobile }) => {
  await page.goto('/');
  if (isMobile) await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'My HR' }).click();
  await expect(page.getByRole('heading', { name: 'My HR' })).toBeVisible();
});
