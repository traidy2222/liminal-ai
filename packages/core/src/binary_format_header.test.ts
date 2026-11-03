import test from "node:test";
import assert from "node:assert/strict";
import { decodeKnownBinaryHeader } from "./binary_format_header.js";

function fixture(versionText = "4.2.1.0", type = "NiNode") {
  const line = Buffer.from(
    `NetImmerse File Format, Version ${versionText}\n`,
    "ascii",
  );
  const version =
    versionText
      .split(".")
      .reduce((value, component) => value * 256 + Number(component), 0) >>> 0;
  const fields = Buffer.alloc(12);
  fields.writeUInt32LE(version, 0);
  fields.writeUInt32LE(7, 4);
  fields.writeUInt32LE(type.length, 8);
  return Buffer.concat([
    line,
    fields,
    Buffer.from(type, "ascii"),
    Buffer.alloc(16),
  ]);
}

test("NetImmerse4.x fields and first block are observed at schema-derived offsets without a global table assumption", () => {
  const bytes = fixture();
  const result = decodeKnownBinaryHeader(bytes)!;
  const lineEnd = bytes.indexOf(10) + 1;
  assert.equal(result.status, "header_fields_observed");
  assert.equal(result.ascii_version, "4.2.1.0");
  assert.equal(result.fields?.binary_version?.offset, lineEnd);
  assert.equal(result.fields?.binary_version?.value, 0x04020100);
  assert.equal(result.fields?.declared_num_blocks?.value, 7);
  assert.equal(result.fields?.declared_num_blocks?.offset, lineEnd + 4);
  assert.deepEqual(result.first_inline_block, {
    type_offset: lineEnd + 12,
    type_length: 6,
    type: "NiNode",
    payload_offset: lineEnd + 18,
  });
  assert.match(result.next_check, /inline.*not a global/);
  assert(
    result.limitations.some((limit) => /have not been validated/.test(limit)),
  );
});

test("different4.x minor version and type remain data, not filename-specific answers", () => {
  const result = decodeKnownBinaryHeader(fixture("4.0.0.2", "NiSequence"))!;
  assert.equal(result.status, "header_fields_observed");
  assert.equal(result.ascii_version, "4.0.0.2");
  assert.equal(result.first_inline_block?.type, "NiSequence");
  assert(!JSON.stringify(result).includes("Fry"));
});

test("unsupported versions, contradictory version bytes and invalid block lengths are explicit", () => {
  assert.equal(
    decodeKnownBinaryHeader(fixture("10.0.1.0"))?.status,
    "unsupported_version",
  );
  const contradiction = fixture();
  contradiction[contradiction.indexOf(10) + 1] ^= 1;
  assert.equal(
    decodeKnownBinaryHeader(contradiction)?.status,
    "invalid_header",
  );
  const badLength = fixture();
  badLength.writeUInt32LE(0xffffffff, badLength.indexOf(10) + 9);
  assert.equal(decodeKnownBinaryHeader(badLength)?.status, "invalid_header");
});

test("truncated prefixes request bounded bytes and never infer unknown object structure", () => {
  const bytes = fixture();
  const result = decodeKnownBinaryHeader(
    bytes.subarray(0, bytes.indexOf(10) + 4),
  )!;
  assert.equal(result.status, "need_more_bytes");
  assert(result.required_prefix_bytes! <= 160);
  assert.equal(result.first_inline_block, undefined);
  assert.equal(decodeKnownBinaryHeader(bytes, 16), undefined);
  assert.equal(
    decodeKnownBinaryHeader(Buffer.from("Some other archive bytes")),
    undefined,
  );
});
