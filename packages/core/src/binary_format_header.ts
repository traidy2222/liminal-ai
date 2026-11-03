/** Bounded, version-specific observations, not a general object decoder.
 * Primary schemas: https://github.com/niftools/nifxml/blob/master/nif.xml
 * Old inline block framing: https://github.com/niftools/niflib/blob/develop/src/niflib.cpp
 */
export interface KnownBinaryHeaderObservation {
  format: "NetImmerse";
  status:
    | "header_fields_observed"
    | "need_more_bytes"
    | "unsupported_version"
    | "invalid_header";
  ascii_version?: string;
  header_line?: string;
  fields?: Record<
    string,
    { offset: number; size: number; value: number | string; raw_hex: string }
  >;
  first_inline_block?: {
    type_offset: number;
    type_length: number;
    type: string;
    payload_offset: number;
  };
  required_prefix_bytes?: number;
  reason?: string;
  schema_reference: string;
  framing_reference: string;
  limitations: string[];
  next_check: string;
}

/** Only a source offset-zero prefix can establish this header identity. */
export function decodeKnownBinaryHeader(
  bytes: Buffer,
  offset = 0,
): KnownBinaryHeaderObservation | undefined {
  const prefix = Buffer.from("NetImmerse File Format", "ascii");
  if (offset !== 0 || !bytes.subarray(0, prefix.length).equals(prefix)) return;
  const observed: KnownBinaryHeaderObservation = {
    format: "NetImmerse",
    status: "need_more_bytes",
    schema_reference: "https://github.com/niftools/nifxml/blob/master/nif.xml",
    framing_reference:
      "https://github.com/niftools/niflib/blob/develop/src/niflib.cpp",
    limitations: [
      "Only the 4.x header and first inline block-type prefix are decoded. The remaining objects, links, meshes, bones and animation channels have not been validated.",
      "Printable names or one matching block prefix do not establish complete object structure or a successful model/skeleton/animation export.",
    ],
    next_check:
      "Read a bounded header prefix, compare the declared version with the documented schema, and save measured fields plus unknowns before deeper object decoding.",
  };
  const newline = bytes.subarray(0, 160).indexOf(10);
  if (newline < 0) {
    observed.required_prefix_bytes = 160;
    observed.reason = "No complete header line in the bounded prefix";
    return observed;
  }
  observed.header_line = bytes
    .subarray(0, newline)
    .toString("ascii")
    .replace(/\r$/, "");
  const match =
    /^NetImmerse File Format(?:,? Version)? ([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/.exec(
      observed.header_line,
    );
  if (!match || match.slice(1).some((component) => Number(component) > 255)) {
    observed.status = "invalid_header";
    observed.reason =
      "Header version text does not match the supported four-component schema";
    return observed;
  }
  observed.ascii_version = match.slice(1).join(".");
  if (Number(match[1]) !== 4) {
    observed.status = "unsupported_version";
    observed.reason = `The bounded header decoder supports NetImmerse4.x only, not ${observed.ascii_version}`;
    return observed;
  }
  const versionOffset = newline + 1,
    countOffset = versionOffset + 4,
    firstTypeOffset = countOffset + 4;
  if (bytes.length < firstTypeOffset) {
    observed.required_prefix_bytes = firstTypeOffset;
    observed.reason =
      "Binary version/count fields are outside the available prefix";
    return observed;
  }
  const version = bytes.readUInt32LE(versionOffset);
  const expected =
    (Number(match[1]) * 0x1000000 +
      Number(match[2]) * 0x10000 +
      Number(match[3]) * 0x100 +
      Number(match[4])) >>>
    0;
  observed.fields = {
    binary_version: {
      offset: versionOffset,
      size: 4,
      value: version,
      raw_hex: bytes.subarray(versionOffset, versionOffset + 4).toString("hex"),
    },
    declared_num_blocks: {
      offset: countOffset,
      size: 4,
      value: bytes.readUInt32LE(countOffset),
      raw_hex: bytes.subarray(countOffset, countOffset + 4).toString("hex"),
    },
  };
  if (version !== expected) {
    observed.status = "invalid_header";
    observed.reason =
      "Binary little-endian version disagrees with the ASCII version; do not reinterpret nearby bytes as a global string table";
    return observed;
  }
  const count = bytes.readUInt32LE(countOffset);
  if (count === 0) {
    observed.status = "header_fields_observed";
    observed.next_check =
      "The header declares zero blocks. Validate any footer with the version-matched schema; no objects have been decoded.";
    return observed;
  }
  if (bytes.length < firstTypeOffset + 4) {
    observed.required_prefix_bytes = firstTypeOffset + 4;
    observed.reason =
      "The first inline block-type length is outside the available prefix";
    return observed;
  }
  const typeLength = bytes.readUInt32LE(firstTypeOffset);
  observed.fields.first_inline_type_length = {
    offset: firstTypeOffset,
    size: 4,
    value: typeLength,
    raw_hex: bytes
      .subarray(firstTypeOffset, firstTypeOffset + 4)
      .toString("hex"),
  };
  if (typeLength < 6 || typeLength > 30) {
    observed.status = "invalid_header";
    observed.reason =
      "First inline block-type length is outside the documented pre-5.0.0.1 framing range; the file may be modified or unsupported";
    return observed;
  }
  const typeOffset = firstTypeOffset + 4;
  if (bytes.length < typeOffset + typeLength) {
    observed.required_prefix_bytes = typeOffset + typeLength;
    observed.reason =
      "The first inline block-type name is outside the available prefix";
    return observed;
  }
  const type = bytes.subarray(typeOffset, typeOffset + typeLength);
  if (type.some((byte) => byte < 32 || byte > 126)) {
    observed.status = "invalid_header";
    observed.reason =
      "First inline block-type name is not printable ASCII under the supported framing";
    return observed;
  }
  observed.first_inline_block = {
    type_offset: typeOffset,
    type_length: typeLength,
    type: type.toString("ascii"),
    payload_offset: typeOffset + typeLength,
  };
  observed.fields.first_inline_block_type = {
    offset: typeOffset,
    size: typeLength,
    value: type.toString("ascii"),
    raw_hex: type.toString("hex"),
  };
  observed.status = "header_fields_observed";
  observed.next_check = `This4.x layout stores type prefixes inline before objects, not a global block-type/string table. Decode ${observed.first_inline_block.type} sequentially with a matching schema and bounds checks; do not scan arbitrary offsets for a plausible table. Persist these header facts and unresolved object fields in the requested findings.`;
  return observed;
}
