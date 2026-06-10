export type TerminalTabSource = "agent" | "user";

export interface TerminalTab {
  sessionId: string;
  label: string;
  cwd: string;
  source: TerminalTabSource;
}

export interface TerminalViewWire {
  chatId: string;
  sessionId: string;
  label: string;
  source: TerminalTabSource;
  cwd: string;
  open: boolean;
  focus: boolean;
  updatedAt: number;
}
