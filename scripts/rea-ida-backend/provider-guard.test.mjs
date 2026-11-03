import test from "node:test";
import assert from "node:assert/strict";
import { transformProvider } from "../repair-rea-ida-backend.mjs";

const source = `import { IdaSessionClient } from "./IdaSessionClient.js";
class IdaProvider {
    inspectTargetSupport(target) {
        if (target.kind === "executable" && target.architecture === "mips")
            return { status: "unsupported", reason: "REA's IDA adapter has no verified MIPS lane. Select a supported Ghidra profile instead." };
        return target.kind === "executable" ? {status:"supported"} : {status:"unsupported"};
    }
}`;

test("patched provider consults the verified profile only for MIPS executables and retains other routing", () => {
  const calls = [];
  const verified = target => { calls.push(target); return target.verified === true; };
  const patched = transformProvider(source).replace(/^import[^\n]*\n/gm, "");
  const Factory = new Function("verifiedPs2MipsElfTarget", patched + "; return IdaProvider;")(verified);
  const provider = new Factory();
  assert.equal(provider.inspectTargetSupport({ kind: "executable", architecture: "mips", verified: true }).status, "supported");
  const rejected = provider.inspectTargetSupport({ kind: "executable", architecture: "mips", verified: false });
  assert.equal(rejected.status, "unsupported"); assert.match(rejected.reason, /outside the verified PS2 ELF32/);
  assert.equal(calls.length, 2);
  assert.equal(provider.inspectTargetSupport({ kind: "executable", architecture: "x86" }).status, "supported");
  assert.equal(provider.inspectTargetSupport({ kind: "analysis-database", architecture: "mips", verified: true }).status, "unsupported");
  assert.equal(calls.length, 2, "other architectures/kinds retain their original routing");
  assert.throws(() => transformProvider(source.replace('target.architecture === "mips"', 'target.architecture === "arm"')), /Unsupported backend source layout/);
});
