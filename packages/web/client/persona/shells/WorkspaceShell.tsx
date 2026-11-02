import React, { useRef, useState } from "react";
import type { ShellContract } from "../ShellContract.js";
import type { TurnRow } from "../../chatTurnLayout.js";
import { useChats } from "../../chat/useChats.js";
import { NewChatModal } from "../../chat/NewChatModal.js";
import { useStickyAutoScroll } from "../../useStickyAutoScroll.js";
import { WorkingPanel } from "../../WorkingPanel.js";
import { resolveToolCardsMode } from "../../resolveToolCardsMode.js";
import { ShellControls } from "./ShellControls.js";
import { ShellComposer } from "./ShellComposer.js";
import { MessageView, ToolGroupCard } from "./HudShell.js";
import "./workspace.css";

/** The threshold: two offset doorframes, shared with the native wordmark. */
function ThresholdMark() {
  return (
    <svg viewBox="0 0 40 44" fill="none" aria-hidden="true">
      <path
        d="M6 37V7h23v30M15 37V16h19v21"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path d="M6 37h28" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}

const starters = [
  {
    title: "Build something",
    detail: "Turn an idea into working code",
    prompt:
      "Help me build a feature in this workspace. First, explore the project and explain the best place to start.",
    icon: "⌘",
  },
  {
    title: "Explore a question",
    detail: "Research, connect, and explain",
    prompt:
      "Help me research a topic. Ask me what I want to understand, then investigate with sources.",
    icon: "◎",
  },
  {
    title: "Make a document",
    detail: "Give your thinking a useful form",
    prompt:
      "Help me create a document. Ask me about its audience, purpose, and the material I want to include.",
    icon: "▤",
  },
];

/** Uses the existing harness contract; presentation never owns execution state. */
export function WorkspaceShell({ contract: c }: { contract: ShellContract }) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { state, create, activate, remove } = useChats();
  const [newChat, setNewChat] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [navError, setNavError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  useStickyAutoScroll(messagesRef, bottomRef, c.groupedMessages);
  const current = state.chats.find(
    (chat) => chat.chatId === state.activeChatId,
  );
  const cardsMode = resolveToolCardsMode(c.personaTheme.toolCards, c.surface);
  const chats = [...state.chats]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((chat) =>
      `${chat.title} ${chat.workspaceRoot}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const act = async (fn: () => Promise<unknown>) => {
    setSwitching(true);
    setNavError(null);
    try {
      await fn();
      setNavOpen(false);
    } catch (error) {
      setNavError(error instanceof Error ? error.message : String(error));
    } finally {
      setSwitching(false);
    }
  };
  const renderRow = (row: TurnRow, key: string) => {
    if (row.kind === "tool_group")
      return (
        <ToolGroupCard
          key={key}
          group={row}
          toolResultMap={c.toolResultMap}
          surface={c.surface}
          toolCardsMode={cardsMode}
        />
      );
    if (
      !c.showRawHarness &&
      ["trace", "provider_retry", "context_compressed"].includes(row.kind)
    )
      return null;
    return (
      <MessageView
        key={key}
        entry={row}
        toolResult={
          row.kind === "tool_call" ? c.toolResultMap.get(row.callId) : undefined
        }
        surface={c.surface}
        personaTheme={c.personaTheme}
        toolCardsMode={cardsMode}
        onInspectSubtask={c.onInspectSubtask}
      />
    );
  };
  const chooseStarter = (prompt: string) => {
    c.onInputChange(prompt);
    document.getElementById("chat-message-input")?.focus();
  };

  return (
    <div className="lim-workspace">
      {navOpen && (
        <button
          className="workspace-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <aside
        className={`workspace-nav ${navOpen ? "is-open" : ""}`}
        aria-label="Chat navigation"
        onKeyDown={(e) => {
          if (e.key === "Escape") setNavOpen(false);
        }}
      >
        <div className="workspace-brand">
          <ThresholdMark />
          <div>
            <strong>
              Liminal<span> / </span>
            </strong>
            <small>Your working space</small>
          </div>
          <button
            className="workspace-mobile-close"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
          >
            ×
          </button>
        </div>
        <button
          className="workspace-new"
          onClick={() => setNewChat(true)}
          disabled={switching}
        >
          <span>＋</span> New chat <span className="workspace-key">↗</span>
        </button>
        <label className="workspace-search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search chats"
            placeholder="Find a conversation"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="workspace-nav-label">
          Conversations <span>{state.chats.length}</span>
        </div>
        <div className="workspace-chat-list">
          {state.loading && !chats.length && (
            <p className="workspace-note" role="status">
              Loading conversations…
            </p>
          )}
          {!state.loading && !chats.length && (
            <p className="workspace-note">
              {search
                ? "No matching conversations."
                : "Start a chat to make room for your next idea."}
            </p>
          )}
          {chats.map((chat) => (
            <div
              className={`workspace-chat ${chat.chatId === state.activeChatId ? "is-active" : ""}`}
              key={chat.chatId}
            >
              <button
                className="workspace-chat-select"
                aria-current={
                  chat.chatId === state.activeChatId ? "page" : undefined
                }
                disabled={switching}
                onClick={() => void act(() => activate(chat.chatId))}
              >
                <span className="workspace-chat-icon" aria-hidden="true">
                  ◻
                </span>
                <span>
                  <strong>{chat.title}</strong>
                  <small>
                    {chat.workspaceMode === "scratch"
                      ? "Personal workspace"
                      : chat.workspaceRoot.split(/[\\/]/).filter(Boolean).pop()}
                  </small>
                </span>
              </button>
              <button
                className="workspace-delete"
                aria-label={`Delete ${chat.title}`}
                disabled={switching}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete “${chat.title}”? This cannot be undone.`,
                    )
                  )
                    void act(() => remove(chat.chatId));
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {(navError || state.error) && (
          <p className="workspace-error" role="alert">
            {navError ?? state.error}
          </p>
        )}
        <div className="workspace-nav-footer">
          <button onClick={c.onOpenSettings}>
            <span aria-hidden="true">⚙</span> Settings <span>↗</span>
          </button>
          <div>
            <span
              className="workspace-dot"
              style={{ background: c.signalHud.color }}
            />
            {c.signalHud.label}
            <small>Web workspace</small>
          </div>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-header">
          <button
            className="workspace-menu"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(!navOpen)}
          >
            ☰
          </button>
          <div className="workspace-location">
            <small>
              Workspace <span>/</span> Chat
            </small>
            <strong>{current?.title ?? "A fresh start"}</strong>
          </div>
          <div className="workspace-header-actions">
            <span className="workspace-status" title={c.signalHud.detail}>
              <span
                className="workspace-dot"
                style={{ background: c.signalHud.color }}
              />
              {c.busy ? "Working" : c.signalHud.label}
            </span>
            <button
              className={`workspace-activity-toggle ${activityOpen ? "is-active" : ""}`}
              aria-expanded={activityOpen}
              onClick={() => setActivityOpen(!activityOpen)}
            >
              Activity <span>{c.allToolCalls.length}</span>
            </button>
          </div>
        </header>
        <div className="workspace-content">
          <section className="workspace-conversation" aria-label="Conversation">
            <div
              ref={messagesRef}
              className="workspace-transcript"
              tabIndex={0}
              aria-label="Conversation transcript"
            >
              {c.chatTurns.length === 0 && !c.busy ? (
                <div className="workspace-welcome">
                  <div className="workspace-threshold">
                    <ThresholdMark />
                  </div>
                  <p className="workspace-eyebrow">
                    A little space. A lot of possibility.
                  </p>
                  <h1>
                    What are we
                    <br />
                    <span>working on?</span>
                  </h1>
                  <p className="workspace-intro">
                    Bring a question, a rough idea, or a project.
                    <br />
                    We’ll find the next step together.
                  </p>
                  <div className="workspace-starters">
                    {starters.map((s) => (
                      <button
                        key={s.title}
                        onClick={() => chooseStarter(s.prompt)}
                      >
                        <span
                          className="workspace-starter-icon"
                          aria-hidden="true"
                        >
                          {s.icon}
                        </span>
                        <strong>{s.title}</strong>
                        <small>{s.detail}</small>
                        <span
                          className="workspace-starter-arrow"
                          aria-hidden="true"
                        >
                          ↗
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="workspace-messages">
                  {c.chatTurns.map((turn, i) => (
                    <article className="workspace-turn" key={i}>
                      {turn.user && (
                        <div className="workspace-user">
                          {renderRow(turn.user, `${i}-user`)}
                        </div>
                      )}
                      {!!turn.working.length && (
                        <WorkingPanel
                          working={turn.working}
                          isActive={turn.isActive}
                        >
                          {turn.working.map((row, j) =>
                            renderRow(row, `${i}-${j}`),
                          )}
                        </WorkingPanel>
                      )}
                      {turn.finalReply && (
                        <div className="workspace-reply">
                          <div className="workspace-reply-label">
                            <ThresholdMark />
                            {c.personaDisplayLabel}
                          </div>
                          {renderRow(turn.finalReply, `${i}-reply`)}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
              {c.error && (
                <p className="workspace-error" role="alert">
                  {c.error}
                </p>
              )}
              <div ref={bottomRef} />
            </div>
            <div className="workspace-composer">
              <ShellComposer
                contract={c}
                personaTheme={c.personaTheme}
                variant="studio"
              />
            </div>
            <div className="workspace-bottom">
              <span>
                {current?.workspaceMode === "folder"
                  ? current.workspaceRoot
                  : "Your ideas start here"}
              </span>
              <span>{c.pct}% context</span>
            </div>
          </section>
          {activityOpen && (
            <aside className="workspace-activity" aria-label="Activity">
              <div className="workspace-activity-heading">
                <h2>Behind the work</h2>
                <button
                  aria-label="Close activity"
                  onClick={() => setActivityOpen(false)}
                >
                  ×
                </button>
              </div>
              <p>Follow the steps as they happen.</p>
              <ShellControls
                contract={c}
                messagesRef={messagesRef}
                tone="soft"
                style={{ flexWrap: "wrap" }}
              />
              <div className="workspace-activity-list">
                {c.allToolCalls.length === 0 ? (
                  <div className="workspace-activity-empty">
                    <span>◎</span>
                    <strong>Room for progress</strong>
                    <p>
                      Tool calls and their results will appear here when a task
                      gets going.
                    </p>
                  </div>
                ) : (
                  [...c.allToolCalls].reverse().map((tc) => (
                    <div className="workspace-activity-item" key={tc.callId}>
                      <span>
                        {tc.status === "done"
                          ? "✓"
                          : tc.status === "error"
                            ? "!"
                            : "◌"}
                      </span>
                      <div>
                        <strong>{tc.name.replaceAll("_", " ")}</strong>
                        <small>{tc.status.replaceAll("_", " ")}</small>
                        {c.toolResultMap.get(tc.callId)?.ok === false && (
                          <p className="workspace-error">
                            {c.toolResultMap
                              .get(tc.callId)
                              ?.output.slice(0, 180)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>
          )}
        </div>
        {/* Keep the required control cluster reachable even with Activity closed. */}
        {!activityOpen && (
          <div className="workspace-controls">
            <ShellControls contract={c} messagesRef={messagesRef} tone="soft" />
          </div>
        )}
      </main>
      <NewChatModal
        open={newChat}
        onClose={() => setNewChat(false)}
        knownWorkspaces={state.chats}
        onCreate={async (input) => {
          await create(input);
          setNewChat(false);
          setNavOpen(false);
        }}
      />
    </div>
  );
}
