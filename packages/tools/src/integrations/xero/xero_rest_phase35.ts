/**
 * Xero Phase 3.5 — payroll writes, accounting mutations, composites.
 */
import type { ToolRegistry } from "@liminal/core";
import { registerXeroPhase35AccountingTools } from "./xero_rest_phase35_accounting.js";
import { registerXeroPhase35CompositeTools } from "./xero_rest_phase35_composites.js";
import { registerXeroPhase35PayrollTools } from "./xero_rest_phase35_payroll.js";

export function registerXeroRestPhase35Tools(registry: ToolRegistry): void {
  registerXeroPhase35CompositeTools(registry);
  registerXeroPhase35PayrollTools(registry);
  registerXeroPhase35AccountingTools(registry);
}
