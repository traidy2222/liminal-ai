import React from "react";
import { Box, Text } from "ink";
import type { AgentHarness } from "@dreamthedream/core";
import { useAgent, type MessageEntry } from "./useAgent.js";
import { Header } from "./components/Header.js";
import { StreamingText } from "./components/StreamingText.js";
import { ToolCallCard } from "./components/ToolCallCard.js";
import { ApprovalPrompt } from "./components/ApprovalPrompt.js";
import { AskUserPrompt } from "./components/AskUserPrompt.js";
import { InputBox } from "./components/InputBox.js";
import { ThinkCard } from "./components/ThinkCard.js";
import { PlanCard } from "./components/PlanCard.js";
import { SubtaskCard } from "./components/SubtaskCard.js";

interface Props {
  harness: AgentHarness;
}

export function App({ harness }: Props) {
  const { state, sendMessage, resolveApproval, resolveAskUser } = useAgent(harness);

  const isBlocked = !!state.pendingApproval || !!state.pendingAskUser;

  return (
    <Box flexDirection="column">
      <Header snapshot={state.contextSnapshot} busy={state.busy} />

      <Box flexDirection="column" paddingX={1}>
        {state.messages.map((entry, i) => (
          <MessageView key={i} entry={entry} />
        ))}
      </Box>

      {state.error && (
        <Box paddingX={1}>
          <Text color="red" bold>
            Error: {state.error}
          </Text>
        </Box>
      )}

      {state.pendingApproval && (
        <ApprovalPrompt
          payload={state.pendingApproval}
          onResolved={() => resolveApproval({ decision: "approve" })}
        />
      )}

      {state.pendingAskUser && (
        <AskUserPrompt
          payload={state.pendingAskUser}
          onResolved={() => {}}
        />
      )}

      {!isBlocked && (
        <InputBox onSubmit={sendMessage} disabled={state.busy && !isBlocked} />
      )}
    </Box>
  );
}

function MessageView({ entry }: { entry: MessageEntry }) {
  switch (entry.kind) {
    case "user":
      return (
        <Box gap={1} marginY={0}>
          <Text color="cyan" bold>You</Text>
          <Text color="white">{entry.text}</Text>
        </Box>
      );

    case "assistant":
      return (
        <Box marginY={0} paddingLeft={0}>
          <StreamingText text={entry.text} color="green" />
        </Box>
      );

    case "tool_call":
      return (
        <ToolCallCard
          name={entry.name}
          argsJson={entry.argsJson}
          status={entry.status}
        />
      );

    case "tool_result":
      return (
        <Box paddingLeft={2} marginBottom={0}>
          <StreamingText
            text={`→ ${entry.output.slice(0, 400)}${entry.output.length > 400 ? "…" : ""}`}
            color={entry.ok ? "gray" : "red"}
            dimColor={entry.ok}
          />
        </Box>
      );

    case "ask_user":
      return (
        <Box gap={1}>
          <Text color="blue" bold>Agent asks:</Text>
          <Text color="white">{entry.prompt}</Text>
        </Box>
      );

    case "think":
      return <ThinkCard content={entry.content} />;

    case "plan":
      return <PlanCard steps={entry.steps} />;

    case "subtask":
      return (
        <SubtaskCard
          taskId={entry.taskId}
          goal={entry.goal}
          depth={entry.depth}
          status={entry.status}
        />
      );

    case "context_compressed":
      return (
        <Box marginY={0} paddingLeft={2}>
          <Text color="yellow" dimColor>
            {`⊙ Context compressed: ${entry.beforePct}% → ${entry.afterPct}% (${entry.rounds} round(s) summarized)`}
          </Text>
        </Box>
      );
  }
}
