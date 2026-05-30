import { useCallback, useState, type RefObject } from "react";
import { captureElementToPngDownload } from "./sessionScreenshot.js";

export function useSessionScreenshot(messagesRef: RefObject<HTMLDivElement | null>) {
  const [screenshotting, setScreenshotting] = useState(false);

  const captureSession = useCallback(async () => {
    const el = messagesRef.current;
    if (!el || screenshotting) return;
    setScreenshotting(true);
    try {
      await captureElementToPngDownload(el);
    } catch (err) {
      console.error("Screenshot failed:", err);
    } finally {
      setScreenshotting(false);
    }
  }, [messagesRef, screenshotting]);

  return { screenshotting, captureSession };
}
