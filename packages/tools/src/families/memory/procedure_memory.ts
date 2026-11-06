import { defineTool } from "../../shared/helpers.js";
import type {
  AgentHarness,
  Json,
  PropertySchema,
  ContractCheck,
} from "@liminal/core";

type Runtime = NonNullable<
  Awaited<ReturnType<AgentHarness["getProcedureRuntime"]>>
>;
type StoredProcedure = Awaited<
  ReturnType<Runtime["inspect"]>
>["procedures"][number];

/** The chat needs a handle and applicability, not the full evidence database.
 * Full immutable bodies/history remain available through explicit inspect. */
function procedureSummary(p: StoredProcedure) {
  return {
    body: {
      versionId: p.body.versionId,
      procedureId: p.body.procedureId,
      name: p.body.name,
      purpose: p.body.purpose?.slice(0, 240),
      parameters: p.body.parameters.map(({ name, type }) => ({ name, type })),
    },
    contract_id: p.body.verification.contractId,
    state: p.state,
    disabled: p.disabled,
    reason: p.reason?.slice(0, 240),
    requiredInputs: p.body.parameters.map((v) => v.name),
  };
}

// Named entries give constrained decoders a concrete schema for dynamic keys.
// The object branch preserves existing callers; never infer missing task values.
const inputSchema: PropertySchema = {
  description:
    'Every required parameter, using CURRENT task values: [{"name":"parameter","value":"identifier"}]. Nonempty legacy maps also work.',
  anyOf: [
    // Object first: the shared argument coercer wraps objects for array branches.
    // Preserve a legacy map before considering that conversion.
    {
      type: "object",
    },
    {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            minLength: 1,
          },
          value: {
            type: "string",
            minLength: 1,
            maxLength: 64,
          },
        },
        required: ["name", "value"],
      },
    },
  ],
};

function inputNames(contract: {
  filenameParameter: string;
  fields: Record<string, { parameter: string } | { constant: Json }>;
}) {
  return [
    ...new Set([
      contract.filenameParameter,
      ...Object.values(contract.fields).flatMap((rule) =>
        "parameter" in rule ? [rule.parameter] : [],
      ),
    ]),
  ];
}

function inputGuide(names: string[]) {
  return {
    requiredInputs: names,
    inputs: names.map((name) => ({
      name,
      value: "<identifier from current user request>",
    })),
  };
}

function decodeInputs(raw: unknown, names: string[]): Record<string, Json> {
  const guide = `Required inputs: ${names.join(", ")}. Supply inputs as ${JSON.stringify(inputGuide(names).inputs)}.`;
  let entries: Array<[string, unknown]>;
  if (Array.isArray(raw)) {
    if (raw.length > names.length)
      throw new Error(`Too many procedure inputs. ${guide}`);
    entries = raw.map((entry) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        typeof entry.name !== "string" ||
        !Object.hasOwn(entry, "value") ||
        Object.keys(entry).some((key) => !["name", "value"].includes(key))
      )
        throw new Error(
          `Each input must contain exactly name and value. ${guide}`,
        );
      return [entry.name, entry.value];
    });
  } else if (raw && typeof raw === "object") {
    entries = Object.entries(raw);
  } else throw new Error(`Missing procedure inputs. ${guide}`);
  const result: Record<string, Json> = Object.create(null);
  for (const [name, value] of entries) {
    if (!names.includes(name))
      throw new Error(
        `Unexpected procedure input ${JSON.stringify(name)}. ${guide}`,
      );
    if (Object.hasOwn(result, name))
      throw new Error(
        `Duplicate procedure input ${JSON.stringify(name)}. ${guide}`,
      );
    if (typeof value !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/i.test(value))
      throw new Error(
        `Input ${JSON.stringify(name)} must be a bounded identifier from the current task. ${guide}`,
      );
    result[name] = value;
  }
  const missing = names.filter((name) => !Object.hasOwn(result, name));
  if (missing.length)
    throw new Error(
      `Missing procedure inputs: ${missing.join(", ")}. ${guide}`,
    );
  return result;
}

