import Database from "better-sqlite3";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  linkSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import {
  fingerprint,
  newId,
  stableJson,
  validateProcedure,
  type ProcedureVersion,
  type ProcedureState,
  type EvidenceRef,
  type JsonRecordContract,
} from "./model.js";

export interface StoredProcedure {
  body: ProcedureVersion;
  state: ProcedureState;
  revision: number;
  reason: string;
  disabled: boolean;
  successes: number;
  failures: number;
  retrievals: number;
}
export interface Episode {
  runId: string;
  workspaceId: string;
  chatId: string;
  taskRevision: number;
  goal: string;
  model: string;
  harness: string;
  environment: Record<string, string>;
  finished?: string;
}
export interface EpisodeEvent {
  eventId: string;
  runId: string;
  kind: "tool_result" | "correction" | "verification";
  callId?: string;
  tool?: string;
  ok?: boolean;
  data: unknown;
  sequence?: number;
}
export interface ValidationReceipt {
  id: string;
  versionId?: string;
  runId: string;
  workspaceId: string;
  contractId: string;
  taskRevision: number;
  inputHash: string;
  correct: boolean;
  observations: unknown;
  eventId: string;
  targetHash?: string;
}
export interface TrustedContract {
  id: string;
  workspaceId: string;
  sourcePath: string;
  sourceHash: string;
  body: JsonRecordContract;
  createdAt: string;
}
const transitions: Record<ProcedureState, ProcedureState[]> = {
  candidate: ["validating", "rejected", "retired"],
  validating: ["active", "rejected", "needs_revalidation", "retired"],
  active: ["needs_revalidation", "retired"],
  needs_revalidation: ["validating", "retired", "rejected"],
  retired: [],
  rejected: [],
};

/** SQLite is the sole authoritative store for the new feature. WAL + FULL
 * commits and BEGIN IMMEDIATE cover separate objects/processes, not just one
 * promise queue. Legacy notes/recipes are neither imported nor promoted. */
