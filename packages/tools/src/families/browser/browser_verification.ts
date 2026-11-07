/** Runs in the page. Loading an anti-bot library is not an interactive challenge. */
export function inspectBrowserVerification(): {
  type: "recaptcha_v2" | "recaptcha_v3" | "hcaptcha" | "turnstile";
  siteKey: string | null;
  presentation: "background" | "visible_widget";
} | null {
  const visible = (el: Element): boolean => {
    const bounds = el.getBoundingClientRect();
    if (bounds.width < 20 || bounds.height < 20) return false;
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.matches('[hidden],[inert],[aria-hidden="true"]') ||
          style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const integrations = [
    { type: "turnstile" as const, widget: ".cf-turnstile,[data-cf-turnstile]", frames: 'iframe[src*="challenges.cloudflare.com"]', script: 'script[src*="challenges.cloudflare.com"]' },
    { type: "hcaptcha" as const, widget: ".h-captcha,[data-hcaptcha-sitekey]", frames: 'iframe[src*="hcaptcha.com"]', script: 'script[src*="hcaptcha.com"]' },
    { type: "recaptcha_v2" as const, widget: ".g-recaptcha", frames: 'iframe[src*="recaptcha"]', script: 'script[src*="recaptcha"]' },
  ];
  let background: ReturnType<typeof inspectBrowserVerification> = null;
  for (const integration of integrations) {
    const widgets = [...document.querySelectorAll(integration.widget)];
    const frames = [...document.querySelectorAll<HTMLIFrameElement>(integration.frames)];
    const script = document.querySelector<HTMLScriptElement>(integration.script);
    if (!widgets.length && !frames.length && !script) continue;
    let siteKey = widgets.map(el => el.getAttribute("data-sitekey") || el.getAttribute("data-hcaptcha-sitekey")).find(Boolean) || null;
    if(!siteKey&&integration.type==='recaptcha_v2'){
      for(const frame of frames){
        try{const url=new URL(frame.src,location.href);if(!/(^|\.)(google\.com|recaptcha\.net)$/.test(url.hostname))continue;const key=url.searchParams.get('k');if(key&&/^[A-Za-z0-9_-]{10,200}$/.test(key)){siteKey=key;break;}}catch{/* A malformed frame does not establish a widget key. */}
      }
    }
    // Google's invisible badge is visible, but is not a checkbox/challenge.
    const interactive = frames.some(frame => visible(frame) && !frame.closest('.grecaptcha-badge') &&
      !/[?&]size=invisible(?:&|$)/.test(frame.src));
    if (interactive || widgets.some(el => visible(el) && el.getAttribute("data-size") !== "invisible" &&
        !!el.querySelector('input[type="checkbox"],[role="checkbox"]'))) {
      return { type: integration.type, siteKey, presentation: "visible_widget" };
    }
    const renderKey = script?.src.match(/[?&]render=([A-Za-z0-9_-]{30,})/)?.[1];
    background ??= { type: renderKey ? "recaptcha_v3" : integration.type, siteKey: siteKey || renderKey || null, presentation: "background" };
  }
  return background;
}
