import { expect, test } from '@playwright/test';

import { login } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'payroll admin screens are checked on desktop');

// A far-future month that is unique per run (a month can be opened only once).
const year = 2050 + Math.floor(Math.random() * 40);
const month = `${year}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}`;

test('owner lets payroll run without locked attendance (sample setup)', async ({ page }) => {
  await login(page, 'owner@dev.local');
  await page.goto('/payroll/settings');
  await expect(page.getByText('Sample payroll data')).toBeVisible();
  await page.getByRole('tab', { name: 'General' }).click();
  const toggle = page.getByRole('switch', { name: 'Use only locked attendance' });
  if ((await toggle.getAttribute('aria-checked')) === 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('payroll admin sets pay, opens a month and calculates', async ({ page }) => {
  await login(page, 'payroll@dev.local');
  await page.getByRole('link', { name: 'Payroll' }).click();
  await page.getByRole('link', { name: 'Employee pay' }).click();
  const row = page.getByTestId('pay-DEV-0005');
  await expect(row).toBeVisible();
  if (await row.getByText('Not set').isVisible()) {
    await row.getByRole('link').click();
    // The form defaults to today: after the join date and before the far-future test month.
    await page.getByLabel('Basic salary (LKR / month)').fill('150000');
    await page.getByRole('button', { name: 'Save salary' }).click();
    await expect(page.getByTestId('salary-history')).toContainText('150,000.00');
    await page.goto('/payroll');
  } else {
    await page.getByRole('link', { name: 'Runs' }).click();
  }

  await page.getByRole('button', { name: 'Open month' }).click();
  await page.getByLabel('Month', { exact: true }).fill(month);
  await page.getByRole('button', { name: 'Open month' }).last().click();
  await expect(page.getByRole('heading', { name: /^Payroll · / })).toBeVisible();
  await expect(page.getByTestId('readiness')).toContainText('SAMPLE values');

  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByText('Payroll calculated')).toBeVisible();
  const slip = page.getByTestId('slip-DEV-0005');
  await expect(slip).toBeVisible();
  await slip.click();
  await expect(page.getByText('Why is this number?')).toBeVisible();
  await expect(page.getByTestId('payslip-net')).toHaveText(/\d/);
  await page.keyboard.press('Escape');
  // Maker-checker: the preparer cannot approve their own run.
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
});

test('owner approves and locks; the employee sees the payslip', async ({ page, browser }) => {
  await login(page, 'owner@dev.local');
  await page.goto('/payroll');
  await page.getByTestId(`run-${month}-regular`).getByRole('link').click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Payroll approved')).toBeVisible();
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByText('Payroll locked')).toBeVisible();

  const ctx = await browser.newContext();
  const emp = await ctx.newPage();
  await login(emp, 'employee@dev.local');
  await emp.getByRole('link', { name: 'My payslips' }).click();
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });
  await emp.getByRole('button', { name: new RegExp(label) }).click();
  await expect(emp.getByTestId('my-net')).toHaveText(/\d/);
  await ctx.close();
});
