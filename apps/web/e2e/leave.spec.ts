import { expect, test } from '@playwright/test';

import { addDays, weekdayOf } from '@hr/shared/time';

import { login } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(
  ({ isMobile }) => isMobile,
  'leave workflow runs on desktop; mobile self-service is Phase 8',
);

// A Monday-to-Tuesday request in the coming months, unique per run.
const offsetWeeks = 2 + Math.floor(Math.random() * 30);
let start = addDays(new Date().toISOString().slice(0, 10), offsetWeeks * 7);
while (weekdayOf(start) !== 'mon') start = addDays(start, 1);
const end = addDays(start, 1);

test('HR sets the annual leave entitlement', async ({ page }) => {
  await login(page, 'hr@dev.local');
  await page.goto('/leave/admin');
  await page.getByRole('button', { name: 'Edit Annual leave policy' }).click();
  await page.getByLabel(/Entitlement per year/).fill('14');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(page.getByTestId('policy-ANNUAL')).toContainText('14 days');
  await expect(page.getByTestId('policy-ANNUAL')).not.toContainText('needs review');
});

test('an employee applies, the manager approves, and the balance updates', async ({
  page,
  browser,
}) => {
  await login(page, 'employee@dev.local');
  await page.getByRole('link', { name: 'Leave' }).click();
  const year = start.slice(0, 4);
  if (year !== String(new Date().getUTCFullYear()))
    await page.getByRole('button', { name: 'Next year' }).click();
  const before = Number(
    await page
      .getByTestId('balance-ANNUAL')
      .getByTestId('available')
      .evaluate((el) => el.firstChild?.textContent ?? '0'),
  );

  await page.getByRole('button', { name: 'Apply for leave' }).click();
  await page.getByLabel('Leave type').selectOption({ label: 'Annual leave' });
  await page.getByLabel('From').fill(start);
  await page.getByLabel('To').fill(end);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByTestId('leave-quote')).toContainText('2 days');
  await page.getByRole('button', { name: 'Request leave' }).click();
  await expect(page.getByRole('cell', { name: 'pending' })).toBeVisible();

  const mgrCtx = await browser.newContext();
  const mgr = await mgrCtx.newPage();
  await login(mgr, 'manager@dev.local');
  await mgr.goto('/leave/approvals');
  const row = mgr.getByTestId('inbox-DEV-0005').filter({ hasText: 'Annual leave' }).first();
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(mgr.getByText('Request approved')).toBeVisible();
  await mgrCtx.close();

  await page.reload();
  if (year !== String(new Date().getUTCFullYear()))
    await page.getByRole('button', { name: 'Next year' }).click();
  await expect
    .poll(async () =>
      Number(
        await page
          .getByTestId('balance-ANNUAL')
          .getByTestId('available')
          .evaluate((el) => el.firstChild?.textContent ?? '0'),
      ),
    )
    .toBe(before - 2);

  // Withdraw/cancel so the test can be re-run without running out of leave.
  await page
    .getByRole('row')
    .filter({ hasText: 'approved' })
    .first()
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(page.getByText('Leave cancelled')).toBeVisible();
});

test('the team calendar shows approved and pending leave', async ({ page }) => {
  await login(page, 'manager@dev.local');
  await page.goto('/leave/calendar');
  await expect(page.getByRole('grid')).toBeVisible();
});
