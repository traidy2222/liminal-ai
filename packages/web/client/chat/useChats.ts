import { useCallback, useEffect, useState } from "react";
import { WEB_SERVER_BASE } from "../useSSE.js";

/** Mirrors core's ChatMetadata. Kept loose so the client doesn't transitively import core types. */
export interface ChatMetaDTO {
  chatId: string;
  title: string;
  workspaceMode: "scratch" | "folder" | "reuse";
  workspaceRoot: string;
  workspaceFingerprint?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatsState {
  chats: ChatMetaDTO[];
  orphanIds: string[];
  activeChatId: string | null;
  residentChatIds: string[];
  loading: boolean;
  error: string | null;
}

/**
 * React hook that owns the chat list. Subscribes to `chat_switched` SSE events
 * via a custom-event bus dispatched by useSSE so it stays in sync with the
 * server's notion of the active chat.
 */
export function useChats(): {
  state: ChatsState;
  refresh: () => Promise<void>;
  create: (input: {
    title?: string;
    workspaceMode: "scratch" | "folder" | "reuse";
    workspaceRoot?: string;
  }) => Promise<ChatMetaDTO>;
  activate: (chatId: string) => Promise<void>;
  remove: (chatId: string) => Promise<void>;
} {
  const [state, setState] = useState<ChatsState>({
    chats: [],
    orphanIds: [],
    activeChatId: null,
    residentChatIds: [],
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`${WEB_SERVER_BASE}/api/chats`);
      if (!res.ok) throw new Error(`/api/chats → ${res.status}`);
      const body = (await res.json()) as {
        chats: ChatMetaDTO[];
        orphanIds: string[];
        activeChatId: string | null;
        residentChatIds: string[];
      };
      setState({
        chats: body.chats,
        orphanIds: body.orphanIds,
        activeChatId: body.activeChatId,
        residentChatIds: body.residentChatIds,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Listen for chat_switched events bubbled from useSSE via a window-level
  // custom event so this hook can stay decoupled from the SSE reducer.
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ chatId: string }>).detail;
      if (!detail) return;
      setState((s) => ({ ...s, activeChatId: detail.chatId || null }));
      void refresh();
    };
    window.addEventListener("liminal:chat_switched", handler as EventListener);
    return () => window.removeEventListener("liminal:chat_switched", handler as EventListener);
  }, [refresh]);

  const create = useCallback(
    async (input: {
      title?: string;
      workspaceMode: "scratch" | "folder" | "reuse";
      workspaceRoot?: string;
    }) => {
      const res = await fetch(`${WEB_SERVER_BASE}/api/chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, activate: true }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `/api/chats → ${res.status}`);
      }
      const body = (await res.json()) as { meta: ChatMetaDTO };
      await refresh();
      return body.meta;
    },
    [refresh]
  );

  const activate = useCallback(
    async (chatId: string) => {
      const res = await fetch(`${WEB_SERVER_BASE}/api/chats/${encodeURIComponent(chatId)}/activate`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `/api/chats/${chatId}/activate → ${res.status}`);
      }
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (chatId: string) => {
      const res = await fetch(`${WEB_SERVER_BASE}/api/chats/${encodeURIComponent(chatId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `/api/chats/${chatId} delete → ${res.status}`);
      }
      await refresh();
    },
    [refresh]
  );

  return { state, refresh, create, activate, remove };
}
