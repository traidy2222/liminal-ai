import { createHash, randomUUID } from "node:crypto";

export const PROCEDURE_SCHEMA_VERSION = 1;
export type ProcedureState =
  | "candidate"
  | "validating"
  | "active"
  | "needs_revalidation"
  | "retired"
  | "rejected";
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type Binding =
  | Json
  | { $param: string }
  | { $template: string }
  | { $json: Record<string, Binding> };
export interface ProcedureParameter {
  name: string;
  type: "string" | "integer" | "boolean";
  description: string;
  pattern?: string;
}
export interface EvidenceRef {
  runId: string;
  eventId: string;
  callId?: string;
  artifactHash?: string;
  kind: "observation" | "correction" | "verified_outcome";
}
export interface ProcedureDependency {
  key: string;
  kind: "file" | "tool_schema" | "environment";
  target: string;
  fingerprint: string;
  symbol?: string;
}
export interface ApplicabilityPredicate {
  kind: "file_exists" | "file_contains" | "json_equals";
  path: string;
  value?: Json;
  pointer?: string;
}
export interface ProcedureStep {
  id: string;
  tool: string;
  args: Record<string, Binding>;
  purpose: string;
}
export interface ProcedureVersion {
  schemaVersion: 1;
  procedureId: string;
  versionId: string;
  version: number;
  name: string;
  purpose: string;
  taskFamily: string;
  parameters: ProcedureParameter[];
  applicability: ApplicabilityPredicate[];
  preconditions: ApplicabilityPredicate[];
  postconditions: ApplicabilityPredicate[];
  steps: ProcedureStep[];
  permissions: string[];
  sideEffects: string[];
  negativeExamples: string[];
  evidence: EvidenceRef[];
  dependencies: ProcedureDependency[];
  support: string[];
  contradictions: string[];
  assumptions: string[];
  missingEvidence: string[];
  scope: { workspaceId: string; portability: "workspace_only" };
  provenance: {
    model: string;
    harness: string;
    node: string;
    platform: string;
    sourceRunId: string;
    sourceModel?: string;
    sourceHarness?: string;
  };
  verification: { contractId: string; method: "trusted_json_record" };
  explanation: { kind: "inferred"; text: string };
  createdAt: string;
}
export interface ProcedureSelection {
  versionId: string;
  stateRevision: number;
  taskRevision: number;
  runId: string;
  workspaceId: string;
  inputHash: string;
}
export interface ProcedureActivity {
  action:
    | "learned"
    | "reused"
    | "suspended"
    | "revised"
    | "validated"
    | "retired"
    | "rejected"
    | "abstained"
    | "error";
  procedureId?: string;
  versionId?: string;
  name: string;
  state?: ProcedureState;
  reason: string;
  runId?: string;
}
export interface JsonRecordContract {
  schemaVersion: 1;
  family: "json-record";
  name: string;
  directory: string;
  filenameParameter: string;
  fields: Record<string, { parameter: string } | { constant: Json }>;
  allowAdditionalFields: boolean;
}

