import assert from "node:assert/strict";
import { test } from "node:test";
import { slackUploadFileV2 } from "./slack_upload_v2.js";

test("slackUploadFileV2 runs getUploadURL → POST bytes → completeUploadExternal", async () => {
  const steps: string[] = [];
  const result = await slackUploadFileV2(
    {
      getUploadUrl: async (fields) => {
        steps.push(`prep:${fields.filename}:${fields.length}`);
        return { ok: true, uploadUrl: "https://upload.example/1", fileId: "F1" };
      },
      postBytes: async (url, bytes) => {
        steps.push(`post:${url}:${bytes.byteLength}`);
        return { ok: true };
      },
      completeUpload: async (body) => {
        steps.push(`complete:${body.channel_id}:${body.files[0]?.id}`);
        return { ok: true, data: { ok: true, files: body.files } };
      },
    },
    { channel: "C1", filename: "note.txt", content: "hello", initialComment: "hi" }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(steps, ["prep:note.txt:5", "post:https://upload.example/1:5", "complete:C1:F1"]);
});
