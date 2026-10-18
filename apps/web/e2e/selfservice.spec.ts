import { expect, test, type Page } from '@playwright/test';

import { addDays, weekdayOf } from '@hr/shared/time';

import { login, openNav } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => !isMobile, 'Phase 8 self-service is checked on a phone viewport');

// A random Wednesday–Friday next year: unique enough per run, and never on the Monday–Tuesday
// requests the leave spec makes for the same employee.
const nextYear = new Date().getUTCFullYear() + 1;
let day = addDays(`${nextYear}-01-06`, Math.floor(Math.random() * 46) * 7);
const target = (['wed', 'thu', 'fri'] as const)[Math.floor(Math.random() * 3)];
while (weekdayOf(day) !== target) day = addDays(day, 1);
const year = day.slice(0, 4);
/** NOPAY taken before this run's request (tests in this file run in order, one worker). */
let before = 0;

async function nopayTaken(page: Page) {
  await page.goto('/leave');
  if (year !== String(new Date().getUTCFullYear()))
    await page.getByRole('button', { name: 'Next year' }).click();
  const card = page.getByTestId('balance-NOPAY');
  await expect(card).toBeVisible();
  const text = (await card.textContent()) ?? '';
  const m = /(\d+(?:\.\d+)?)\s*(?:days?|h)?\s*taken/i.exec(text);
  return m ? Number(m[1]) : 0;
}

test('employee home works on a phone and applies for leave', async ({ page, isMobile }) => {
  await login(page, 'employee@dev.local');
  await openNav(page, isMobile);
  await page.getByRole('link', { name: 'My HR' }).click();
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Payslips' })).toBeVisible();

  before = await nopayTaken(page);
  await page.getByRole('button', { name: 'Apply for leave' }).click();
  await page.getByLabel('Leave type').selectOption({ label: 'No-pay leave' });
  await page.getByLabel('From').fill(day);
  await page.getByLabel('To').fill(day);
  await page.getByRole('button', { name: 'Request leave' }).click();
  await expect(page.getByRole('cell', { name: 'pending' }).first()).toBeVisible();
});

test('manager is notified, follows the link and approves; the employee sees the result', async ({
  page,
  browser,
  isMobile,
}) => {
  const mgrCtx = await browser.newContext({ ...test.info().project.use });
  const mgr = await mgrCtx.newPage();
  await login(mgr, 'manager@dev.local');
  const bell = mgr.getByTestId('notification-bell');
  await expect(mgr.getByTestId('notification-count')).toBeVisible({ timeout: 30_000 });
  await bell.click();
  await mgr
    .getByTestId('notification-item')
    .filter({ hasText: 'requested no-pay leave' })
    .first()
    .click();
  await expect(mgr).toHaveURL(/\/approvals$/);
  const card = mgr.getByTestId('approval-leave-DEV-0005').first();
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(mgr.getByText('Request approved')).toBeVisible();
  await mgrCtx.close();

  await login(page, 'employee@dev.local');
  await expect(page.getByTestId('notification-count')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('notification-bell').click();
  await expect(
    page.getByTestId('notification-item').filter({ hasText: 'was approved' }).first(),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await openNav(page, isMobile);
  const after = await nopayTaken(page);
  expect(after).toBe(before + 1);
});

test('the clock button explains it needs a connection when offline', async ({ page, context }) => {
  await login(page, 'employee2@dev.local');
  await page.goto('/me');
  await expect(page.getByTestId('clock-button')).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByTestId('clock-offline')).toBeVisible();
  await expect(page.getByTestId('clock-button')).toBeDisabled();
  await context.setOffline(false);
});
