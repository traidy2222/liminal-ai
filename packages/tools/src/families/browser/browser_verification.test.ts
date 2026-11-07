import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { inspectBrowserVerification } from "../../../dist/families/browser/browser_verification.js";
import { detectCaptchaSignals, formatCaptchaHint } from "../../../dist/families/browser/browser_runtime.js";

test("signup background scripts and badges do not become blocking CAPTCHA claims", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ body: "", contentType: "text/html" }));
    const inspect = async (html: string) => {
      await page.setContent(html);
      return page.evaluate(inspectBrowserVerification);
    };
    assert.equal(await inspect('<label>Birthday<input></label>'), null);
    const background = await inspect('<script src="https://www.google.com/recaptcha/api.js"></script><label>Birthday<input></label>');
    assert.equal(background?.presentation, "background");
    const signal = await detectCaptchaSignals(page);
    assert.ok(signal);
    assert.match(formatCaptchaHint(signal), /no visible challenge observed/);
    assert.doesNotMatch(formatCaptchaHint(signal), /captcha_solve|CAPTCHA DETECTED/);
    assert.equal((await inspect('<iframe hidden src="https://www.google.com/recaptcha/api2/bframe"></iframe>'))?.presentation, "background");
    assert.equal((await inspect('<div style="opacity:0"><iframe src="https://www.google.com/recaptcha/api2/bframe"></iframe></div>'))?.presentation, "background");
    assert.equal((await inspect('<div class="grecaptcha-badge"><iframe src="https://www.google.com/recaptcha/api2/anchor?size=invisible"></iframe></div>'))?.presentation, "background");
    assert.equal((await inspect('<iframe src="https://www.google.com/recaptcha/api2/anchor?size=normal"></iframe>'))?.presentation, "visible_widget");
    assert.equal((await inspect('<script src="https://www.google.com/recaptcha/api.js"></script><iframe src="https://hcaptcha.com/challenge"></iframe>'))?.type, "hcaptcha");
    const visible = await detectCaptchaSignals(page);
    assert.ok(visible);
    assert.match(formatCaptchaHint(visible), /visible hcaptcha widget/);
    assert.doesNotMatch(formatCaptchaHint(visible), /Call captcha_solve|submit the form/);
    const frameKey=await inspect('<iframe src="https://www.recaptcha.net/recaptcha/api2/anchor?k=fixture-public-widget-key&size=normal"></iframe>');assert.equal(frameKey?.siteKey,'fixture-public-widget-key');assert.equal(frameKey?.presentation,'visible_widget');
    const spoof=await inspect('<iframe src="https://recaptcha.unrelated.test/anchor?k=untrusted-key"></iframe>');assert.equal(spoof?.siteKey,null);
  } finally {
    await browser.close();
  }
});
