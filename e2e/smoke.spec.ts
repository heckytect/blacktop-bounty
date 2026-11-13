import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// M7 smoke (spec §12.1): the static build loads, a match starts and runs, no console errors,
// and the menus pass automated WCAG 2.x A/AA checks.

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const menuTitle = (page: Page) => page.locator('#menu h1');
const clickItem = (page: Page, label: string) => page.locator('#menu .items button', { hasText: label }).first().click();

async function axe(page: Page, screen: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${screen}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('loads, starts a deathmatch, runs, pauses and quits with no console errors', async ({ page }) => {
  // Headless Chrome renders in software: use the Low preset (no post FX) so the flow test isn't GPU-bound.
  await page.addInitScript(() => localStorage.setItem('blacktop.options', JSON.stringify({ graphics: 'low' })));
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(menuTitle(page)).toHaveText('BLACKTOP BOUNTY', { timeout: 30_000 });
  await page.keyboard.press('Enter'); // title → mode menu
  await expect(page.locator('#menu .items button', { hasText: 'Deathmatch' })).toBeVisible();
  await clickItem(page, 'Deathmatch');
  await expect(page.locator('#select')).toBeVisible();
  await page.keyboard.press('Enter'); // pick the first car
  await page.waitForFunction(() => (window as any).__game?.match?.time > 3, null, { timeout: 60_000 });
  const state = await page.evaluate(() => {
    const m = (window as any).__game.match;
    return { cars: m.vehicles.length, playerAlive: m.player.alive, hud: document.getElementById('score')!.textContent };
  });
  expect(state.cars).toBeGreaterThan(1);
  expect(state.hud).toContain('Opponents left');
  await page.keyboard.press('Escape');
  await expect(menuTitle(page)).toHaveText('PAUSED');
  await clickItem(page, 'Quit to menu');
  await expect(menuTitle(page)).toHaveText('BLACKTOP BOUNTY');
  expect(errors).toEqual([]);
});

test('menus are keyboard-operable and pass axe WCAG A/AA checks', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(menuTitle(page)).toHaveText('BLACKTOP BOUNTY', { timeout: 30_000 });
  await axe(page, 'title');
  await page.keyboard.press('Enter');
  await axe(page, 'mode menu');

  // Keyboard only: ↓ to Settings, Enter, Tab stays inside the dialog, Esc backs out.
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('#menu .items button:focus')).toHaveText('Settings');
  await page.keyboard.press('Enter');
  await expect(menuTitle(page)).toHaveText('SETTINGS');
  await axe(page, 'settings');
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('#menu'))).toBe(true); // focus trapped
  await clickItem(page, 'Controls');
  await expect(menuTitle(page)).toHaveText('CONTROLS');
  await axe(page, 'controls');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(menuTitle(page)).toHaveText('BLACKTOP BOUNTY');

  await clickItem(page, 'Campaign');
  await expect(page.locator('#select')).toBeVisible();
  await axe(page, 'vehicle select');
  await page.keyboard.press('Escape');
  await expect(menuTitle(page)).toHaveText('BLACKTOP BOUNTY');
  expect(errors).toEqual([]);
});
