import type {Frame, Locator, Page} from 'playwright';

/** Use ordinary pointer or keyboard interaction for native and ARIA dropdowns. */
export async function selectBrowserOption(page: Page | Frame, locator: Locator, value: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  const options = await locator.evaluate(el => el instanceof HTMLSelectElement
    ? [...el.options].map(o => ({value:o.value, label:o.label})) : null, undefined, {timeout:remaining()});
  if (options) {
    const option = options.find(o => o.value === value) ?? options.find(o => o.label === value);
    if (!option) throw new Error('Option not found. Available labels: ' + options.map(o => o.label).join(', '));
    await locator.selectOption(option.value, {timeout:remaining()});
    return;
  }
  const editable = await locator.evaluate(el => el instanceof HTMLInputElement && !el.readOnly || (el as HTMLElement).isContentEditable, undefined, {timeout:remaining()});
  if (editable) await locator.fill(value, {timeout:remaining()});
  else {
    try {
      await locator.click({trial:true, timeout:Math.min(1000, remaining())});
      await locator.click({timeout:remaining()});
    } catch (error) {
      // Floating labels can cover a usable combobox. Its normal keyboard UI
      // remains available; hidden or disabled controls must still fail.
      if (await locator.getAttribute('role') !== 'combobox' || !await locator.isVisible() || !await locator.isEnabled() || Date.now() >= deadline) throw error;
      await locator.focus({timeout:remaining()});
      await locator.press('ArrowDown', {timeout:remaining()});
    }
  }
  const controls = (await locator.getAttribute('aria-controls') ?? await locator.getAttribute('aria-owns'))?.trim().split(/\s+/)[0];
  const scope = controls ? page.locator(`[id=${JSON.stringify(controls)}]`) : page;
  const byValue = scope.locator(`[role="option"][data-value=${JSON.stringify(value)}]:visible`).first();
  const option = await byValue.isVisible() ? byValue : scope.getByRole('option', {name:value, exact:true}).first();
  await option.click({timeout:remaining()});
}
