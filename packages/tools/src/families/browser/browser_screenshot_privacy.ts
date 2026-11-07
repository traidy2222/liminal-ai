/** Keep inputs filled by the credential tool private even when a site toggles
 * their type to text. Recognize common show-password field names as well. */
export const browserPrivateInputMarker = 'data-liminal-private-input';
export const browserPrivateInputSelector = [
 'type="password"', 'autocomplete~="current-password"', 'autocomplete~="new-password"',
 'name*="password" i', 'id*="password" i', 'name="pass" i', 'name="pwd" i',
 'id="pass" i', 'id="pwd" i', 'aria-label*="password" i', browserPrivateInputMarker,
].map(attribute => 'input[' + attribute + ']').join(',');

/** Hide field text without painting over an unrelated covering dialog. */
export const browserScreenshotPrivacyStyle = `
* { caret-color:transparent!important; }
:is(${browserPrivateInputSelector}) {
 color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;
}
:is(${browserPrivateInputSelector})::selection {
 background:transparent!important;color:transparent!important;-webkit-text-fill-color:transparent!important;
}`;
