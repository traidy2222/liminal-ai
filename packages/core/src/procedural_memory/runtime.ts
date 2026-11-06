import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { existsSync } from "node:fs";
import { lstat } from "node:fs/promises";
import type { AgentEmitter } from "../events.js";
import type { ToolRegistry } from "../registry.js";
import type { ToolResult } from "../types.js";
import { rankDocumentsForQuery } from "../memory_rank.js";
import { globalPath } from "../global_storage.js";
import {
  ProcedureStore,
  type StoredProcedure,
  type EpisodeEvent,
  type ValidationReceipt,
  type TrustedContract,
} from "./store.js";
import {
  fingerprint,
  newId,
  stableJson,
  validateContract,
  validateProcedure,
  bindInputs,
  resolveBinding,
  relativePath,
  type ProcedureVersion,
  type Json,
  type ProcedureSelection,
  type ProcedureActivity,
} from "./model.js";
import {
  identifyProcedureWorkspace,
  boundedFile,
  procedurePath,
  type ProcedureWorkspace,
} from "./workspace.js";
import {
  verifyJsonRecord,
  validateRecordProcedure,
  checkPredicates,
  recordTarget,
} from "./validation.js";

export interface ProcedureRuntimeOptions {
  workspaceRoot: string;
  databasePath?: string;
  registry: ToolRegistry;
  emitter: AgentEmitter;
  chatId: string;
  dispatch: (callId: string, name: string, args: string) => Promise<ToolResult>;
  model: string;
  harnessVersion: string;
  consolidate?: boolean;
  /** Optional bounded explanation generation through the harness's existing router. */
  explain?: (evidence: string) => Promise<{
    name?: string;
    purpose?: string;
    explanation?: string;
    model: string;
  }>;
}
const execution = new AsyncLocalStorage<{
  runtime: ProcedureRuntime;
  selection: ProcedureSelection;
  inputs: Record<string, Json>;
  effectStarted: boolean;
}>();
function redact(value: unknown, depth = 0): unknown {
  if (depth > 32) return "[projection omitted: nesting limit]";
  if (typeof value === "string") {
    // JSON carried inside write_file.content is still structured secret data.
    if (/^[\s]*[\[{]/.test(value)) {
      try {
        return JSON.stringify(redact(JSON.parse(value), depth + 1));
      } catch {}
    }
    return value.replace(
      /(?:sk-(?:or-v1-|proj-)?[a-z0-9-]{16,}|Bearer\s+\S+)/gi,
      "[redacted]",
    );
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /password|secret|token|api.?key|authorization|cookie/i.test(key)
          ? "[redacted]"
          : redact(item, depth + 1),
      ]),
    );
  return value;
}
export class ProcedureRuntime {
  readonly store: ProcedureStore;
  workspace!: ProcedureWorkspace;
  private runId?: string;
  private taskRevision = 0;
  private closed = false;
  private eventQueue: Promise<void> = Promise.resolve();
  private readonly detach: () => void;
  private executing = false;
  private invalidated = false;
  private evidenceUnavailable = false;
  private managing = false;
  private turnSuspensions: Array<{
    versionId: string;
    contractId: string;
    reason: string;
  }> = [];
  private readonly callOrigins = new Map<
    string,
    { runId: string; revision: number } | null
  >();
  private constructor(private readonly options: ProcedureRuntimeOptions) {
    this.store = new ProcedureStore(
      options.databasePath ?? ProcedureRuntime.defaultPath(),
    );
    const started = (event: { callId: string }) => {
      if (!this.runId) return;
      const prior = this.callOrigins.get(event.callId);
      this.callOrigins.set(
        event.callId,
        prior && prior.runId !== this.runId
          ? null
          : { runId: this.runId, revision: this.taskRevision },
      );
      if (this.callOrigins.size > 2048)
        this.callOrigins.delete(this.callOrigins.keys().next().value!);
    };
    const listener = (event: {
      name: string;
      args: Record<string, unknown>;
      result: ToolResult;
      callId: string;
    }) => {
      const origin = this.callOrigins.get(event.callId);
      if (!origin || event.name.startsWith("procedure_")) return;
      const { runId, revision } = origin;
      // Capture the originating run now. A late result never acquires the next
      // turn's revision or promotes a procedure; only a verifier can do that.
      const row: EpisodeEvent = {
        eventId: newId(),
        runId,
        kind: "tool_result",
        callId: event.callId,
        tool: event.name,
        ok: event.result.ok,
        data: redact({
          args: event.args,
          result: event.result,
          taskRevision: revision,
        }),
      };
      try {
        this.store.recordEvent(row);
      } catch (error) {
        this.evidenceUnavailable = true;
        this.activity(
          "error",
          "Procedure evidence unavailable",
          (error as Error).message,
        );
        return;
      }
      if (
        event.result.ok &&
        runId === this.runId &&
        revision === this.taskRevision
      ) {
        const changed = Object.values(event.args).filter(
          (v) => typeof v === "string" && v.length < 1024,
        ) as string[];
        if (
          [
            "write_file",
            "edit_file",
            "move_file",
            "delete_file",
            "multi_file_apply",
            "run_shell",
            "execute_code",
          ].includes(event.name)
        )
          this.eventQueue = this.eventQueue
            .then(() => this.recheckChangedPaths(changed))
            .catch((error) =>
              this.activity(
                "error",
                "Procedure check",
                String((error as Error).message),
              ),
            );
      }
    };
    options.emitter.on("tool_start", started);
    options.emitter.on("tool_result", listener);
    this.detach = () => {
      options.emitter.off("tool_start", started);
      options.emitter.off("tool_result", listener);
    };
  }
  static defaultPath() {
    return globalPath("procedures", "procedures.sqlite");
  }
  static exists(filename?: string) {
    return existsSync(filename ?? this.defaultPath());
  }
  static async open(options: ProcedureRuntimeOptions) {
    const runtime = new ProcedureRuntime(options);
    try {
      runtime.workspace = await identifyProcedureWorkspace(
        options.workspaceRoot,
      );
      runtime.store.registerWorkspace(runtime.workspace.id, runtime.workspace);
      return runtime;
    } catch (error) {
      runtime.close();
      throw error;
    }
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      this.detach();
      this.store.close();
    }
  }
  private activity(
    action: ProcedureActivity["action"],
    name: string,
    reason: string,
    procedure?: StoredProcedure,
  ) {
    this.options.emitter.emit("procedure_activity", {
      action,
      name: name.slice(0, 160),
      reason: reason.slice(0, 600),
      ...(procedure
        ? {
            procedureId: procedure.body.procedureId,
            versionId: procedure.body.versionId,
            state: procedure.state,
          }
        : {}),
      ...(this.runId ? { runId: this.runId } : {}),
    });
  }
  async beginTurn(goal: string, traceId: string) {
    await this.eventQueue;
    this.turnSuspensions = [];
    this.workspace = await identifyProcedureWorkspace(
      this.options.workspaceRoot,
    );
    this.store.registerWorkspace(this.workspace.id, this.workspace);
    // Merely opening the shared database in another project does not opt that
    // project's conversations into evidence capture.
    if (!this.store.contracts(this.workspace.id).length) return [];
    this.invalidated = false;
    this.evidenceUnavailable = false;
    this.runId = traceId;
    this.taskRevision++;
    this.store.beginEpisode({
      runId: traceId,
      workspaceId: this.workspace.id,
      chatId: this.options.chatId,
      taskRevision: this.taskRevision,
      goal: String(redact(goal)),
      model: this.options.model,
      harness: this.options.harnessVersion,
      environment: {
        node: process.version,
        platform: process.platform,
        branch: this.workspace.branch ?? "(detached/no-git)",
      },
    });
    return this.retrieve(goal);
  }
  async finishTurn(reason: string) {
    await this.eventQueue;
    if (this.runId && this.options.consolidate && reason !== "user_management")
      await this.consolidate();
    if (this.runId) this.store.finishEpisode(this.runId, reason);
    this.runId = undefined;
    this.taskRevision++;
  }
  /** User changes / Stop invalidate approvals and delayed completions immediately. */
  invalidateTask() {
    this.taskRevision++;
    this.invalidated = true;
  }
  private requireTurn() {
    if (this.evidenceUnavailable)
      throw new Error(
        "Procedure evidence capture failed; ordinary tools remain usable, but procedural learning/effects require a fresh healthy turn",
      );
    if (this.invalidated)
      throw new Error(
        "Task changed; wait for a new accepted user turn before procedural learning or effects",
      );
    if (!this.runId)
      throw new Error("Procedural learning/execution needs an active task");
    return { runId: this.runId, revision: this.taskRevision };
  }
  /** Opt-in end-of-turn consolidation: at most one candidate, no LLM call,
   * no automatic activation, and a cross-process expiring claim. */
  async consolidate() {
    if (!this.runId) return;
    const receipt = this.store
      .validations(undefined, this.runId)
      .find((r) => r.correct && !r.versionId);
    if (!receipt) return;
    // A normal post-run verification must not grow another candidate for the
    // same canonical record workflow on every turn. Stale/disabled versions do
    // not qualify, and the receipt above still proves this turn's actual file.
    for (const row of this.store.list(this.workspace.id))
      if (
        row.state === "active" &&
        !row.disabled &&
        row.body.verification.contractId === receipt.contractId &&
        !(await this.recheck(row.body.versionId)).length
      )
        return;
    const key =
        receipt.runId + ":" + receipt.contractId + ":" + receipt.inputHash,
      owner = newId();
    if (!this.store.claimConsolidation(key, owner)) return;
    try {
      const data = this.store.event(receipt.eventId)?.data as {
        inputs?: Record<string, Json>;
      };
      if (!data.inputs) throw new Error("No parameter evidence");
      const existing = this.store
        .list(this.workspace.id)
        .find(
          (p) =>
            p.body.provenance.sourceRunId === receipt.runId &&
            p.body.verification.contractId === receipt.contractId,
        );
      const candidate =
        existing ??
        (await this.learn({
          runId: receipt.runId,
          contractId: receipt.contractId,
          inputs: data.inputs,
        }));
      this.store.completeConsolidation(key, owner, candidate.body.versionId);
    } catch (error) {
      this.activity("error", "Consolidation skipped", (error as Error).message);
    }
  }
  async previewContract(sourcePath: string) {
    const relative = relativePath(sourcePath),
      bytes = await boundedFile(this.workspace.root, relative, 16000);
    return {
      sourcePath: relative,
      sourceHash: fingerprint(bytes),
      body: validateContract(JSON.parse(bytes.toString("utf8"))),
    };
  }
  async adoptContract(
    sourcePath: string,
    expectedSourceHash?: string,
  ): Promise<TrustedContract> {
    const relative = relativePath(sourcePath),
      bytes = await boundedFile(this.workspace.root, relative, 16000),
      body = validateContract(JSON.parse(bytes.toString("utf8")));
    if (expectedSourceHash && expectedSourceHash !== fingerprint(bytes))
      throw new Error(
        "Verifier file changed since preview; inspect the current checks before adopting",
      );
    const contract = {
      id: newId(),
      workspaceId: this.workspace.id,
      sourcePath: relative,
      sourceHash: fingerprint(bytes),
      body,
      createdAt: new Date().toISOString(),
    };
    this.store.registerContract(contract);
    return contract;
  }
  private async currentContract(id: string) {
    const contract = this.store.contract(id);
    if (!contract || contract.workspaceId !== this.workspace.id)
      throw new Error("Trusted contract belongs to another workspace");
    const bytes = await boundedFile(
      this.workspace.root,
      contract.sourcePath,
      16000,
    );
    if (
      stableJson(validateContract(JSON.parse(bytes.toString("utf8")))) !==
      stableJson(contract.body)
    )
      throw new Error(
        `Validation convention changed: ${contract.sourcePath}. A user must adopt the revised contract before repairing the procedure.`,
      );
    return contract;
  }
  async verify(
    contractId: string,
    inputs: Record<string, Json>,
    versionId?: string,
  ): Promise<ValidationReceipt> {
    const token = this.requireTurn(),
      contract = await this.currentContract(contractId),
      result = await verifyJsonRecord(
        this.workspace.root,
        contract.body,
        inputs,
      );
    if (token.revision !== this.taskRevision || token.runId !== this.runId)
      throw new Error("Task changed during validation");
    const eventId = newId(),
      receipt: ValidationReceipt = {
        id: newId(),
        versionId,
        runId: token.runId,
        workspaceId: this.workspace.id,
        contractId,
        taskRevision: token.revision,
        inputHash: fingerprint(stableJson(inputs)),
        correct: result.correct,
        observations: result,
        eventId,
        targetHash: result.targetHash,
      };
    this.store.recordEvent({
      eventId,
      runId: token.runId,
      kind: "verification",
      ok: result.correct,
      data: { contractId, inputHash: receipt.inputHash, inputs, ...result },
    });
    if (!versionId) this.store.recordValidation(receipt);
    return receipt;
  }
  correction(versionId: string, text: string) {
    const token = this.requireTurn(),
      current = this.owned(versionId);
    if (!text.trim() || text.length > 2000)
      throw new Error("Correction must contain 1..2000 characters");
    this.store.recordEvent({
      eventId: newId(),
      runId: token.runId,
      kind: "correction",
      data: { versionId, text: redact(text) },
    });
    this.store.suspendCascade(
      versionId,
      "User correction: " + String(redact(text)),
    );
    this.activity(
      "suspended",
      current.body.name,
      "User correction requires new evidence",
      this.store.get(versionId),
    );
  }
  private owned(id: string) {
    const current = this.store.get(id);
    if (!current || current.body.scope.workspaceId !== this.workspace.id)
      throw new Error("Procedure is not in this workspace/branch");
    return current;
  }
  async learn(input: {
    runId?: string;
    contractId: string;
    inputs: Record<string, Json>;
    dependencyPaths?: string[];
    reviseVersionId?: string;
    explain?: boolean;
  }) {
    const turn = this.requireTurn(),
      sourceRun = input.runId ?? turn.runId,
      episode = this.store.episode(sourceRun),
      contract = await this.currentContract(input.contractId);
    if (episode?.workspaceId !== this.workspace.id)
      throw new Error(
        "Cannot learn an operational procedure from another workspace",
      );
    const receipt = this.store
      .validations(undefined, sourceRun)
      .find(
        (r) =>
          r.correct &&
          r.contractId === input.contractId &&
          r.inputHash === fingerprint(stableJson(input.inputs)),
      );
    if (!receipt)
      throw new Error(
        "No objective successful result for these inputs; tool success and praise cannot validate a procedure",
      );
    const events = this.store.events(sourceRun),
      success = events
        .filter(
          (e) =>
            e.tool === "write_file" &&
            e.ok &&
            e.sequence! < this.store.event(receipt.eventId)!.sequence!,
        )
        .reverse()
        .find((e) => {
          const data = e.data as { args?: Record<string, unknown> };
          const target = String(data.args?.path);
          return (
            (path.isAbsolute(target)
              ? path.relative(this.workspace.root, target)
              : target
            ).replaceAll("\\", "/") ===
            recordTarget(contract.body, input.inputs)
          );
        });
    if (!success)
      throw new Error("Episode does not contain the successful record write");
    const observed = (success.data as { args: Record<string, unknown> }).args;
    let written: unknown;
    try {
      written = JSON.parse(String(observed.content));
    } catch {
      throw new Error("Successful write has no inspectable structured content");
    }
    const expected = Object.fromEntries(
      Object.entries(contract.body.fields).map(([field, rule]) => [
        field,
        "parameter" in rule ? input.inputs[rule.parameter] : rule.constant,
      ]),
    );
    if (stableJson(written) !== stableJson(expected))
      throw new Error(
        "Written content does not support the proposed parameterization",
      );
    const paths = [
      ...new Set([contract.sourcePath, ...(input.dependencyPaths ?? [])]),
    ];
    if (paths.length > 16) throw new Error("Too many file dependencies");
    const dependencies = [];
    for (const file of paths) {
      const relative = relativePath(file);
      dependencies.push({
        key: "file:" + relative,
        kind: "file" as const,
        target: relative,
        fingerprint: fingerprint(
          await boundedFile(this.workspace.root, relative),
        ),
      });
    }
    for (const tool of ["read_file", "write_file"]) {
      const definition = this.options.registry.get(tool);
      if (!definition) throw new Error(`Required tool unavailable: ${tool}`);
      dependencies.push({
        key: "tool:" + tool,
        kind: "tool_schema" as const,
        target: tool,
        fingerprint: fingerprint(
          stableJson({
            parameters: definition.parameters,
            requiresApproval: definition.requiresApproval,
            dangerLevel: definition.dangerLevel ?? "safe",
            handlerSource: definition.handler.toString(),
          }),
        ),
      });
    }
    dependencies.push({
      key: "env:harness",
      kind: "environment" as const,
      target: "harness",
      fingerprint: fingerprint(this.options.harnessVersion),
    });
    dependencies.push({
      key: "env:node",
      kind: "environment" as const,
      target: "node_major",
      fingerprint: fingerprint(process.versions.node.split(".")[0]!),
    });
    dependencies.push({
      key: "env:platform",
      kind: "environment" as const,
      target: "platform",
      fingerprint: fingerprint(process.platform),
    });
    const prior = input.reviseVersionId
      ? this.owned(input.reviseVersionId)
      : undefined;
    if (
      prior &&
      !["needs_revalidation", "retired", "rejected"].includes(prior.state)
    )
      throw new Error(
        "Revise a suspended/retired procedure rather than overwriting an active version",
      );
    let explanation = {
      name: contract.body.name,
      purpose:
        "Create a development record using the adopted project convention.",
      explanation:
        "A failed/corrected attempt may precede the verified write. The episode supports this procedure under its recorded conditions; it does not prove a causal mechanism.",
      model: "deterministic contract parameterization",
    };
    if (input.explain && this.options.explain) {
      const summary = events.map((e) => ({
        eventId: e.eventId,
        kind: e.kind,
        tool: e.tool,
        ok: e.ok,
      }));
      const suggested = await this.options.explain(
        JSON.stringify({
          contract: contract.body,
          orderedEvents: summary,
          missingEvidence: [
            "General performance benefit has not been demonstrated",
          ],
        }),
      );
      for (const key of ["name", "purpose", "explanation", "model"] as const)
        if (typeof suggested[key] === "string")
          explanation[key] = suggested[key]!;
    }
    if (turn.revision !== this.taskRevision || turn.runId !== this.runId)
      throw new Error("Task changed while generating candidate");
    const parameterNames = [
      ...new Set([
        contract.body.filenameParameter,
        ...Object.values(contract.body.fields).flatMap((rule) =>
          "parameter" in rule ? [rule.parameter] : [],
        ),
      ]),
    ];
    const proposal: ProcedureVersion = {
      schemaVersion: 1,
      procedureId: prior?.body.procedureId ?? newId(),
      versionId: newId(),
      version: prior ? prior.body.version + 1 : 1,
      name: explanation.name,
      purpose: explanation.purpose,
      taskFamily: "json-record",
      parameters: parameterNames.map((name) => ({
        name,
        type: "string",
        description: `Task-specific ${name}`,
        pattern: "identifier",
      })),
      applicability: [
        {
          kind: "json_equals",
          path: contract.sourcePath,
          pointer: "/family",
          value: "json-record",
        },
      ],
      preconditions: [{ kind: "file_exists", path: contract.sourcePath }],
      postconditions: [
        {
          kind: "file_exists",
          path: `${contract.body.directory}/{{${contract.body.filenameParameter}}}.json`,
        },
      ],
      steps: [
        {
          id: "read-convention",
          tool: "read_file",
          args: { path: contract.sourcePath },
          purpose: "Inspect adopted convention before work",
        },
        {
          id: "create-record",
          tool: "write_file",
          args: {
            path: {
              $template: `${contract.body.directory}/{{${contract.body.filenameParameter}}}.json`,
            },
            content: {
              $json: Object.fromEntries(
                Object.entries(contract.body.fields).map(([field, rule]) => [
                  field,
                  "parameter" in rule
                    ? { $param: rule.parameter }
                    : rule.constant,
                ]),
              ),
            },
            mode: "create",
          },
          purpose: "Create exactly the requested parameterized record",
        },
      ],
      permissions: [
        "Existing read_file/write_file policy; memory grants no permission",
      ],
      sideEffects: [
        `Creates one new JSON record under ${contract.body.directory}`,
      ],
      negativeExamples: [
        "Do not overwrite an existing record",
        "Do not use after convention/schema changes without revalidation",
        "Do not use for another workspace or branch",
      ],
      evidence: events
        .filter((e) => {
          const data = e.data as {
            contractId?: string;
            args?: Record<string, unknown>;
          };
          const eventPath = String(data.args?.path ?? "");
          const normalized = (
            path.isAbsolute(eventPath)
              ? path.relative(this.workspace.root, eventPath)
              : eventPath
          ).replaceAll("\\", "/");
          return (
            e.kind === "correction" ||
            (e.kind === "verification" && data.contractId === contract.id) ||
            (e.tool === "write_file" &&
              normalized === recordTarget(contract.body, input.inputs)) ||
            (e.ok === false && normalized === contract.sourcePath)
          );
        })
        .slice(-32)
        .map((e) => ({
          runId: sourceRun,
          eventId: e.eventId,
          ...(e.callId ? { callId: e.callId } : {}),
          kind:
            e.kind === "verification"
              ? "verified_outcome"
              : e.kind === "correction"
                ? "correction"
                : "observation",
        })),
      dependencies,
      // Revision history is not an assumption dependency. A repaired version is
      // grounded in its own freshly verified episode and adopted contract.
      support: [],
      contradictions: [],
      assumptions: [
        "The adopted host verifier expresses this task family correctly",
      ],
      missingEvidence: [
        "Utility compared with no memory is unproven",
        "Only the recorded inputs and predicates have been validated",
      ],
      scope: { workspaceId: this.workspace.id, portability: "workspace_only" },
      provenance: {
        model: explanation.model,
        harness: this.options.harnessVersion,
        node: process.version,
        platform: process.platform,
        sourceRunId: sourceRun,
        sourceModel: episode.model,
        sourceHarness: episode.harness,
      },
      verification: { contractId: contract.id, method: "trusted_json_record" },
      explanation: { kind: "inferred", text: explanation.explanation },
      createdAt: new Date().toISOString(),
    };
    validateRecordProcedure(validateProcedure(proposal), contract.body);
    this.store.putCandidate(proposal);
    this.activity(
      prior ? "revised" : "learned",
      proposal.name,
      "Candidate grounded in ordered episode and objective outcome; awaiting validation",
      this.store.get(proposal.versionId),
    );
    return this.store.get(proposal.versionId)!;
  }
  async validate(versionId: string, inputs: Record<string, unknown>) {
    const token = this.requireTurn(),
      current = this.owned(versionId),
      bound = bindInputs(current.body, inputs),
      contract = await this.currentContract(
        current.body.verification.contractId,
      );
    validateRecordProcedure(current.body, contract.body);
    if (!["candidate", "needs_revalidation"].includes(current.state))
      throw new Error("Only candidate/suspended versions may enter validation");
    const running = this.store.transition(
      versionId,
      current.revision,
      "validating",
      "Checking objective contract and current predicates",
    );
    try {
      const observed = await this.observeDependencies(current.body),
        failures = await checkPredicates(
          this.workspace.root,
          [...current.body.applicability, ...current.body.preconditions],
          bound,
        );
      if (failures.length) throw new Error(failures.join("; "));
      const receipt = await this.verify(contract.id, bound, versionId);
      if (!receipt.correct)
        throw new Error(
          "Objective outcome did not satisfy the adopted contract",
        );
      if (
        token.revision !== this.taskRevision ||
        token.runId !== this.runId ||
        stableJson(observed) !==
          stableJson(await this.observeDependencies(current.body))
      )
        throw new Error("Task or dependencies changed during validation");
      const confirmed = await verifyJsonRecord(
        this.workspace.root,
        contract.body,
        bound,
      );
      if (!confirmed.correct || confirmed.targetHash !== receipt.targetHash)
        throw new Error("Outcome changed during validation");
      const active = this.store.promote(
        versionId,
        running.revision,
        receipt,
        observed,
      );
      if (active.state !== "active")
        throw new Error(
          "Conflicting procedures require user resolution; neither is active advice",
        );
      this.activity(
        "validated",
        active.body.name,
        "Objective outcome and applicability checks passed for recorded inputs",
        active,
      );
      return active;
    } catch (error) {
      const latest = this.store.get(versionId);
      if (
        latest?.state === "validating" &&
        latest.revision === running.revision
      )
        this.store.transition(
          versionId,
          latest.revision,
          "needs_revalidation",
          (error as Error).message,
        );
      throw error;
    }
  }
  private async observeDependencies(version: ProcedureVersion) {
    const values: Record<string, string> = {};
    for (const d of version.dependencies) {
      if (d.kind === "file")
        values[d.key] = fingerprint(
          await boundedFile(this.workspace.root, d.target),
        );
      else if (d.kind === "tool_schema") {
        const tool = this.options.registry.get(d.target);
        if (!tool) throw new Error(`Tool removed: ${d.target}`);
        values[d.key] = fingerprint(
          stableJson({
            parameters: tool.parameters,
            requiresApproval: tool.requiresApproval,
            dangerLevel: tool.dangerLevel ?? "safe",
            handlerSource: tool.handler.toString(),
          }),
        );
      } else if (d.target === "harness")
        values[d.key] = fingerprint(this.options.harnessVersion);
      else if (d.target === "node_major")
        values[d.key] = fingerprint(process.versions.node.split(".")[0]!);
      else if (d.target === "platform")
        values[d.key] = fingerprint(process.platform);
      else throw new Error(`Unsupported environment dependency: ${d.target}`);
    }
    return values;
  }
  async recheck(versionId: string): Promise<string[]> {
    const current = this.owned(versionId);
    if (["retired", "rejected"].includes(current.state))
      return [current.reason];
    const changed: string[] = [];
    try {
      const observed = await this.observeDependencies(current.body),
        baseline = this.store.dependencyFingerprints(versionId);
      for (const d of current.body.dependencies)
        if (observed[d.key] !== baseline[d.key])
          changed.push(
            `${d.kind} ${d.target} changed; revalidation required, not proof of invalidity`,
          );
    } catch (error) {
      changed.push((error as Error).message);
    }
    if (changed.length) {
      if (!this.turnSuspensions.some((item) => item.versionId === versionId))
        this.turnSuspensions.push({
          versionId,
          contractId: current.body.verification.contractId,
          reason: changed.join("; ").slice(0, 160),
        });
      this.store.suspendCascade(versionId, changed.join("; "));
      this.activity(
        "suspended",
        current.body.name,
        changed.join("; "),
        this.store.get(versionId),
      );
    }
    return changed;
  }
  /** Small factual fallback status, not permission to repair/adopt criteria. */
  async suspendedForCurrentTurn() {
    return Promise.all(
      this.turnSuspensions.slice(0, 3).map(async (item) => {
        let contractCurrent = true;
        try {
          await this.currentContract(item.contractId);
        } catch {
          contractCurrent = false;
        }
        return { ...item, contractCurrent };
      }),
    );
  }
  /** Expose execution/verification schemas only while their prerequisites
   * exist. This is request-local discovery, never a permission shortcut. */
  async modelToolAvailability() {
    const snapshots = new Map<
      string,
      ReturnType<ProcedureRuntime["previewContract"]>
    >();
    const current = new Set<string>();
    for (const contract of this.store.contracts(this.workspace.id)) {
      try {
        let snapshot = snapshots.get(contract.sourcePath);
        if (!snapshot) {
          snapshot = this.previewContract(contract.sourcePath);
          snapshots.set(contract.sourcePath, snapshot);
        }
        const observed = await snapshot;
        if (
          observed.sourceHash === contract.sourceHash &&
          stableJson(observed.body) === stableJson(contract.body)
        )
          current.add(contract.id);
      } catch {
        /* Missing/changed criteria cannot support these operations. */
      }
    }
    return {
      verify: current.size > 0,
      run: this.store
        .list(this.workspace.id)
        .some(
          (p) =>
            p.state === "active" &&
            !p.disabled &&
            current.has(p.body.verification.contractId),
        ),
    };
  }
  private async recheckChangedPaths(paths: string[]) {
    if (this.closed) return;
    const normalized = paths.map((p) =>
      path.isAbsolute(p)
        ? path.relative(this.workspace.root, p).replaceAll("\\", "/")
        : p.replaceAll("\\", "/"),
    );
    for (const current of this.store
      .list(this.workspace.id)
      .filter((v) => v.state === "active"))
      if (
        !normalized.length ||
        current.body.dependencies.some(
          (d) => d.kind === "file" && normalized.includes(d.target),
        )
      )
        await this.recheck(current.body.versionId);
  }
  async retrieve(query: string) {
    const rows = this.store
      .list(this.workspace.id)
      .filter((v) => !v.disabled && v.state === "active");
    const ranked = rankDocumentsForQuery(
      query,
      rows.map((row) => ({
        id: row.body.versionId,
        text: `${row.body.name} ${row.body.purpose} ${row.body.taskFamily}`,
        updatedAt: row.body.createdAt,
      })),
      { limit: 3 },
    );
    const usable = [];
    for (const item of ranked) {
      const current = this.owned(item.id);
      if ((await this.recheck(item.id)).length) continue;
      this.store.attempt(item.id, this.runId ?? "inspection", "retrieval", {
        reason:
          "Textual relevance and current dependency match; retrieval is not observed success",
      });
      usable.push({
        versionId: item.id,
        state: "active" as const,
        verification: {
          previousOutcomeVerified: true,
          currentOutcome: "checked by procedure_run",
        },
        name: current.body.name,
        parameters: current.body.parameters.map(({ name, type }) => ({
          name,
          type,
        })),
        derivedHypotheses: this.store
          .memories(this.workspace.id)
          .filter(
            (m) =>
              m.state === "active" &&
              this.store.db
                .prepare(
                  "SELECT 1 FROM links WHERE parent=? AND child=? AND relation='derived'",
                )
                .get(item.id, m.id),
          )
          .slice(0, 1)
          .map((m) => ({
            text: m.text.slice(0, 160),
            truncated: m.text.length > 160,
            status: "derived hypothesis, not independently verified",
          })),
      });
    }
    return usable;
  }
  private async guardSelection(
    selection: ProcedureSelection,
    inputs: Record<string, Json>,
    tool: string,
    args: Record<string, unknown>,
  ) {
    if (this.evidenceUnavailable)
      throw new Error(
        "Procedure evidence capture failed; cannot continue procedural effects",
      );
    if (
      !this.runId ||
      selection.runId !== this.runId ||
      selection.taskRevision !== this.taskRevision
    )
      throw new Error("Stale procedure task/approval");
    const actual = await identifyProcedureWorkspace(this.options.workspaceRoot);
    if (actual.id !== selection.workspaceId)
      throw new Error("Workspace/branch changed while procedure was pending");
    const current = this.owned(selection.versionId);
    if (
      current.state !== "active" ||
      current.disabled ||
      current.revision !== selection.stateRevision
    )
      throw new Error(
        "Procedure was suspended, disabled or retired while pending",
      );
    if ((await this.recheck(selection.versionId)).length)
      throw new Error(
        "Procedure dependencies changed; pending approval is stale",
      );
    const failures = await checkPredicates(
      this.workspace.root,
      [...current.body.applicability, ...current.body.preconditions],
      inputs,
    );
    if (failures.length) throw new Error(failures.join("; "));
    const contract = await this.currentContract(
      current.body.verification.contractId,
    );
    if (tool === "write_file") {
      const target = recordTarget(contract.body, inputs);
      if (args.path !== target)
        throw new Error(
          "Edited approval would change the validated procedure target",
        );
      const expected = Object.fromEntries(
        Object.entries(contract.body.fields).map(([field, rule]) => [
          field,
          "parameter" in rule ? inputs[rule.parameter] : rule.constant,
        ]),
      );
      if (
        args.mode !== "create" ||
        typeof args.content !== "string" ||
        stableJson(JSON.parse(args.content)) !== stableJson(expected)
      )
        throw new Error(
          "Edited approval no longer matches the validated procedure content",
        );
      try {
        await lstat(await procedurePath(this.workspace.root, target));
        throw new Error("Procedure must not overwrite an existing record");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  /** Called by the normal dispatcher after approval/argument edits and resource
   * locks, immediately before invoking the real handler. */
  async beforeToolExecution(tool: string, args: Record<string, unknown>) {
    const selected = execution.getStore();
    if (selected?.runtime === this) {
      await this.guardSelection(
        selected.selection,
        selected.inputs,
        tool,
        args,
      );
      if (tool === "write_file") selected.effectStarted = true;
    }
  }
  async run(versionId: string, inputs: Record<string, unknown>) {
    if (this.executing)
      throw new Error("A procedure is already executing in this chat");
    const token = this.requireTurn(),
      current = this.owned(versionId),
      bound = bindInputs(current.body, inputs);
    if (current.state !== "active" || current.disabled)
      throw new Error("Procedure is not active");
    const contract = await this.currentContract(
      current.body.verification.contractId,
    );
    validateRecordProcedure(current.body, contract.body);
    if ((await this.recheck(versionId)).length)
      throw new Error("Procedure needs revalidation");
    const selection: ProcedureSelection = {
      versionId,
      stateRevision: current.revision,
      taskRevision: token.revision,
      runId: token.runId,
      workspaceId: this.workspace.id,
      inputHash: fingerprint(stableJson(bound)),
    };
    const start = Date.now();
    let calls = 0,
      recorded = false;
    this.executing = true;
    const selected = {
      runtime: this,
      selection,
      inputs: bound,
      effectStarted: false,
    };
    try {
      return await execution.run(selected, async () => {
        for (const step of current.body.steps) {
          const args = resolveBinding(step.args, bound) as Record<
            string,
            unknown
          >;
          await this.guardSelection(selection, bound, step.tool, args);
          calls++;
          const callId = newId();
          this.options.emitter.emit("tool_start", {
            callId,
            name: step.tool,
            traceId: token.runId,
          });
          const result = await this.options.dispatch(
            callId,
            step.tool,
            JSON.stringify(args),
          );
          if (!result.ok) throw new Error(result.error);
        }
        if (
          token.revision !== this.taskRevision ||
          token.runId !== this.runId ||
          this.store.get(versionId)?.revision !== selection.stateRevision
        )
          throw new Error(
            "Late result cannot confirm a changed/retired procedure",
          );
        const receipt = await this.verify(contract.id, bound, versionId);
        this.store.recordValidation(receipt);
        this.store.attempt(versionId, token.runId, "execution", {
          correct: receipt.correct,
          elapsedMs: Date.now() - start,
          toolCalls: calls,
          reason: receipt.correct
            ? "Objective result verified"
            : "Objective result failed",
        });
        recorded = true;
        if (!receipt.correct) {
          this.store.suspendCascade(
            versionId,
            "Reused procedure failed objective outcome",
          );
          throw new Error("Procedure outcome was incorrect");
        }
        this.activity(
          "reused",
          current.body.name,
          "Applied parameterized procedure and verified the actual result",
          current,
        );
        return {
          correct: true,
          versionId,
          receiptId: receipt.id,
          target: recordTarget(contract.body, bound),
          verifiedFields: Object.fromEntries(
            Object.entries(contract.body.fields).map(([field, rule]) => [
              field,
              "parameter" in rule ? bound[rule.parameter] : rule.constant,
            ]),
          ),
          toolCalls: calls,
        };
      });
    } catch (error) {
      if (!recorded)
        this.store.attempt(
          versionId,
          token.runId,
          selected.effectStarted ? "execution" : "abstention",
          {
            ...(selected.effectStarted ? { correct: false } : {}),
            elapsedMs: Date.now() - start,
            toolCalls: calls,
            reason: (error as Error).message,
          },
        );
      if (selected.effectStarted)
        this.store.suspendCascade(
          versionId,
          "Execution or verification failed: " + (error as Error).message,
        );
      this.activity(
        selected.effectStarted ? "error" : "abstained",
        current.body.name,
        (error as Error).message,
        this.store.get(versionId),
      );
      throw error;
    } finally {
      this.executing = false;
    }
  }
  async inspect() {
    await this.eventQueue;
    return {
      workspace: this.workspace,
      contracts: this.store.contracts(this.workspace.id),
      procedures: this.store.list(this.workspace.id),
      derivedMemories: this.store.memories(this.workspace.id),
    };
  }
  /** Desktop user actions can inspect/learn after a completed turn without
   * replaying its conversation or granting the model a contract-adoption tool. */
  async control<T>(action: () => Promise<T>): Promise<T> {
    if (this.managing)
      throw new Error(
        "Another procedure management action is in progress; retry after it completes",
      );
    if (this.runId) return action();
    this.managing = true;
    try {
      await this.beginTurn("Explicit user procedure management", newId());
      return await action();
    } finally {
      await this.finishTurn("user_management");
      this.managing = false;
    }
  }
  recoverValidation(versionId: string) {
    const current = this.owned(versionId);
    if (current.state !== "validating")
      throw new Error(
        "Only an interrupted/in-progress validation may be recovered",
      );
    const changed = this.store.transition(
      versionId,
      current.revision,
      "needs_revalidation",
      "User revoked the interrupted check; fresh objective verification is required",
    );
    this.activity("suspended", current.body.name, changed.reason, changed);
    return changed;
  }
  retire(versionId: string, reason: string) {
    const current = this.owned(versionId);
    const affected = this.store.suspendCascade(versionId, reason, true);
    this.activity(
      "retired",
      current.body.name,
      reason,
      this.store.get(versionId),
    );
    return affected;
  }
  disable(versionId: string, disabled: boolean) {
    const current = this.owned(versionId);
    this.store.disable(current.body.procedureId, disabled);
  }
}
