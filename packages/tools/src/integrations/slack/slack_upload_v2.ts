/**
 * Slack external file upload (replaces deprecated files.upload).
 * @see https://docs.slack.dev/reference/methods/files.getUploadURLExternal
 */

export type SlackUploadV2Deps = {
  getUploadUrl: (fields: { filename: string; length: string }) => Promise<
    | { ok: true; uploadUrl: string; fileId: string }
    | { ok: false; error: string }
  >;
  postBytes: (uploadUrl: string, bytes: Uint8Array) => Promise<{ ok: true } | { ok: false; error: string }>;
  completeUpload: (body: {
    files: Array<{ id: string; title: string }>;
    channel_id: string;
    initial_comment?: string;
  }) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
};

/** Upload UTF-8 text content to a channel via files.getUploadURLExternal + completeUploadExternal. */
export async function slackUploadFileV2(
  deps: SlackUploadV2Deps,
  opts: {
    channel: string;
    filename: string;
    content: string;
    initialComment?: string;
  }
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const bytes = new TextEncoder().encode(opts.content);
  const prep = await deps.getUploadUrl({
    filename: opts.filename,
    length: String(bytes.byteLength),
  });
  if (!prep.ok) return prep;

  const posted = await deps.postBytes(prep.uploadUrl, bytes);
  if (!posted.ok) return posted;

  const body: {
    files: Array<{ id: string; title: string }>;
    channel_id: string;
    initial_comment?: string;
  } = {
    files: [{ id: prep.fileId, title: opts.filename }],
    channel_id: opts.channel,
  };
  if (opts.initialComment) body.initial_comment = opts.initialComment;

  return deps.completeUpload(body);
}
