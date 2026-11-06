import {
  fingerprint,
  bindInputs,
  resolveBinding,
  relativePath,
  stableJson,
  validateContract,
  type ProcedureVersion,
  type JsonRecordContract,
  type ApplicabilityPredicate,
  type Json,
} from "./model.js";
import { boundedFile, procedurePath } from "./workspace.js";
import { lstat } from "node:fs/promises";
export interface ContractCheck {
  correct: boolean;
  target: string;
  targetHash?: string;
  observations: Array<{ check: string; passed: boolean; detail: string }>;
}
export function recordTarget(
  contract: JsonRecordContract,
  inputs: Record<string, Json>,
): string {
  const name = inputs[contract.filenameParameter];
  if (typeof name !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/i.test(name))
    throw new Error("Record filename must be an identifier");
  return relativePath(`${contract.directory}/${name}.json`);
}
/** Frozen host contract; no stored script, model-generated assertion or process
 * score can redefine the oracle. Actual filesystem state establishes outcome. */
export async function verifyJsonRecord(
  root: string,
  contract: JsonRecordContract,
  inputs: Record<string, Json>,
): Promise<ContractCheck> {
  validateContract(contract);
  const target = recordTarget(contract, inputs),
    observations: ContractCheck["observations"] = [];
  try {
    const bytes = await boundedFile(root, target),
      value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Record must be a JSON object");
    for (const [field, rule] of Object.entries(contract.fields)) {
      const expected =
        "parameter" in rule ? inputs[rule.parameter] : rule.constant;
      const passed =
        expected !== undefined &&
        Object.hasOwn(value, field) &&
        stableJson(value[field]) === stableJson(expected);
      observations.push({
        check: field,
        passed,
        detail: passed
          ? "Expected structured value matched"
          : "Missing or incorrect structured value",
      });
    }
    if (!contract.allowAdditionalFields)
      observations.push({
        check: "additional_fields",
        passed: Object.keys(value).every((key) =>
          Object.hasOwn(contract.fields, key),
        ),
        detail: "Unexpected fields are rejected",
      });
    return {
      correct: observations.every((o) => o.passed),
      target,
      targetHash: fingerprint(bytes),
      observations,
    };
  } catch (error) {
    observations.push({
      check: "record",
      passed: false,
      detail: (error as Error).message.slice(0, 400),
    });
    return { correct: false, target, observations };
  }
}
export async function checkPredicates(
  root: string,
  predicates: ApplicabilityPredicate[],
  inputs: Record<string, Json>,
): Promise<string[]> {
  const failures: string[] = [];
  for (const p of predicates) {
    try {
      const relative = String(resolveBinding({ $template: p.path }, inputs));
      if (p.kind === "file_exists") {
        if (!(await lstat(await procedurePath(root, relative))).isFile())
          throw new Error("Required file missing");
      } else {
        const bytes = await boundedFile(root, relative);
        if (p.kind === "file_contains") {
          if (
            typeof p.value !== "string" ||
            !bytes.toString("utf8").includes(p.value)
          )
            throw new Error("Required source predicate no longer holds");
        } else if (p.kind === "json_equals") {
          let value: unknown = JSON.parse(bytes.toString("utf8"));
          for (const token of (p.pointer ?? "").split("/").slice(1)) {
            const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
            if (
              !value ||
              typeof value !== "object" ||
              !Object.hasOwn(value, key)
            )
              throw new Error("JSON predicate path missing");
            value = (value as Record<string, unknown>)[key];
          }
          if (stableJson(value) !== stableJson(p.value))
            throw new Error("Required JSON predicate no longer holds");
        } else throw new Error("Unsupported applicability predicate");
      }
    } catch (error) {
      failures.push(`${p.path}: ${(error as Error).message.slice(0, 250)}`);
    }
  }
  return failures;
}
/** First supported family deliberately limits effects to its one parameterized
 * record. Extending families requires a host verifier, not a stored validator. */
export function validateRecordProcedure(
  version: ProcedureVersion,
  contract: JsonRecordContract,
) {
  if (
    version.taskFamily !== "json-record" ||
    version.parameters.some(
      (p) => p.type !== "string" || p.pattern !== "identifier",
    )
  )
    throw new Error("Unsupported procedure task family or parameter type");
  const required = new Set([
    contract.filenameParameter,
    ...Object.values(contract.fields).flatMap((rule) =>
      "parameter" in rule ? [rule.parameter] : [],
    ),
  ]);
  if (
    version.parameters.length !== required.size ||
    version.parameters.some((p) => !required.has(p.name))
  )
    throw new Error("Parameters must match the trusted contract");
  const writes = version.steps.filter((step) => step.tool === "write_file");
  if (
    writes.length !== 1 ||
    version.steps.some(
      (step) => !["read_file", "write_file"].includes(step.tool),
    )
  )
    throw new Error(
      "JSON-record procedures may read evidence and write exactly one record; arbitrary generated commands are not executable validators",
    );
  for (const step of version.steps.filter(
    (step) => step.tool === "read_file",
  )) {
    if (typeof step.args.path !== "string")
      throw new Error("Read dependencies must be explicit workspace paths");
    relativePath(step.args.path);
    if (
      !version.dependencies.some(
        (d) => d.kind === "file" && d.target === step.args.path,
      )
    )
      throw new Error("Read step has no declared dependency");
  }
  const write = writes[0]!,
    template = `${contract.directory}/{{${contract.filenameParameter}}}.json`;
  if (
    stableJson(write.args.path) !== stableJson({ $template: template }) ||
    write.args.mode !== "create"
  )
    throw new Error(
      "Record destination must be parameterized, new, and match the trusted contract",
    );
  const expected = Object.fromEntries(
    Object.entries(contract.fields).map(([field, rule]) => [
      field,
      "parameter" in rule ? { $param: rule.parameter } : rule.constant,
    ]),
  );
  if (stableJson(write.args.content) !== stableJson({ $json: expected }))
    throw new Error(
      "Record content must parameterize every task-specific contract value",
    );
  // This also validates complete input binding declarations without performing work.
  bindInputs(
    version,
    Object.fromEntries(version.parameters.map((p) => [p.name, "probe"])),
  );
}
