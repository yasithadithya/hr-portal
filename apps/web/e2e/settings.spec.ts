import { expect, test } from '@playwright/test';

import { login } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'admin configuration runs on desktop');

const stamp = Date.now().toString(36).toUpperCase();

test('HR adds a department hierarchy', async ({ page }) => {
  await login(page, 'hr@dev.local');
  await page.goto('/settings/organisation');
  for (const [code, parent] of [
    [`OPS${stamp}`, null],
    [`FIN${stamp}`, `OPS${stamp}`],
  ] as const) {
    await page.getByRole('button', { name: 'Add department' }).click();
    await page.getByLabel('Code').fill(code);
    await page.getByLabel('Name', { exact: true }).fill(`Dept ${code}`);
    if (parent)
      await page
        .getByLabel('Parent department')
        .selectOption({ label: `${parent} · Dept ${parent}` });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: code, exact: true })).toBeVisible();
  }
  const tree = page.getByRole('list', { name: 'Department tree' });
  await expect(tree.getByText(`Dept FIN${stamp}`)).toBeVisible();
});

test('HR imports holidays with a CSV preview and sees working days update', async ({ page }) => {
  await login(page, 'hr@dev.local');
  await page.goto('/settings/calendars');
  await page.getByRole('button', { name: 'Next year' }).click();
  await page.getByRole('button', { name: 'Next year' }).click();
  const year = Number(await page.getByTestId('holiday-year').textContent());

  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page
    .getByLabel('CSV content')
    .fill(`date,name,type\n${year}-05-01,May Day ${stamp},public\n${year}-13-40,Broken,public\n`);
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(page.getByTestId('import-preview')).toContainText('1 valid row');
  await expect(page.getByTestId('import-preview')).toContainText('Line 3');
  await expect(page.getByRole('button', { name: /^Import/ })).toBeDisabled();

  await page
    .getByLabel('CSV content')
    .fill(`date,name,type\n${year}-05-01,May Day ${stamp},public\n`);
  await page.getByRole('button', { name: 'Check file' }).click();
  await page.getByRole('button', { name: 'Import 1' }).click();
  await expect(page.getByRole('cell', { name: `May Day ${stamp}`, exact: true })).toBeVisible();
  await expect(page.getByText(/not yet verified/)).toBeVisible();
});

test('owner sets a brand colour and it applies across the app', async ({ page }) => {
  // Random each run so a leftover value from an earlier run can't mask the change.
  const colour = `#${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')}`;
  await login(page, 'owner@dev.local');
  await page.goto('/settings/preferences');
  await page.locator('#brand-color').fill(colour);
  await page.getByRole('button', { name: 'Save colour' }).click();
  await expect(page.getByText('Setting saved')).toBeVisible();
  await page.goto('/');
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
      ),
    )
    .toBe(colour);
  // Reset for other tests
  await page.goto('/settings/preferences');
  await page.getByRole('button', { name: 'Reset' }).click();
});
