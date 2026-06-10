import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDocumentStyleRequests,
  buildRequestsForBlocks,
  buildTableCellInsertRequests,
  buildTablePolishRequests,
  extractDocumentText,
  getBodyAppendIndex,
  normalizeTableRows,
  parseDocsBlocksArg,
} from "./google_docs_build.js";

test("getBodyAppendIndex uses last content endIndex", () => {
  assert.equal(
    getBodyAppendIndex({
      body: {
        content: [
          { startIndex: 1, endIndex: 5 },
          { startIndex: 5, endIndex: 42 },
        ],
      },
    }),
    41
  );
});

test("extractDocumentText renders headings and tables", () => {
  const out = extractDocumentText({
    title: "Report",
    body: {
      content: [
        {
          paragraph: {
            paragraphStyle: { namedStyleType: "HEADING_1" },
            elements: [{ textRun: { content: "Summary\n" } }],
          },
        },
        {
          paragraph: {
            elements: [{ textRun: { content: "Body paragraph.\n" } }],
          },
        },
        {
          table: {
            tableRows: [
              {
                tableCells: [
                  { content: [{ paragraph: { elements: [{ textRun: { content: "A\n" } }] } }] },
                  { content: [{ paragraph: { elements: [{ textRun: { content: "B\n" } }] } }] },
                ],
              },
            ],
          },
        },
      ],
    },
  });
  assert.equal(out.title, "Report");
  assert.match(out.plain_text, /# Summary/);
  assert.match(out.plain_text, /Body paragraph/);
  assert.match(out.plain_text, /\| A \| B \|/);
});

test("parseDocsBlocksArg accepts JSON string or single object", () => {
  const fromStr = parseDocsBlocksArg('[{"type":"paragraph","text":"Hi"}]');
  assert.ok(!("error" in fromStr));
  assert.equal(fromStr.length, 1);
  const fromObj = parseDocsBlocksArg({ type: "heading", level: 1, text: "T" });
  assert.ok(!("error" in fromObj));
  assert.equal(fromObj.length, 1);
});

test("buildRequestsForBlocks creates heading and bullet requests", () => {
  const { requests } = buildRequestsForBlocks(
    [
      { type: "heading", level: 2, text: "Section" },
      { type: "bullet_list", items: ["One", "Two"] },
    ],
    1
  );
  assert.ok(requests.some((r) => "insertText" in r));
  assert.ok(requests.some((r) => "updateParagraphStyle" in r));
  assert.ok(requests.some((r) => "createParagraphBullets" in r));
});

test("normalizeTableRows accepts 2D array or flat header row", () => {
  assert.deepEqual(
    normalizeTableRows([
      ["H1", "H2"],
      ["a", "b"],
    ]),
    [
      ["H1", "H2"],
      ["a", "b"],
    ]
  );
  assert.deepEqual(normalizeTableRows(["only", "one", "row"]), [["only", "one", "row"]]);
});

test("buildTableCellInsertRequests targets last table in descending index order", () => {
  const cell = (startIndex: number) => ({
    content: [{ paragraph: { elements: [{ startIndex, textRun: { content: "\n" } }] } }],
  });
  const doc = {
    body: {
      content: [
        {
          table: {
            tableRows: [{ tableCells: [cell(10)] }],
          },
        },
        {
          table: {
            tableRows: [
              { tableCells: [cell(100), cell(105)] },
              { tableCells: [cell(110), cell(115)] },
            ],
          },
        },
      ],
    },
  };
  const reqs = buildTableCellInsertRequests(doc, [
    ["H1", "H2"],
    ["A", "B"],
  ]);
  assert.equal(reqs.length, 4);
  const indices = reqs.map(
    (r) => (r.insertText as { location: { index: number } }).location.index
  );
  assert.deepEqual(indices, [115, 110, 105, 100]);
  assert.match(
    String((reqs[0]!.insertText as { text: string }).text),
    /^B/
  );
});

test("buildRequestsForBlocks table block uses row and column counts from normalized rows", () => {
  const { requests } = buildRequestsForBlocks(
    [{ type: "table", rows: [["A", "B", "C"], ["1", "2", "3"]] }],
    1
  );
  const insert = requests.find((r) => "insertTable" in r)?.insertTable as {
    rows: number;
    columns: number;
  };
  assert.equal(insert.rows, 2);
  assert.equal(insert.columns, 3);
});

test("buildRequestsForBlocks title subtitle and divider apply named styles", () => {
  const { requests } = buildRequestsForBlocks(
    [
      { type: "title", text: "Report" },
      { type: "subtitle", text: "Q1 Summary" },
      { type: "divider" },
    ],
    1
  );
  const paraStyles = requests
    .filter((r) => "updateParagraphStyle" in r)
    .map((r) => (r.updateParagraphStyle as { paragraphStyle: { namedStyleType?: string } }).paragraphStyle);
  assert.ok(paraStyles.some((s) => s.namedStyleType === "TITLE"));
  assert.ok(paraStyles.some((s) => s.namedStyleType === "SUBTITLE"));
  assert.ok(
    requests.some(
      (r) =>
        "updateParagraphStyle" in r &&
        (r.updateParagraphStyle as { paragraphStyle: { borderBottom?: unknown } }).paragraphStyle.borderBottom
    )
  );
});

test("buildTablePolishRequests styles header row and columns", () => {
  const tableEl = {
    startIndex: 50,
    table: {
      tableRows: [{ tableCells: [{}, {}] }, { tableCells: [{}, {}] }],
    },
  };
  const reqs = buildTablePolishRequests(tableEl, 2);
  assert.ok(reqs.some((r) => "updateTableRowStyle" in r));
  assert.ok(reqs.some((r) => "updateTableCellStyle" in r));
  assert.ok(reqs.some((r) => "updateTableColumnProperties" in r));
});

test("buildDocumentStyleRequests sets margins", () => {
  const reqs = buildDocumentStyleRequests({ margin_top_pt: 72, margin_left_pt: 72 });
  assert.equal(reqs.length, 1);
  const style = (reqs[0]!.updateDocumentStyle as { fields: string }).fields;
  assert.match(style, /marginTop/);
  assert.match(style, /marginLeft/);
});
