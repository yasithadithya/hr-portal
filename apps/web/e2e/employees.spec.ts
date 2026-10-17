import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { login } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'HR workflows run on desktop');

const stamp = Date.now().toString(36).toUpperCase();
// Unique per run (NICs are unique per workspace): born 1992, day 145 → 24 May, male.
const nic = `1992145${String(Math.floor(Math.random() * 100_000)).padStart(5, '0')}`;

test('HR hires an employee using the NIC suggestion, then records a transfer', async ({ page }) => {
  await login(page, 'hr@dev.local');
  await page.goto('/employees/new');
  await page.getByLabel('First name').fill(`Nimal${stamp}`);
  await page.getByLabel('Last name').fill('Perera');
  await page.getByLabel('NIC').fill(nic);
  await page.getByRole('button', { name: 'Use this' }).click();
  await expect(page.getByLabel('Date of birth')).toHaveValue('1992-05-24');
  await page.getByLabel('Join date').fill('2025-01-06');
  await page.getByRole('button', { name: 'Add employee' }).click();

  await expect(
    page.getByRole('heading', { name: new RegExp(`Nimal${stamp} Perera`) }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Job' }).click();
  await page.getByRole('button', { name: 'Job change' }).click();
  await page.getByLabel('Effective from').fill('2026-01-01');
  await page.getByLabel('Reason').selectOption('promotion');
  await page.getByLabel('Notes').fill('Annual review');
  await page.getByRole('button', { name: 'Save' }).click();
  const history = page.getByRole('list', { name: 'Job history' });
  await expect(history.getByText('2025-01-06 → 2025-12-31')).toBeVisible();
  await expect(history.getByText('promotion')).toBeVisible();

  await page.getByRole('tab', { name: 'Documents' }).click();
  await page.getByRole('button', { name: 'Upload' }).click();
  const file = path.join(os.tmpdir(), `nic-${stamp}.pdf`);
  writeFileSync(file, '%PDF-1.4\n% test document\n');
  await page.getByLabel(/^File/).setInputFiles(file);
  await page.getByLabel('Title').fill('NIC copy');
  await page.getByRole('button', { name: 'Upload', exact: true }).last().click();
  await expect(page.getByRole('cell', { name: 'NIC copy', exact: true })).toBeVisible();
});

test('HR imports employees from CSV with a preview of row errors', async ({ page }) => {
  await login(page, 'hr@dev.local');
  await page.goto('/employees/import');
  const csv = [
    'Employee No,First Name,Surname,Date Joined,Manager',
    `I${stamp}-1,Asha,Fernando,2024-02-01,`,
    `I${stamp}-2,Ravi,Kumar,2024-02-30,I${stamp}-1`,
    `I${stamp}-3,Dilini${stamp},Silva,2024-03-01,I${stamp}-1`,
  ].join('\n');
  const file = path.join(os.tmpdir(), `import-${stamp}.csv`);
  writeFileSync(file, csv);
  await page.getByLabel('Import file').setInputFiles(file);
  // Headers are auto-matched (Surname → Last name, Date Joined → Join date, Manager → Reports to).
  await expect(page.getByLabel('Field for column Surname')).toHaveValue('lastName');
  await page.getByRole('button', { name: 'Check rows' }).click();
  const preview = page.getByTestId('import-preview');
  await expect(preview).toContainText('2 ready');
  await expect(preview).toContainText('1 with errors');
  await expect(page.getByRole('button', { name: 'Import 2 rows' })).toBeDisabled();
  await page.getByLabel('Skip rows with errors').click();
  await page.getByRole('button', { name: 'Import 2 rows' }).click();
  await expect(page.getByTestId('import-report')).toContainText('Imported 2 of 3 rows');

  await page.goto('/employees');
  await page.getByLabel('Search employees').fill(`I${stamp}`);
  await page.getByLabel('Search employees').press('Enter');
  await expect(page.getByRole('link', { name: `Dilini${stamp} Silva` })).toBeVisible();
});

test('a manager sees only their team, with work details only', async ({ page }) => {
  await login(page, 'manager@dev.local');
  await page.getByRole('link', { name: 'Employees' }).click();
  await expect(page.getByRole('link', { name: 'Esha Jayasuriya' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kasun Bandara' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Esha Jayasuriya' }).click();
  await expect(page.getByRole('tab', { name: 'Job' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Personal' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Bank & statutory' })).toHaveCount(0);
});