export class ProcedureStore {
  readonly db: Database.Database;
  constructor(readonly filename: string) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename, { timeout: 5000 });
    try {
      this.db.pragma("busy_timeout = 5000");
      this.db.pragma("foreign_keys = ON");
      if (this.db.pragma("quick_check", { simple: true }) !== "ok")
        throw new Error(
          "Procedure store integrity check failed; preserve the file and restore a verified backup",
        );
      const version = Number(this.db.pragma("user_version", { simple: true }));
      if (version > 2)
        throw new Error(
          "Procedure store was written by a newer schema; refusing downgrade",
        );
      // SQLite can reject a journal-mode lock upgrade immediately even with
      // busy_timeout configured, when another new connection is initializing.
      // Retry only that transient transition, within the same bounded budget.
      const walDeadline = Date.now() + 5000;
      for (;;) {
        try {
          this.db.pragma("journal_mode = WAL");
          break;
        } catch (error) {
          if (
            (error as { code?: string }).code !== "SQLITE_BUSY" ||
            Date.now() >= walDeadline
          )
            throw error;
          Atomics.wait(
            new Int32Array(new SharedArrayBuffer(4)),
            0,
            0,
            Math.min(10, walDeadline - Date.now()),
          );
        }
      }
      this.db.pragma("synchronous = FULL");
      if (version === 0)
        this.db
          .transaction(() => {
            if (Number(this.db.pragma("user_version", { simple: true })) >= 1)
              return; // another process migrated while we waited
            this.db.exec(`
          CREATE TABLE workspaces(id TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE episodes(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, body TEXT NOT NULL);
          CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,run_id TEXT NOT NULL REFERENCES episodes(id),kind TEXT NOT NULL,call_id TEXT,body TEXT NOT NULL,UNIQUE(run_id,call_id,kind));
          CREATE TABLE contracts(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,body TEXT NOT NULL);
          CREATE TABLE procedures(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,family TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE versions(id TEXT PRIMARY KEY,procedure_id TEXT NOT NULL REFERENCES procedures(id),number INTEGER NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL,UNIQUE(procedure_id,number));
          CREATE TABLE states(version_id TEXT PRIMARY KEY REFERENCES versions(id),state TEXT NOT NULL,revision INTEGER NOT NULL,reason TEXT NOT NULL);
          CREATE TABLE transitions(seq INTEGER PRIMARY KEY AUTOINCREMENT,version_id TEXT NOT NULL REFERENCES versions(id),previous TEXT,next TEXT NOT NULL,reason TEXT NOT NULL,evidence TEXT NOT NULL,at TEXT NOT NULL);
          CREATE TABLE dependencies(version_id TEXT NOT NULL REFERENCES versions(id),key TEXT NOT NULL,kind TEXT NOT NULL,target TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(version_id,key));
          CREATE INDEX dependency_target ON dependencies(kind,target);
          CREATE TABLE links(parent TEXT NOT NULL,child TEXT NOT NULL,relation TEXT NOT NULL,PRIMARY KEY(parent,child,relation));
          CREATE INDEX link_parent ON links(parent);
          CREATE TABLE derived_memories(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,text TEXT NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL);
          CREATE TABLE validations(id TEXT PRIMARY KEY,version_id TEXT REFERENCES versions(id),run_id TEXT NOT NULL REFERENCES episodes(id),workspace_id TEXT NOT NULL,contract_id TEXT NOT NULL REFERENCES contracts(id),correct INTEGER NOT NULL,body TEXT NOT NULL);
          CREATE TABLE attempts(id TEXT PRIMARY KEY,version_id TEXT NOT NULL REFERENCES versions(id),run_id TEXT NOT NULL,kind TEXT NOT NULL,correct INTEGER,elapsed_ms REAL,tool_calls INTEGER,tokens INTEGER,reason TEXT NOT NULL,at TEXT NOT NULL);
          CREATE TRIGGER immutable_version BEFORE UPDATE ON versions BEGIN SELECT RAISE(ABORT,'Procedure versions are immutable'); END;
          CREATE TRIGGER immutable_event BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'Episode evidence is immutable'); END;
          CREATE TRIGGER immutable_validation BEFORE UPDATE ON validations BEGIN SELECT RAISE(ABORT,'Validation receipts are immutable'); END;
          PRAGMA user_version = 1;
        `);
          })
          .immediate();
      if (Number(this.db.pragma("user_version", { simple: true })) < 2)
        this.db
          .transaction(() => {
            if (Number(this.db.pragma("user_version", { simple: true })) >= 2)
              return;
            this.db.exec(
              `CREATE TABLE consolidation_claims(key TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL,result TEXT); PRAGMA user_version = 2;`,
            );
          })
          .immediate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    if (this.db.open) this.db.close();
  }
  registerWorkspace(id: string, body: unknown) {
    this.db
      .prepare("INSERT OR IGNORE INTO workspaces VALUES(?,?)")
      .run(id, JSON.stringify(body));
  }
  beginEpisode(episode: Episode) {
    this.db
      .prepare("INSERT INTO episodes VALUES(?,?,?)")
      .run(episode.runId, episode.workspaceId, JSON.stringify(episode));
  }
  episode(id: string): Episode | undefined {
    const row = this.db
      .prepare("SELECT body FROM episodes WHERE id=?")
      .get(id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }
  finishEpisode(id: string, finished: string) {
    const episode = this.episode(id);
    if (episode)
      this.db
        .prepare("UPDATE episodes SET body=? WHERE id=?")
        .run(JSON.stringify({ ...episode, finished }), id);
  }
  recordEvent(event: EpisodeEvent) {
    const full = JSON.stringify(event.data);
    let stored = event;
    if (full.length > 16000) {
      // Content addressed, redacted evidence is published before its DB reference.
      // A crash can leave an unreferenced file, never a partially committed row.
      const hash = fingerprint(full),
        directory = path.join(path.dirname(this.filename), "evidence");
      mkdirSync(directory, { recursive: true });
      const published = path.join(directory, hash + ".json"),
        temporary = path.join(directory, hash + "." + newId() + ".tmp");
      writeFileSync(temporary, full, { flag: "wx", mode: 0o600, flush: true });
      try {
        try {
          linkSync(temporary, published);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        if (fingerprint(readFileSync(published)) !== hash)
          throw new Error(
            "Existing evidence artifact is incomplete or corrupt; refusing a committed reference",
          );
      } finally {
        unlinkSync(temporary);
      }
      stored = {
        ...event,
        data: {
          projection: true,
          summary: full.slice(0, 2000),
          artifactHash: hash,
          characters: full.length,
        },
      };
    }
    this.db
      .prepare(
        "INSERT OR IGNORE INTO events(id,run_id,kind,call_id,body) VALUES(?,?,?,?,?)",
      )
      .run(
        stored.eventId,
        stored.runId,
        stored.kind,
        stored.callId ?? null,
        JSON.stringify(stored),
      );
  }
  evidence(eventId: string, offset = 0) {
    const event = this.event(eventId);
    if (!event) throw new Error("Evidence not found");
    const data = event.data as Record<string, unknown>;
    let content = JSON.stringify(event.data);
    if (data?.projection && typeof data.artifactHash === "string") {
      if (!/^[a-f0-9]{64}$/.test(data.artifactHash))
        throw new Error("Invalid artifact hash");
      content = readFileSync(
        path.join(
          path.dirname(this.filename),
          "evidence",
          data.artifactHash + ".json",
        ),
        "utf8",
      );
      if (fingerprint(content) !== data.artifactHash)
        throw new Error("Evidence artifact fingerprint mismatch");
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > content.length)
      throw new Error("Invalid evidence offset");
    return {
      eventId,
      offset,
      totalCharacters: content.length,
      content: content.slice(offset, offset + 16000),
      nextOffset: offset + 16000 < content.length ? offset + 16000 : null,
    };
  }
  events(runId: string): EpisodeEvent[] {
    return (
      this.db
        .prepare(
          "SELECT seq,body FROM events WHERE run_id=? ORDER BY seq LIMIT 1000",
        )
        .all(runId) as Array<{ seq: number; body: string }>
    ).map((row) => ({ ...JSON.parse(row.body), sequence: row.seq }));
  }
  event(id: string): EpisodeEvent | undefined {
    const row = this.db
      .prepare("SELECT seq,body FROM events WHERE id=?")
      .get(id) as { seq: number; body: string } | undefined;
    return row ? { ...JSON.parse(row.body), sequence: row.seq } : undefined;
  }
  registerContract(contract: TrustedContract) {
    this.db
      .prepare("INSERT INTO contracts VALUES(?,?,?)")
      .run(contract.id, contract.workspaceId, JSON.stringify(contract));
  }
  contract(id: string): TrustedContract | undefined {
    const row = this.db
      .prepare("SELECT body FROM contracts WHERE id=?")
      .get(id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }
  contracts(workspaceId: string): TrustedContract[] {
    return (
      this.db
        .prepare(
          "SELECT body FROM contracts WHERE workspace_id=? ORDER BY rowid DESC LIMIT 32",
        )
        .all(workspaceId) as Array<{ body: string }>
    ).map((row) => JSON.parse(row.body));
  }
  putCandidate(proposal: ProcedureVersion) {
    const body = validateProcedure(proposal);
    this.db
      .transaction(() => {
        const existing = this.db
          .prepare("SELECT workspace_id,family FROM procedures WHERE id=?")
          .get(body.procedureId) as
          | { workspace_id: string; family: string }
          | undefined;
        if (
          existing &&
          (existing.workspace_id !== body.scope.workspaceId ||
            existing.family !== body.taskFamily)
        )
          throw new Error("Revision cannot change procedure scope or family");
        const prior = this.db
          .prepare(
            "SELECT max(number) AS number FROM versions WHERE procedure_id=?",
          )
          .get(body.procedureId) as { number: number | null };
        if (body.version !== (prior.number ?? 0) + 1)
          throw new Error(
            "Procedure version must follow the immutable history",
          );
        for (const ref of body.evidence) {
          const event = this.event(ref.eventId),
            episode = event && this.episode(event.runId);
          if (
            !event ||
            event.runId !== ref.runId ||
            episode?.workspaceId !== body.scope.workspaceId ||
            (ref.callId && event.callId !== ref.callId)
          )
            throw new Error("Procedure cites missing or foreign evidence");
          if (ref.kind === "verified_outcome" && event.kind !== "verification")
            throw new Error("A tool success is not verified task correctness");
        }
        const contract = this.contract(body.verification.contractId);
        if (!contract || contract.workspaceId !== body.scope.workspaceId)
          throw new Error(
            "Procedure needs a trusted workspace validation contract",
          );
        this.db
          .prepare(
            "INSERT OR IGNORE INTO procedures(id,workspace_id,family) VALUES(?,?,?)",
          )
          .run(body.procedureId, body.scope.workspaceId, body.taskFamily);
        this.db
          .prepare("INSERT INTO versions VALUES(?,?,?,?,?)")
          .run(
            body.versionId,
            body.procedureId,
            body.version,
            JSON.stringify(body),
            fingerprint(stableJson(body)),
          );
        this.db
          .prepare("INSERT INTO states VALUES(?,?,?,?)")
          .run(
            body.versionId,
            "candidate",
            1,
            "Proposed from an episode; not yet validated",
          );
        for (const dep of body.dependencies)
          this.db
            .prepare("INSERT INTO dependencies VALUES(?,?,?,?,?)")
            .run(
              body.versionId,
              dep.key,
              dep.kind,
              dep.target,
              dep.fingerprint,
            );
        for (const parent of body.support)
          this.link(parent, body.versionId, "support");
        for (const parent of body.contradictions)
          this.link(parent, body.versionId, "contradiction");
        this.insertTransition(
          body.versionId,
          null,
          "candidate",
          "Proposed from source episode",
          body.evidence,
        );
      })
      .immediate();
  }
  private insertTransition(
    id: string,
    previous: ProcedureState | null,
    next: ProcedureState,
    reason: string,
    evidence: EvidenceRef[],
  ) {
    this.db
      .prepare(
        "INSERT INTO transitions(version_id,previous,next,reason,evidence,at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        id,
        previous,
        next,
        reason.slice(0, 2000),
        JSON.stringify(evidence),
        new Date().toISOString(),
      );
  }
  get(id: string): StoredProcedure | undefined {
    const row = this.db
      .prepare(
        `SELECT v.body,v.hash,s.state,s.revision,s.reason,p.disabled,
      (SELECT count(*) FROM attempts WHERE version_id=v.id AND kind='execution' AND correct=1) successes,
      (SELECT count(*) FROM attempts WHERE version_id=v.id AND kind='execution' AND correct=0) failures,
      (SELECT count(*) FROM attempts WHERE version_id=v.id AND kind='retrieval') retrievals
      FROM versions v JOIN states s ON s.version_id=v.id JOIN procedures p ON p.id=v.procedure_id WHERE v.id=?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const body = validateProcedure(JSON.parse(String(row.body)));
    if (fingerprint(stableJson(body)) !== row.hash)
      throw new Error(
        "Procedure content fingerprint mismatch; preserve and inspect the store",
      );
    return {
      body,
      state: row.state as ProcedureState,
      revision: Number(row.revision),
      reason: String(row.reason),
      disabled: !!row.disabled,
      successes: Number(row.successes),
      failures: Number(row.failures),
      retrievals: Number(row.retrievals),
    };
  }
  list(workspaceId: string): StoredProcedure[] {
    return (
      this.db
        .prepare(
          "SELECT v.id FROM versions v JOIN procedures p ON p.id=v.procedure_id WHERE p.workspace_id=? ORDER BY v.rowid DESC LIMIT 200",
        )
        .all(workspaceId) as Array<{ id: string }>
    ).map((row) => this.get(row.id)!);
  }
  history(procedureId: string) {
    return this.db
      .prepare(
        "SELECT t.* FROM transitions t JOIN versions v ON v.id=t.version_id WHERE v.procedure_id=? ORDER BY t.seq LIMIT 500",
      )
      .all(procedureId);
  }
  transition(
    id: string,
    expectedRevision: number,
    next: ProcedureState,
    reason: string,
    evidence: EvidenceRef[] = [],
  ) {
    return this.db
      .transaction(() => {
        const current = this.get(id);
        if (!current || current.revision !== expectedRevision)
          throw new Error(
            "Stale procedure revision; reload before changing lifecycle",
          );
        if (!transitions[current.state].includes(next))
          throw new Error(
            `Invalid lifecycle transition ${current.state} -> ${next}`,
          );
        if (next === "active") {
          const verified = this.db
            .prepare(
              "SELECT count(*) AS count FROM validations WHERE version_id=? AND correct=1",
            )
            .get(id) as { count: number };
          if (!verified.count)
            throw new Error(
              "Active procedures require an objective validation receipt",
            );
        }
        this.db
          .prepare(
            "UPDATE states SET state=?,revision=revision+1,reason=? WHERE version_id=? AND revision=?",
          )
          .run(next, reason.slice(0, 2000), id, expectedRevision);
        this.insertTransition(id, current.state, next, reason, evidence);
        return this.get(id)!;
      })
      .immediate();
  }
  recordValidation(receipt: ValidationReceipt) {
    const event = this.event(receipt.eventId),
      episode = this.episode(receipt.runId),
      contract = this.contract(receipt.contractId);
    const data = event?.data as Record<string, unknown> | undefined;
    if (
      event?.kind !== "verification" ||
      event.ok !== receipt.correct ||
      data?.contractId !== receipt.contractId ||
      data?.inputHash !== receipt.inputHash ||
      data?.targetHash !== receipt.targetHash ||
      event.runId !== receipt.runId ||
      episode?.workspaceId !== receipt.workspaceId ||
      episode.taskRevision !== receipt.taskRevision ||
      contract?.workspaceId !== receipt.workspaceId
    )
      throw new Error("Invalid validation provenance");
    if (receipt.versionId) {
      const version = this.get(receipt.versionId);
      if (
        version?.body.verification.contractId !== receipt.contractId ||
        version.body.scope.workspaceId !== receipt.workspaceId
      )
        throw new Error("Validation does not match procedure contract/scope");
    }
    this.db
      .prepare("INSERT INTO validations VALUES(?,?,?,?,?,?,?)")
      .run(
        receipt.id,
        receipt.versionId ?? null,
        receipt.runId,
        receipt.workspaceId,
        receipt.contractId,
        receipt.correct ? 1 : 0,
        JSON.stringify(receipt),
      );
  }
  validations(versionId?: string, runId?: string): ValidationReceipt[] {
    return (
      this.db
        .prepare(
          "SELECT body FROM validations WHERE (? IS NULL OR version_id=?) AND (? IS NULL OR run_id=?) ORDER BY rowid DESC LIMIT 100",
        )
        .all(
          versionId ?? null,
          versionId ?? null,
          runId ?? null,
          runId ?? null,
        ) as Array<{ body: string }>
    ).map((row) => JSON.parse(row.body));
  }
  promote(
    id: string,
    expectedRevision: number,
    receipt: ValidationReceipt,
    dependencies?: Record<string, string>,
  ) {
    return this.db
      .transaction(() => {
        const current = this.get(id);
        if (
          !current ||
          current.state !== "validating" ||
          current.revision !== expectedRevision ||
          receipt.versionId !== id ||
          !receipt.correct
        )
          throw new Error("Stale or unsuccessful promotion");
        this.recordValidation(receipt);
        const active = this.transition(
          id,
          expectedRevision,
          "active",
          "Objective contract passed for recorded inputs",
          [
            {
              runId: receipt.runId,
              eventId: receipt.eventId,
              kind: "verified_outcome",
            },
          ],
        );
        if (dependencies)
          this.attestDependencies(id, active.revision, dependencies);
        const contract = this.contract(current.body.verification.contractId)!;
        for (const other of this.list(current.body.scope.workspaceId).filter(
          (p) =>
            p.state === "active" &&
            p.body.procedureId !== current.body.procedureId,
        )) {
          const alternate = this.contract(other.body.verification.contractId);
          if (
            alternate?.body.directory === contract.body.directory &&
            stableJson(alternate.body.fields) !==
              stableJson(contract.body.fields)
          ) {
            this.link(id, other.body.versionId, "contradiction");
            this.suspendCascade(
              id,
              "Conflicting active procedures target the same record namespace",
            );
            this.suspendCascade(
              other.body.versionId,
              "Conflicting active procedures target the same record namespace",
            );
          }
        }
        return this.get(id)!;
      })
      .immediate();
  }
  attestDependencies(
    id: string,
    revision: number,
    values: Record<string, string>,
  ) {
    this.db
      .transaction(() => {
        if (this.get(id)?.revision !== revision)
          throw new Error("Stale dependency attestation");
        for (const [key, hash] of Object.entries(values))
          this.db
            .prepare(
              "UPDATE dependencies SET fingerprint=? WHERE version_id=? AND key=?",
            )
            .run(hash, id, key);
      })
      .immediate();
  }
  dependencyFingerprints(id: string): Record<string, string> {
    return Object.fromEntries(
      (
        this.db
          .prepare(
            "SELECT key,fingerprint FROM dependencies WHERE version_id=?",
          )
          .all(id) as Array<{ key: string; fingerprint: string }>
      ).map((r) => [r.key, r.fingerprint]),
    );
  }
  link(
    parent: string,
    child: string,
    relation: "support" | "contradiction" | "derived",
  ) {
    if (parent.length > 160 || child.length > 160)
      throw new Error("Invalid knowledge link");
    const scope = (id: string) => {
      const version = this.get(id);
      if (version) return version.body.scope.workspaceId;
      return (
        this.db
          .prepare("SELECT workspace_id FROM derived_memories WHERE id=?")
          .get(id) as { workspace_id: string } | undefined
      )?.workspace_id;
    };
    if (!scope(parent) || scope(parent) !== scope(child))
      throw new Error(
        "Knowledge links require existing evidence in the same workspace",
      );
    this.db
      .prepare("INSERT OR IGNORE INTO links VALUES(?,?,?)")
      .run(parent, child, relation);
  }
  derived(parent: string, workspaceId: string, text: string) {
    const source = this.get(parent);
    if (
      text.length > 4000 ||
      !text.trim() ||
      source?.body.scope.workspaceId !== workspaceId ||
      source.state !== "active" ||
      source.disabled
    )
      throw new Error("Invalid derived memory");
    const id = newId();
    this.db
      .transaction(() => {
        this.db
          .prepare("INSERT INTO derived_memories VALUES(?,?,?,?,?)")
          .run(
            id,
            workspaceId,
            text,
            "active",
            "Derived from procedure evidence; not independently verified",
          );
        this.link(parent, id, "derived");
      })
      .immediate();
    return id;
  }
  memories(workspaceId: string) {
    return this.db
      .prepare(
        "SELECT * FROM derived_memories WHERE workspace_id=? ORDER BY rowid DESC LIMIT 100",
      )
      .all(workspaceId) as Array<{
      id: string;
      text: string;
      state: string;
      reason: string;
    }>;
  }
  suspendCascade(root: string, reason: string, retire = false): string[] {
    return this.db
      .transaction(() => {
        const queue = [root],
          seen = new Set<string>(),
          changed: string[] = [];
        while (queue.length) {
          const id = queue.shift()!;
          if (seen.has(id)) continue;
          seen.add(id);
          if (seen.size > 10000)
            throw new Error("Knowledge dependency traversal exceeds limit");
          const current = this.get(id);
          if (current && !["retired", "rejected"].includes(current.state)) {
            const next =
              id === root && retire ? "retired" : "needs_revalidation";
            if (current.state !== next) {
              this.db
                .prepare(
                  "UPDATE states SET state=?,revision=revision+1,reason=? WHERE version_id=?",
                )
                .run(next, reason.slice(0, 2000), id);
              this.insertTransition(id, current.state, next, reason, []);
              changed.push(id);
            }
          }
          const memory = this.db
            .prepare("UPDATE derived_memories SET state=?,reason=? WHERE id=?")
            .run("needs_revalidation", reason.slice(0, 2000), id);
          if (memory.changes) changed.push(id);
          for (const row of this.db
            .prepare(
              "SELECT child FROM links WHERE parent=? AND relation IN ('support','derived')",
            )
            .all(id) as Array<{ child: string }>)
            queue.push(row.child);
        }
        return changed;
      })
      .immediate();
  }
  disable(procedureId: string, disabled: boolean) {
    this.db
      .transaction(() => {
        this.db
          .prepare("UPDATE procedures SET disabled=? WHERE id=?")
          .run(disabled ? 1 : 0, procedureId);
        this.db
          .prepare(
            "UPDATE states SET revision=revision+1 WHERE version_id IN (SELECT id FROM versions WHERE procedure_id=?)",
          )
          .run(procedureId);
      })
      .immediate();
  }
  attempt(
    versionId: string,
    runId: string,
    kind: "retrieval" | "execution" | "abstention",
    data: {
      correct?: boolean;
      elapsedMs?: number;
      toolCalls?: number;
      tokens?: number;
      reason: string;
    },
  ) {
    this.db
      .prepare("INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(
        newId(),
        versionId,
        runId,
        kind,
        data.correct === undefined ? null : data.correct ? 1 : 0,
        data.elapsedMs ?? null,
        data.toolCalls ?? null,
        data.tokens ?? null,
        data.reason.slice(0, 2000),
        new Date().toISOString(),
      );
  }
  claimConsolidation(key: string, owner: string) {
    return this.db
      .transaction(() => {
        const now = Date.now();
        this.db
          .prepare(
            "INSERT INTO consolidation_claims VALUES(?,?,?,NULL) ON CONFLICT(key) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE consolidation_claims.result IS NULL AND consolidation_claims.expires<?",
          )
          .run(key, owner, now + 60000, now);
        return (
          (
            this.db
              .prepare(
                "SELECT owner,result FROM consolidation_claims WHERE key=?",
              )
              .get(key) as { owner: string; result: string | null }
          )?.owner === owner
        );
      })
      .immediate();
  }
  completeConsolidation(key: string, owner: string, result: string) {
    this.db
      .prepare(
        "UPDATE consolidation_claims SET result=? WHERE key=? AND owner=?",
      )
      .run(result, key, owner);
  }
  async backup(destination: string) {
    await this.db.backup(destination);
  }
}
