import { expect, test } from '@playwright/test';

import { login, openNav } from './helpers';

test('signed-out visitors are sent to the workspace login page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId('tenant-name')).toHaveText('Dev Company');
});

test('app shell renders, reaches the API, and switches theme', async ({ page }) => {
  await login(page, 'employee@dev.local');
  await expect(page.getByTestId('api-health')).toHaveAttribute('data-state', 'ok');
  await page.getByRole('button', { name: 'Change theme' }).click();
  await page.getByRole('menuitem', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('navigation reaches the self-service area', async ({ page, isMobile }) => {
  await login(page, 'employee@dev.local');
  await openNav(page, isMobile);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My HR' }).click();
  // The self-service home greets the employee by first name.
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible();
});

test('wrong password shows a clear error', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#email').fill('employee@dev.local');
  await page.locator('#password').fill('nope-nope-nope');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Wrong email or password')).toBeVisible();
});
