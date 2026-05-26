import { useEffect, type RefObject } from "react";

/** Close a popover when the user clicks outside or presses Escape. */
export function useDismissOnOutside(
  open: boolean,
  containerRefs: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[],
  onDismiss: () => void
): void {
  useEffect(() => {
    if (!open) return;

    const refs = Array.isArray(containerRefs) ? containerRefs : [containerRefs];

    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return;
      for (const ref of refs) {
        const el = ref.current;
        if (el?.contains(e.target)) return;
      }
      onDismiss();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, containerRefs, onDismiss]);
}
