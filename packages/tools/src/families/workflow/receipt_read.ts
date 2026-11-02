import { mkdir, stat, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentHarness } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
export function createReceiptReadTool(harness: AgentHarness) {
  return defineTool({
    name: "receipt_read",
    description:
      "Read the active receipt workflow attachments with LOCAL OCR. Uses no hosted vision or secondary language model. Returns extracted text and confidence; amounts still require validation/review. English OCR language data is downloaded once and cached locally. Only the receipt images attached to this workflow are readable.",
    requiresApproval: false,
    dangerLevel: "safe",
    resourceLocks: () => [`receipt-ocr:${harness.workspaceRoot}`],
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async (_args, emit) => {
      const run = harness.signatureWorkflow;
      if (!run || run.preset !== "receipt_to_xero" || !run.sources.length)
        return {
          ok: false,
          error:
            "Start /receipt with an attached PNG, JPEG, or WebP receipt image.",
        };
      let worker: import("tesseract.js").Worker | undefined;
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const images = [];
        for (const file of run.sources) {
          const s = await stat(file);
          if (!s.isFile() || s.size > 10 * 1024 * 1024)
            throw Error("Receipt images must be files of 10 MiB or less");
          if (!/\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file))
            throw Error(
              "Local receipt OCR supports images; convert PDF pages to images before attaching.",
            );
          images.push({ file, buffer: await readFile(file) });
        }
        emit?.("Reading receipt locally…");
        const cachePath = path.join(
          harness.workspaceRoot,
          ".agent_artifacts",
          "ocr-cache",
        );
        await mkdir(cachePath, { recursive: true });
        const { createWorker } = await import("tesseract.js");
        const operation = (async () => {
          worker = await createWorker("eng", 1, {
            cachePath,
            errorHandler: () => {
              /* The library already rejects the pending operation; suppress its duplicate uncaught throw. */
            },
          });
          if (timedOut) {
            await worker.terminate();
            throw Error("OCR initialisation timed out");
          }
          const results = [];
          for (const image of images) {
            const r = await worker.recognize(image.buffer);
            if (!r.data.text.trim())
              throw Error(
                "No readable receipt text found. Try a sharper, upright image.",
              );
            if (r.data.confidence < 60)
              throw Error(
                "Receipt OCR confidence is too low for an expense review. Upload a sharper, upright image or use a vision-capable selected model.",
              );
            results.push({
              file: image.file,
              text: r.data.text,
              confidence: r.data.confidence,
              reviewRequired: true,
            });
          }
          return results;
        })();
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(
              Error(
                "Local OCR timed out after 60 seconds. Check first-use language download access or retry with a smaller image.",
              ),
            );
          }, 60000);
        });
        const results = await Promise.race([operation, timeout]);
        return {
          ok: true,
          output: JSON.stringify(
            { engine: "local_tesseract", language: "eng", receipts: results },
            null,
            2,
          ),
        };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      } finally {
        if (timer) clearTimeout(timer);
        if (worker && !timedOut) await worker.terminate();
        else if (worker) void worker.terminate().catch(() => {});
      }
    },
  });
}
