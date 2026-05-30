import { toPng } from "html-to-image";

/** Full-scroll capture of a messages container → downloaded PNG. */
export async function captureElementToPngDownload(
  el: HTMLElement,
  opts?: { backgroundColor?: string; filenamePrefix?: string }
): Promise<void> {
  const fullHeight = el.scrollHeight;
  const width = el.offsetWidth;
  const savedOverflowY = el.style.overflowY;
  const savedHeight = el.style.height;
  const savedMaxHeight = el.style.maxHeight;
  const savedFlex = el.style.flex;
  el.style.overflowY = "visible";
  el.style.height = `${fullHeight}px`;
  el.style.maxHeight = "none";
  el.style.flex = "none";
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  try {
    const dataUrl = await toPng(el, {
      pixelRatio: 2,
      backgroundColor: opts?.backgroundColor ?? "#020408",
      width,
      height: fullHeight,
    });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -1);
    const prefix = opts?.filenamePrefix ?? "liminal";
    const link = document.createElement("a");
    link.download = `${prefix}-${ts}.png`;
    link.href = dataUrl;
    link.click();
  } finally {
    el.style.overflowY = savedOverflowY;
    el.style.height = savedHeight;
    el.style.maxHeight = savedMaxHeight;
    el.style.flex = savedFlex;
  }
}
