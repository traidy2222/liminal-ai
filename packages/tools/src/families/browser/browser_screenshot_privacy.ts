/** Screenshot-only text redaction respects occlusion. Rectangle masks over
 * password inputs behind a modal would paint over the modal's own contents. */
export const browserScreenshotPrivacyStyle=`
* { caret-color:transparent!important; }
input:is([type="password"],[autocomplete="current-password"],[autocomplete="new-password"],[name*="password" i]) {
 color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;
}
input:is([type="password"],[autocomplete="current-password"],[autocomplete="new-password"],[name*="password" i])::selection {
 background:transparent!important;color:transparent!important;-webkit-text-fill-color:transparent!important;
}`;
