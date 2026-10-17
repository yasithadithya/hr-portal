import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Password123!';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

/** Opens the side nav on small screens so links are clickable. */
export async function openNav(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole('button', { name: 'Open menu' }).click();
}

/** Polls the local Mailpit inbox for the newest email to `to` and returns its first auth link. */
export async function latestAuthLink(to: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=1`,
    );
    const body = (await res.json()) as { messages: { ID: string }[] };
    const id = body.messages[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
        HTML: string;
        Text: string;
      };
      const m = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/.exec(msg.HTML || msg.Text);
      if (m) return m[0].replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No auth email for ${to}`);
}
