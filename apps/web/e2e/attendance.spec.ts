import { expect, test } from '@playwright/test';

import { login, openNav } from './helpers';

test.describe.configure({ mode: 'serial' });

test('HR creates a shift and assigns it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'admin screens are checked on desktop');
  const code = `E2E${Date.now().toString(36).slice(-5).toUpperCase()}`;
  await login(page, 'hr@dev.local');
  await page.goto('/attendance/shifts');
  await expect(page.getByTestId('shift-GENERAL')).toContainText('Review');

  await page.getByRole('button', { name: 'New shift' }).click();
  await page.getByLabel('Code', { exact: true }).fill(code);
  await page.getByLabel('Name', { exact: true }).fill('E2E day');
  await page.getByLabel('Starts', { exact: true }).fill('00:00');
  await page.getByLabel('Ends', { exact: true }).fill('23:00');
  await page.getByLabel('Punch window before start (min)').fill('0');
  await page.getByLabel('Punch window after end (min)').fill('60');
  await page.getByRole('button', { name: 'Save shift' }).click();
  await expect(page.getByTestId(`shift-${code}`)).toBeVisible();

  await page.getByRole('button', { name: 'Assign shift' }).click();
  await page.getByLabel('Shift', { exact: true }).selectOption({ label: `${code} · 00:00–23:00` });
  await page.getByLabel('Esha Jayasuriya').check();
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByText('Shift assigned to 1 employee(s)')).toBeVisible();
  await expect(page.getByTestId(`shift-${code}`)).toContainText('1');
});

test('an employee clocks in and the manager sees it on the board', async ({
  page,
  browser,
  isMobile,
}) => {
  test.skip(isMobile, 'one clocking flow per run (the double-tap guard is per employee)');
  await login(page, 'employee@dev.local');
  await page.getByRole('link', { name: 'Attendance' }).click();
  const button = page.getByTestId('clock-button');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByTestId('clock-accepted')).toBeVisible();

  const mgrCtx = await browser.newContext();
  const mgr = await mgrCtx.newPage();
  await login(mgr, 'manager@dev.local');
  await mgr.goto('/attendance/board');
  const row = mgr.getByTestId('board-DEV-0005');
  await expect(row).toBeVisible();
  await expect(row.getByRole('cell').nth(3)).toHaveText(/\d{2}:\d{2}/);
  await mgrCtx.close();
});

test('HR sees the monthly summary', async ({ page, isMobile }) => {
  test.skip(isMobile, 'admin screens are checked on desktop');
  await login(page, 'hr@dev.local');
  await page.goto('/attendance/monthly');
  await expect(page.getByTestId('period-status')).toBeVisible();
  await expect(page.getByTestId('summary-DEV-0005')).toBeVisible();
});

test('the clock button works on a phone layout', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile only');
  await login(page, 'employee2@dev.local');
  await openNav(page, isMobile);
  await page.getByRole('link', { name: 'Attendance' }).click();
  await expect(page.getByTestId('clock-button')).toBeVisible();
});
