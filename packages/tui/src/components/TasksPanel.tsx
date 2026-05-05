import React from "react";
import { Box, Text } from "ink";

interface Props {
  steps: string[] | null;
  /** When true, highlights the first incomplete step as RUNNING. */
  busy: boolean;
  /** Max steps to render (keeps dashboard layout within terminal height). */
  maxSteps?: number;
}

function stripDonePrefix(step: string): string {
  if (step.startsWith("✓ ")) return step.slice(2).trim();
  if (step.startsWith("✓")) return step.slice(1).trim();
  return step;
}

function isDoneStep(step: string): boolean {
  return step.startsWith("✓") || step.startsWith("✓ ");
}

/**
 * Live task board derived from the latest `plan()` tool output (same data as PlanCard).
 */
export function TasksPanel({ steps, busy, maxSteps = 7 }: Props) {
  const omitted =
    steps && steps.length > maxSteps ? Math.max(0, steps.length - maxSteps) : 0;
  const slice = steps && steps.length > maxSteps ? steps.slice(-maxSteps) : steps;
  const indexOffset = steps && steps.length > maxSteps ? steps.length - maxSteps : 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="blue"
      paddingX={1}
      paddingY={1}
      marginBottom={1}
      overflowY="hidden"
    >
      <Text bold color="blueBright">
        TASKS
      </Text>
      {!slice || slice.length === 0 ? (
        <Text dimColor color="gray">
          No structured plan yet — the agent will call plan() when it breaks work into steps.
        </Text>
      ) : (
        <>
          {omitted > 0 && (
            <Text dimColor color="gray">
              … {omitted} earlier step{omitted === 1 ? "" : "s"} not shown (terminal budget)
            </Text>
          )}
          {slice.map((raw, j) => {
            const i = indexOffset + j;
            const done = isDoneStep(raw);
            const label = stripDonePrefix(raw);
            const firstOpen = (steps ?? []).findIndex((s) => !isDoneStep(s));
            const running = busy && !done && i === firstOpen;
            const icon = done ? "✓" : running ? "▶" : "○";
            const iconColor = done ? "green" : running ? "cyan" : "gray";
            const tag = done ? "DONE" : running ? "RUNNING" : "PENDING";
            return (
              <Box key={i} gap={1}>
                <Text color={iconColor}>{icon}</Text>
                <Text color="gray" dimColor>
                  {`${i + 1}.`}
                </Text>
                <Text color={done ? "gray" : running ? "white" : "gray"} dimColor={!running && !done}>
                  {label.slice(0, 72)}
                  {label.length > 72 ? "…" : ""}
                </Text>
                <Text dimColor color={iconColor}>
                  [{tag}]
                </Text>
              </Box>
            );
          })}
        </>
      )}
    </Box>
  );
}
