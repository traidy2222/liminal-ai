import { useEffect, useRef } from "react";

/**
 * Auto-scrolls a transcript container to the bottom when `dep` changes — but
 * only while the user is already near the bottom.
 *
 * The naive pattern (`scrollIntoView` in an effect keyed on the messages array)
 * fires on every streaming token and yanks the viewport back down, so the user
 * cannot scroll up to read earlier output mid-stream. This hook tracks whether
 * the user is "pinned" to the end: once they scroll up past `threshold` px,
 * auto-scroll pauses until they scroll back within range.
 *
 * @param scrollRef  the scrollable transcript container
 * @param bottomRef  a zero-height sentinel rendered as the last child
 * @param dep        value that changes when new content is appended (messages)
 * @param threshold  px from the bottom still counted as "pinned" (default 80)
 */
export function useStickyAutoScroll(
  scrollRef: React.RefObject<HTMLElement>,
  bottomRef: React.RefObject<HTMLElement>,
  dep: unknown,
  threshold = 80,
): void {
  // Starts true so the first render scrolls to the latest message.
  const pinnedRef = useRef(true);

  // Track the user's scroll position; flip the pin when they move away from
  // / back toward the bottom. Kept in a ref so it never triggers a re-render.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      pinnedRef.current = distanceFromBottom <= threshold;
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef, threshold]);

  // On new content, only follow to the bottom if the user is still pinned.
  // Instant ("auto") rather than smooth: smooth scroll cannot keep pace with
  // high-frequency streaming updates and reads as jitter.
  useEffect(() => {
    if (pinnedRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [dep, bottomRef]);
}
