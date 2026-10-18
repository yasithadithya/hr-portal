import { expect, test } from '@playwright/test';

import { login, openNav } from './helpers';

test('HR sees the company dashboard', async ({ page }) => {
  await login(page, 'hr@dev.local');
  await expect(page.getByText('Whole company')).toBeVisible();
  await expect(page.getByTestId('stat-headcount')).toContainText(/\d+/);
  await expect(page.getByTestId('attendance-today')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Headcount by department' })).toBeVisible();
});

test('a manager’s dashboard covers their team only', async ({ page }) => {
  await login(page, 'manager@dev.local');
  await expect(page.getByText('Your team')).toBeVisible();
});

test('reports: run the employee master and download Excel', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the report builder is a desktop tool');
  await login(page, 'hr@dev.local');
  await openNav(page, isMobile);
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByTestId('report-count')).toContainText(/\d+ row/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel' }).click();
  expect((await download).suggestedFilename()).toMatch(/employee-master.*\.xlsx$/);
});