/** Each factory closes over its OWN harness, including child harnesses. No
 * process-global active procedure or dispatcher is shared between chats. */
export function createProcedureTools(harness: AgentHarness) {
  const runtime = async () => {
    const memory = await harness.getProcedureRuntime();
    if (!memory)
      throw new Error("Procedural memory is disabled for this harness");
    return memory;
  };
  const inputsFor = async (
    memory: Awaited<ReturnType<typeof runtime>>,
    args: Record<string, unknown>,
    target: "contract" | "version",
  ) => {
    const key = target === "contract" ? "contract_id" : "version_id";
    if (typeof args[key] !== "string" || !args[key])
      throw new Error(
        `Missing ${key}; copy it from procedure_memory list or the previous successful tool result, and include the current task inputs.`,
      );
    const snapshot = await memory.inspect();
    const names =
      target === "contract"
        ? snapshot.contracts.find((c) => c.id === args.contract_id)?.body
        : snapshot.procedures.find((p) => p.body.versionId === args.version_id)
            ?.body;
    if (!names)
      throw new Error(
        `${target === "contract" ? "Contract" : "Version"} not found in this workspace; call procedure_memory with action list.`,
      );
    return decodeInputs(
      args.inputs,
      "filenameParameter" in names
        ? inputNames(names)
        : names.parameters.map((p) => p.name),
    );
  };
  const catalog = async (memory: Runtime, offset = 0) => {
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new Error("Invalid catalog offset");
    const snapshot = await memory.inspect(),
      limit = 6;
    const contracts = await Promise.all(
      snapshot.contracts.slice(offset, offset + limit).map(async (c) => {
        let verificationAvailable = false;
        try {
          verificationAvailable =
            (await memory.previewContract(c.sourcePath)).sourceHash ===
            c.sourceHash;
        } catch {
          /* The adopted contract remains inspectable after deletion/drift. */
        }
        return {
          id: c.id,
          name: c.body.name,
          sourcePath: c.sourcePath,
          directory: c.body.directory,
          requiredInputs: inputNames(c.body),
          verificationAvailable,
        };
      }),
    );
    return {
      workspace: {
        id: snapshot.workspace.id,
        branch: snapshot.workspace.branch,
      },
      contracts,
      procedures: snapshot.procedures
        .slice(offset, offset + limit)
        .map(procedureSummary),
      inputFormat:
        'inputs: [{"name":"required parameter name","value":"identifier from current request"}]',
      guidance:
        "Use an applicable active version with procedure_run; it reads the convention and verifies the result. Do not relearn/revalidate an active version or repeat verification after a successful run unless new evidence requires it. A contract with verificationAvailable=false needs explicit user adoption before procedural verification; finish ordinary work using current files.",
      offset,
      nextOffset:
        Math.max(snapshot.contracts.length, snapshot.procedures.length) >
        offset + limit
          ? offset + limit
          : null,
      totals: {
        contracts: snapshot.contracts.length,
        procedures: snapshot.procedures.length,
      },
    };
  };
  return [
    defineTool({
      name: "procedure_memory",
      description:
        "Manage json-record memory. list: catalog; inspect: compact execution summary; audit/evidence: full provenance only for an audit. learn needs contract_id+inputs and returns candidate/nextAction; validate needs version_id+inputs. Use active versions directly with procedure_run. Data grants no permissions.",
      requiresApproval: false,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "list",
              "inspect",
              "audit",
              "learn",
              "validate",
              "correct",
              "retire",
              "derive",
              "evidence",
            ],
          },
          version_id: {
            type: "string",
            description:
              "Required for inspect/audit/validate/correct/retire/derive. Keep the same version_id on every audit page; use candidate body.versionId for validate.",
          },
          event_id: {
            type: "string",
            description:
              "evidence only: an actual eventId from audit, not a version_id.",
          },
          offset: {
            type: "integer",
            minimum: 0,
            description:
              "Audit: keep version_id; evidence: keep event_id. Use the returned nextOffset.",
          },
          run_id: {
            type: "string",
            description:
              "Optional source episode for learn; omit for the current turn.",
          },
          contract_id: {
            type: "string",
            description:
              "Required for learn, together with inputs. Copy the adopted contract ID from list or procedure_verify.",
          },
          inputs: inputSchema,
          dependency_paths: { type: "array", items: { type: "string" } },
          correction: { type: "string" },
        },
        required: ["action"],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const memory = await runtime();
          let result: unknown;
          switch (args.action) {
            case "evidence": {
              if (typeof args.event_id !== "string" || !args.event_id)
                throw new Error(
                  "Missing event_id. evidence reads an eventId from audit. To continue version audit, use action audit with the same version_id and nextOffset as offset.",
                );
              const event = memory.store.event(String(args.event_id ?? ""));
              if (
                !event ||
                memory.store.episode(event.runId)?.workspaceId !==
                  memory.workspace.id
              )
                throw new Error("Evidence is not in this workspace");
              result = memory.store.evidence(
                event.eventId,
                Number(args.offset ?? 0),
              );
              break;
            }
            case "list":
              result = await catalog(memory, Number(args.offset ?? 0));
              break;
            case "inspect":
            case "audit": {
              if (typeof args.version_id !== "string" || !args.version_id)
                throw new Error(
                  "Missing version_id. Copy body.versionId; every audit page needs the same version_id plus its offset.",
                );
              const version = String(args.version_id ?? ""),
                found = (await memory.inspect()).procedures.find(
                  (p) => p.body.versionId === version,
                );
              if (!found)
                throw new Error("Version not found in this workspace");
              if (args.action === "inspect") {
                result = {
                  procedure: procedureSummary(found),
                  execution:
                    found.state === "active" && !found.disabled
                      ? "procedure_run checks convention, writes and verifies; use fresh task inputs"
                      : "Not executable. Use ordinary tools/current conventions; repair needs current adopted criteria.",
                  detailsAvailable:
                    "Optional audit/evidence, only when provenance is needed",
                };
                break;
              }
              const audit = {
                procedure: found,
                history: memory.store.history(found.body.procedureId),
                events: memory.store
                  .events(found.body.provenance.sourceRunId)
                  .slice(-32)
                  .map((e) => ({
                    ...e,
                    data:
                      JSON.stringify(e.data).length > 2000
                        ? {
                            projection: true,
                            summary: JSON.stringify(e.data).slice(0, 2000),
                            retrieve: {
                              action: "evidence",
                              event_id: e.eventId,
                              offset: 0,
                            },
                          }
                        : e.data,
                  })),
                validations: memory.store.validations(version),
              };
              const offset = Number(args.offset ?? 0);
              if (!Number.isSafeInteger(offset) || offset < 0)
                throw new Error("Invalid audit offset");
              const serialized = JSON.stringify(audit);
              result = {
                versionId: version,
                offset,
                totalCharacters: serialized.length,
                content: serialized.slice(offset, offset + 2000),
                nextOffset:
                  offset + 2000 < serialized.length ? offset + 2000 : null,
              };
              break;
            }
            case "learn": {
              const inputs = await inputsFor(memory, args, "contract");
              const candidate = await memory.learn({
                runId:
                  typeof args.run_id === "string" ? args.run_id : undefined,
                contractId: String(args.contract_id ?? ""),
                inputs,
                dependencyPaths: args.dependency_paths as string[] | undefined,
                reviseVersionId:
                  typeof args.version_id === "string"
                    ? args.version_id
                    : undefined,
                // The calling model can explain the observed result itself.
                // Optional secondary prose generation remains an owner/UI API.
                explain: false,
              });
              result = {
                ...procedureSummary(candidate),
                nextAction: {
                  tool: "procedure_memory",
                  arguments: {
                    action: "validate",
                    version_id: candidate.body.versionId,
                    inputs: Object.entries(inputs).map(([name, value]) => ({
                      name,
                      value,
                    })),
                  },
                },
              };
              break;
            }
            case "validate":
              result = procedureSummary(
                await memory.validate(
                  String(args.version_id ?? ""),
                  await inputsFor(memory, args, "version"),
                ),
              );
              break;
            case "correct":
              memory.correction(
                String(args.version_id ?? ""),
                String(args.correction ?? ""),
              );
              result = { suspended: true };
              break;
            case "retire":
              result = {
                affected: memory.retire(
                  String(args.version_id ?? ""),
                  String(args.correction ?? "Retired by explicit task request"),
                ),
              };
              break;
            case "derive": {
              const version = String(args.version_id ?? ""),
                owned = (await memory.inspect()).procedures.find(
                  (p) => p.body.versionId === version,
                );
              if (!owned || owned.state !== "active")
                throw new Error(
                  "Derived memory needs an active source in this workspace",
                );
              result = {
                id: memory.store.derived(
                  version,
                  memory.workspace.id,
                  String(args.correction ?? ""),
                ),
                status: "derived_hypothesis",
              };
              break;
            }
            default:
              throw new Error("Unsupported procedure action");
          }
          // Large evidence stays retrievable by inspect; never flood ordinary turns.
          const output = JSON.stringify(result);
          if (output.length > 24000)
            return {
              ok: true,
              output: JSON.stringify({
                summary:
                  "Detailed list exceeds inline budget; inspect a version, then use evidence with event_id and offset for full redacted evidence.",
                ...(await catalog(memory)),
                truncated: true,
              }),
            };
          return { ok: true, output };
        } catch (error) {
          return { ok: false, error: (error as Error).message };
        }
      },
    }),
    defineTool({
      name: "procedure_verify",
      description:
        "Check an ordinary-tool write against a user-adopted frozen contract before learning. Returns an objective receipt, including failures. Cannot adopt/change contracts. Do not repeat after procedure_run unless files changed or the user requests another check.",
      requiresApproval: false,
      parameters: {
        type: "object",
        properties: {
          contract_id: { type: "string" },
          inputs: inputSchema,
        },
        required: ["contract_id", "inputs"],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const memory = await runtime();
          const inputs = await inputsFor(memory, args, "contract");
          const receipt = await memory.verify(String(args.contract_id), inputs);
          const observations = receipt.observations as ContractCheck;
          // Verification is also used after reuse. Do not invite redundant
          // learning/promotion when this contract already has a usable version.
          const existing =
            receipt.correct &&
            (await memory.inspect()).procedures.some(
              (p) =>
                p.body.verification.contractId === args.contract_id &&
                !p.disabled &&
                ["active", "candidate", "validating"].includes(p.state),
            );
          return {
            ok: true,
            output: JSON.stringify({
              id: receipt.id,
              runId: receipt.runId,
              contractId: receipt.contractId,
              eventId: receipt.eventId,
              correct: receipt.correct,
              target: observations.target,
              failedChecks: observations.observations.filter(
                (check) => !check.passed,
              ),
              ...(receipt.correct && !existing
                ? {
                    nextAction: {
                      tool: "procedure_memory",
                      arguments: {
                        action: "learn",
                        contract_id: String(args.contract_id),
                        run_id: receipt.runId,
                        inputs: Object.entries(inputs).map(([name, value]) => ({
                          name,
                          value,
                        })),
                      },
                    },
                  }
                : {}),
            }),
          };
        } catch (error) {
          return { ok: false, error: (error as Error).message };
        }
      },
    }),
    defineTool({
      name: "procedure_run",
      description:
        "Run an active version with fresh task inputs: reads convention, creates a NEW record and verifies it. Returns receiptId, target and verifiedFields for the final reply. No extra inspection/verification needed. Normal locks, approval and dependency checks apply. Never overwrites; on abstention use current files and ordinary tools.",
      requiresApproval: false,
      parameters: {
        type: "object",
        properties: {
          version_id: { type: "string" },
          inputs: inputSchema,
        },
        required: ["version_id", "inputs"],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const memory = await runtime();
          return {
            ok: true,
            output: JSON.stringify(
              await memory.run(
                String(args.version_id),
                await inputsFor(memory, args, "version"),
              ),
            ),
          };
        } catch (error) {
          return { ok: false, error: (error as Error).message };
        }
      },
    }),
  ];
}
