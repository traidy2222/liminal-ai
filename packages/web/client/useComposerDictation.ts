import { useCallback, useRef, useState, type RefObject } from "react";
import type { DictationButtonProps } from "./audio/DictationButton.js";
import type { DictationCost } from "./audio/useDictation.js";

export function useComposerDictation(opts: {
  input: string;
  onInputChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onAutoSendSubmit: (fullMessage: string) => void | string;
  onHistoryReset?: () => void;
  audioCue: boolean;
  onSessionActiveChange?: (active: boolean) => void;
  onCaptureActiveChange?: (active: boolean) => void;
  /** Mic session armed — enables server voice/dictation mode for sends. */
  onDictationSessionActive?: (active: boolean) => void;
  onUnlockAudio?: () => void;
  shouldBlockSpeechCapture?: () => boolean;
}): {
  dictationProps: DictationButtonProps;
  autoSendNotice: string | null;
  dismissAutoSendNotice: () => void;
} {
  const spanStartRef = useRef(0);
  const committedLenRef = useRef(0);
  const previewLenRef = useRef(0);
  const [autoSendNotice, setAutoSendNotice] = useState<string | null>(null);

  const readInput = useCallback(
    () => opts.inputRef.current?.value ?? opts.input,
    [opts.input, opts.inputRef]
  );

  const writeInput = useCallback(
    (next: string) => opts.onInputChange(next),
    [opts.onInputChange]
  );

  const dismissAutoSendNotice = useCallback(() => setAutoSendNotice(null), []);

  const onAppendFinal = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const prev = readInput();
      const base = prev.slice(0, spanStartRef.current + committedLenRef.current);
      const after = prev.slice(
        spanStartRef.current + committedLenRef.current + previewLenRef.current
      );
      const sep = base && !/\s$/.test(base) ? " " : "";
      const insertion = sep + text.trim();
      committedLenRef.current += insertion.length;
      previewLenRef.current = 0;
      writeInput(base + insertion + after);
      opts.onHistoryReset?.();
    },
    [readInput, writeInput, opts]
  );

  const onInterimText = useCallback(
    (text: string) => {
      const prev = readInput();
      const baseEnd = spanStartRef.current + committedLenRef.current;
      const base = prev.slice(0, baseEnd);
      const after = prev.slice(baseEnd + previewLenRef.current);
      const sep = base && !/\s$/.test(base) ? " " : "";
      const insertion = sep + text.trim();
      previewLenRef.current = insertion.length;
      writeInput(base + insertion + after);
    },
    [readInput, writeInput]
  );

  const onRefinedFull = useCallback(
    (refinedText: string, _cost: DictationCost, wasAutoSent: boolean) => {
      if (wasAutoSent) return;
      const prev = readInput();
      const base = prev.slice(0, spanStartRef.current);
      const totalSpanLen = committedLenRef.current + previewLenRef.current;
      const after = prev.slice(spanStartRef.current + totalSpanLen);
      const sep = base && !/\s$/.test(base) ? " " : "";
      const insertion = sep + refinedText.trim();
      committedLenRef.current = insertion.length;
      previewLenRef.current = 0;
      writeInput(base + insertion + after);
      queueMicrotask(() => opts.inputRef.current?.focus());
    },
    [readInput, writeInput, opts.inputRef]
  );

  const onAutoSend = useCallback(
    (_committedFromHook: string) => {
      const prev = readInput();
      const dictated = prev
        .slice(
          spanStartRef.current,
          spanStartRef.current + committedLenRef.current + previewLenRef.current
        )
        .trim();
      const trimmed = dictated || _committedFromHook.trim();
      if (!trimmed) {
        setAutoSendNotice("Empty transcript — nothing to send.");
        return;
      }
      const preDictation = prev.slice(0, spanStartRef.current);
      const sep = preDictation && !/\s$/.test(preDictation) ? " " : "";
      const fullMessage = (preDictation + sep + trimmed).trim();
      if (!fullMessage) {
        setAutoSendNotice("Empty transcript — nothing to send.");
        return;
      }
      const err = opts.onAutoSendSubmit(fullMessage);
      if (typeof err === "string") {
        setAutoSendNotice(err);
        return;
      }
      spanStartRef.current = 0;
      committedLenRef.current = 0;
      previewLenRef.current = 0;
      setAutoSendNotice(null);
    },
    [readInput, opts]
  );

  const dictationProps: DictationButtonProps = {
    audioCue: opts.audioCue,
    placement: "composer",
    hideCostChip: true,
    onSessionActiveChange: (active) => {
      opts.onSessionActiveChange?.(active);
      opts.onDictationSessionActive?.(active);
      if (active) opts.onUnlockAudio?.();
    },
    onCaptureActiveChange: opts.onCaptureActiveChange,
    shouldBlockSpeechCapture: opts.shouldBlockSpeechCapture,
    onStart: () => {
      opts.onUnlockAudio?.();
      spanStartRef.current = opts.inputRef.current?.value.length ?? opts.input.length;
      committedLenRef.current = 0;
      previewLenRef.current = 0;
      setAutoSendNotice(null);
    },
    onAppendFinal,
    onInterimText,
    onRefinedFull,
    onAutoSend,
  };

  return { dictationProps, autoSendNotice, dismissAutoSendNotice };
}
