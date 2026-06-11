import { useCallback, useMemo, useState } from "react";
import {
  applySlashCompletion,
  detectSlashInput,
  listSlashCompletions,
  type SlashCompletionItem,
} from "@liminal/core";

export function useSlashCommandCompletion(input: string) {
  const [cursor, setCursor] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(true);

  const slashState = useMemo(
    () => detectSlashInput(input, cursor),
    [input, cursor]
  );

  const items = useMemo(() => {
    if (!slashState || !menuOpen) return [];
    return listSlashCompletions(input, cursor);
  }, [slashState, menuOpen, input, cursor]);

  const visible = Boolean(slashState && menuOpen && items.length > 0);

  const syncCursor = useCallback(
    (el: HTMLTextAreaElement | null) => {
      if (!el) return;
      setCursor(el.selectionStart ?? 0);
    },
    []
  );

  const onInputCursorChange = useCallback((el: HTMLTextAreaElement) => {
    setCursor(el.selectionStart ?? 0);
    setMenuOpen(true);
    setSelectedIndex(0);
  }, []);

  const dismissMenu = useCallback(() => setMenuOpen(false), []);

  const applyItem = useCallback(
    (item: SlashCompletionItem): { text: string; cursor: number } => {
      const next = applySlashCompletion(input, cursor, item);
      setMenuOpen(true);
      setSelectedIndex(0);
      return next;
    },
    [input, cursor]
  );

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent): "consumed" | "apply_selected" | "none" => {
      if (!visible) return "none";
      if (e.key === "Escape") {
        e.preventDefault();
        dismissMenu();
        return "consumed";
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
        return "consumed";
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return "consumed";
      }
      if (e.key === "Tab" || (e.key === "Enter" && e.ctrlKey)) {
        e.preventDefault();
        return "apply_selected";
      }
      return "none";
    },
    [visible, items.length, dismissMenu]
  );

  return {
    items,
    selectedIndex,
    setSelectedIndex,
    visible,
    syncCursor,
    onInputCursorChange,
    dismissMenu,
    applyItem,
    handleMenuKeyDown,
    slashState,
  };
}
