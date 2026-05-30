import { expect, Page } from '@playwright/test';

/**
 * Click a Radix Select trigger by its visible label, then pick an option
 * from the open portaled listbox.
 *
 * Empirical (2026-05-30 on validate/all-themes): this codebase's Radix
 * renders `[role="listbox"][data-state="open"]` when open, NOT
 * `[data-radix-select-content][data-state="open"]`. Listbox detection
 * uses role + data-state.
 *
 * `optionText` can be:
 *  - a string  → exact name match
 *  - a RegExp  → matches first option whose name matches
 *  - `null`    → picks the first option (useful when "pick anything" is fine)
 */
export async function selectRadixOption(
  page: Page,
  labelText: string | RegExp,
  optionText: string | RegExp | null,
  index = 0,
): Promise<void> {
  const trigger = page.getByRole('combobox').filter({ hasText: labelText }).nth(index);
  await expect(trigger).toBeVisible();
  await trigger.click();

  const listbox = page.locator('[role="listbox"][data-state="open"]').last();
  await expect(listbox).toBeVisible();

  let option;
  if (optionText === null) {
    option = listbox.getByRole('option').first();
  } else if (typeof optionText === 'string') {
    option = listbox.getByRole('option', { name: optionText, exact: true });
  } else {
    option = listbox.getByRole('option', { name: optionText }).first();
  }

  await option.click();
  await expect(listbox).toBeHidden();
}