export const newId = () => randomUUID();
export const fingerprint = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ":" +
            stableJson((value as Record<string, unknown>)[key]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function bounded(
  text: unknown,
  max: number,
  label: string,
): asserts text is string {
  if (typeof text !== "string" || !text.trim() || text.length > max)
    throw new Error(`Invalid ${label}`);
}
export function relativePath(input: string): string {
  if (
    !input ||
    input.length > 1024 ||
    /^[\\/]|^[a-z]:|[\x00-\x1f:]/i.test(input) ||
    input.split(/[\\/]/).some((p) => p === ".." || p === "")
  )
    throw new Error("Expected a workspace-relative path without traversal");
  return input.replaceAll("\\", "/");
}
export function validateContract(value: unknown): JsonRecordContract {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.family !== "json-record"
  )
    throw new Error("Unsupported validation contract");
  bounded(value.name, 120, "contract name");
  bounded(value.directory, 512, "record directory");
  relativePath(value.directory);
  bounded(value.filenameParameter, 40, "filename parameter");
  if (!/^[a-z][a-z0-9_]*$/i.test(value.filenameParameter))
    throw new Error("Invalid filename parameter");
  if (
    typeof value.allowAdditionalFields !== "boolean" ||
    !object(value.fields) ||
    !Object.keys(value.fields).length ||
    Object.keys(value.fields).length > 32
  )
    throw new Error("Contract needs 1..32 explicit fields");
  for (const [name, field] of Object.entries(value.fields)) {
    if (
      !/^[a-z][a-z0-9_]*$/i.test(name) ||
      !object(field) ||
      Object.keys(field).length !== 1 ||
      !("constant" in field || typeof field.parameter === "string")
    )
      throw new Error("Invalid contract field");
    if (/password|secret|token|api.?key|authorization|cookie/i.test(name))
      throw new Error(
        "Credential records are not supported by procedural learning",
      );
    if (
      "parameter" in field &&
      !/^[a-z][a-z0-9_]*$/i.test(String(field.parameter))
    )
      throw new Error("Invalid parameter name");
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 16000)
    throw new Error("Contract too large");
  return value as unknown as JsonRecordContract;
}
export function validateProcedure(value: unknown): ProcedureVersion {
  if (!object(value) || value.schemaVersion !== 1)
    throw new Error("Unsupported procedure schema");
  for (const field of [
    "procedureId",
    "versionId",
    "name",
    "purpose",
    "taskFamily",
    "createdAt",
  ])
    bounded(value[field], field === "purpose" ? 1200 : 160, field);
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 1)
    throw new Error("Invalid immutable version number");
  if (
    !object(value.scope) ||
    value.scope.portability !== "workspace_only" ||
    typeof value.scope.workspaceId !== "string"
  )
    throw new Error("Operational procedures require an actual workspace scope");
  for (const [field, max] of [
    ["parameters", 16],
    ["steps", 16],
    ["dependencies", 32],
    ["evidence", 64],
    ["applicability", 16],
    ["preconditions", 16],
    ["postconditions", 16],
    ["permissions", 16],
    ["sideEffects", 16],
    ["negativeExamples", 16],
    ["support", 32],
    ["contradictions", 32],
    ["assumptions", 16],
    ["missingEvidence", 16],
  ] as const) {
    if (
      !Array.isArray(value[field]) ||
      (value[field] as unknown[]).length > max
    )
      throw new Error(`Invalid ${field}`);
  }
  const parameters = value.parameters as unknown as ProcedureParameter[];
  const names = new Set<string>();
  for (const p of parameters) {
    if (
      !object(p) ||
      !["string", "integer", "boolean"].includes(p.type) ||
      !/^[a-z][a-z0-9_]*$/i.test(p.name) ||
      names.has(p.name)
    )
      throw new Error("Invalid/duplicate parameter");
    names.add(p.name);
    if (p.pattern !== undefined && p.pattern !== "identifier")
      throw new Error(
        "Only the bounded identifier parameter pattern is supported",
      );
  }
  const checkBinding = (binding: unknown, depth = 0): void => {
    if (depth > 12) throw new Error("Binding nesting too deep");
    if (
      typeof binding === "string" &&
      /(?:sk-(?:or-|proj-)?[a-z0-9-]{16,}|Bearer\s+\S+|[A-Z]:[\\/]|\/Users\/|\/home\/)/i.test(
        binding,
      )
    )
      throw new Error(
        "Proposal contains a credential or machine-specific path",
      );
    if (Array.isArray(binding)) {
      binding.forEach((v) => checkBinding(v, depth + 1));
      return;
    }
    if (!object(binding)) return;
    if ("$param" in binding) {
      if (
        Object.keys(binding).length !== 1 ||
        !names.has(String(binding.$param))
      )
        throw new Error("Unknown parameter binding");
      return;
    }
    if ("$template" in binding) {
      if (
        Object.keys(binding).length !== 1 ||
        typeof binding.$template !== "string"
      )
        throw new Error("Invalid template");
      for (const m of binding.$template.matchAll(/\{\{(\w+)\}\}/g))
        if (!names.has(m[1]!)) throw new Error("Unknown template parameter");
      checkBinding(binding.$template, depth + 1);
      return;
    }
    if ("$json" in binding) {
      if (Object.keys(binding).length !== 1 || !object(binding.$json))
        throw new Error("Invalid JSON binding");
    }
    for (const [key, item] of Object.entries(binding)) {
      if (["__proto__", "constructor", "prototype"].includes(key))
        throw new Error("Invalid binding key");
      checkBinding(item, depth + 1);
    }
  };
  for (const step of value.steps as unknown as ProcedureStep[]) {
    if (
      !object(step) ||
      typeof step.tool !== "string" ||
      !object(step.args) ||
      !/^[a-z][a-z0-9_]*$/.test(step.tool) ||
      step.tool.startsWith("procedure_")
    )
      throw new Error("Invalid or recursive procedure step");
    checkBinding(step.args);
  }
  checkBinding([
    value.name,
    value.purpose,
    value.explanation,
    value.assumptions,
    value.negativeExamples,
  ]);
  if (
    !(value.steps as unknown[]).length ||
    !(value.evidence as unknown[]).length ||
    !(value.negativeExamples as unknown[]).length
  )
    throw new Error("Procedure needs steps, source evidence and limits");
  for (const d of value.dependencies as unknown as ProcedureDependency[]) {
    if (
      !object(d) ||
      !["file", "tool_schema", "environment"].includes(d.kind) ||
      typeof d.target !== "string" ||
      !/^[a-f0-9]{64}$/.test(d.fingerprint)
    )
      throw new Error("Invalid dependency");
    if (d.kind === "file") relativePath(d.target);
  }
  if (
    !object(value.verification) ||
    value.verification.method !== "trusted_json_record" ||
    typeof value.verification.contractId !== "string" ||
    !object(value.provenance) ||
    !object(value.explanation) ||
    value.explanation.kind !== "inferred"
  )
    throw new Error("Missing verification/provenance or inference label");
  if (Buffer.byteLength(JSON.stringify(value)) > 64000)
    throw new Error("Procedure too large");
  return structuredClone(value) as unknown as ProcedureVersion;
}
export function bindInputs(
  version: ProcedureVersion,
  inputs: Record<string, unknown>,
): Record<string, Json> {
  const out: Record<string, Json> = {};
  if (
    Object.keys(inputs).some(
      (key) => !version.parameters.some((p) => p.name === key),
    )
  )
    throw new Error("Unexpected procedure input");
  for (const p of version.parameters) {
    const value = inputs[p.name];
    if (
      p.type === "integer"
        ? !Number.isSafeInteger(value)
        : typeof value !== p.type
    )
      throw new Error(`Invalid input ${p.name}`);
    if (
      typeof value === "string" &&
      (value.length > 512 ||
        (p.pattern === "identifier" && !/^[a-z][a-z0-9_-]{0,63}$/i.test(value)))
    )
      throw new Error(`Invalid input ${p.name}`);
    out[p.name] = value as Json;
  }
  return out;
}
export function resolveBinding(
  value: Binding,
  inputs: Record<string, Json>,
  depth = 0,
): Json {
  if (depth > 12) throw new Error("Binding nesting too deep");
  if (Array.isArray(value))
    return value.map((v) => resolveBinding(v, inputs, depth + 1));
  if (value && typeof value === "object") {
    if ("$param" in value) return inputs[String(value.$param)]!;
    if ("$template" in value)
      return String(value.$template).replace(
        /\{\{(\w+)\}\}/g,
        (_, key: string) => String(inputs[key]),
      );
    if ("$json" in value)
      return (
        JSON.stringify(
          resolveBinding(value.$json as unknown as Binding, inputs, depth + 1),
          null,
          2,
        ) + "\n"
      );
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveBinding(item, inputs, depth + 1),
      ]),
    );
  }
  return value;
}
