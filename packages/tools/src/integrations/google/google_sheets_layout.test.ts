import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAutoFitBatchRequests,
  colLettersToIndex,
  estimateColumnPixelWidths,
  inferGridBoundsFromValues,
  parseA1Range,
  spacerColumnIndices,
} from "./google_sheets_layout.js";

test("colLettersToIndex maps A and AA", () => {
  assert.equal(colLettersToIndex("A"), 0);
  assert.equal(colLettersToIndex("D"), 3);
  assert.equal(colLettersToIndex("AA"), 26);
});

test("parseA1Range parses sheet-qualified range", () => {
  const p = parseA1Range("Companies!B2:F40");
  assert.ok(p);
  assert.equal(p!.sheetTitle, "Companies");
  assert.equal(p!.startCol, 1);
  assert.equal(p!.endCol, 6);
  assert.equal(p!.startRow, 1);
  assert.equal(p!.endRow, 40);
});

test("inferGridBoundsFromValues expands anchor cell from values shape", () => {
  const parsed = parseA1Range("Sheet1!A1")!;
  const bounds = inferGridBoundsFromValues(parsed, [
    ["Name", "", "Program"],
    ["Acme", "", "GPU"],
  ]);
  assert.equal(bounds.endCol, 3);
  assert.equal(bounds.endRow, 2);
});

test("spacerColumnIndices detects empty gutter columns", () => {
  const spacers = spacerColumnIndices([
    ["A", "", "B"],
    ["C", "", "D"],
  ]);
  assert.deepEqual([...spacers], [1]);
});

test("buildAutoFitBatchRequests uses fixed width for spacer columns", () => {
  const requests = buildAutoFitBatchRequests({
    sheetId: 0,
    bounds: { startCol: 0, endCol: 3, startRow: 0, endRow: 2 },
    values: [
      ["Name", "", "Deal"],
      ["Foo", "", "Bar"],
    ],
  });
  assert.ok(requests.some((r) => "updateDimensionProperties" in r));
  assert.ok(requests.some((r) => "autoResizeDimensions" in r));
});

test("estimateColumnPixelWidths caps wide headers", () => {
  const widths = estimateColumnPixelWidths([["Short", "A very long column header indeed"]], new Set());
  assert.ok(widths[1]! > widths[0]!);
  assert.ok(widths[1]! <= 420);
});
