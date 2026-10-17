import { expect, test } from '@playwright/test';

import { latestAuthLink, login, openNav } from './helpers';

test.describe.configure({ mode: 'serial' });

test('owner invites an HR admin, who accepts and sees only permitted menus', async ({
  page,
  browser,
  isMobile,
}) => {
  test.skip(isMobile, 'invite flow runs once (desktop)');
  const email = `hr-${Date.now()}@dev.local`;

  // Owner invites
  await login(page, 'owner@dev.local');
  await page.goto('/settings/users');
  await page.getByRole('button', { name: 'Invite user' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('checkbox', { name: 'HR admin' }).click();
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByTestId(`user-row-${email}`)).toContainText('invited');

  // HR admin accepts from the email (fresh browser, no owner session)
  const link = await latestAuthLink(email);
  const hrContext = await browser.newContext();
  const hr = await hrContext.newPage();
  await hr.goto(link);
  await expect(hr.getByText('Welcome! Set your password')).toBeVisible();
  await hr.getByLabel('New password').fill('HrAdmin12345');
  await hr.getByLabel('Confirm password').fill('HrAdmin12345');
  await hr.getByRole('button', { name: 'Set password and continue' }).click();
  await expect(hr.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // Menus follow permissions: Settings yes, Payroll no
  await expect(hr.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(hr.getByText('Payroll', { exact: true })).toHaveCount(0);
  await hrContext.close();

  // The owner now sees them as active
  await page.reload();
  await expect(page.getByTestId(`user-row-${email}`)).toContainText('active');
});

test('an employee does not see admin menus and is blocked from admin pages', async ({
  page,
  isMobile,
}) => {
  await login(page, 'employee@dev.local');
  await openNav(page, isMobile);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await page.goto('/settings/users');
  await expect(page.getByTestId('forbidden')).toBeVisible();
});

test('audit log shows the invite to an owner', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await login(page, 'owner@dev.local');
  await page.goto('/settings/audit');
  await expect(page.getByRole('cell', { name: 'invite' }).first()).toBeVisible();
});

test('sign out returns to login', async ({ page }) => {
  await login(page, 'manager@dev.local');
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
});
