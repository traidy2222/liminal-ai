import 'dart:convert';

import 'email_copy_sanitize.dart';

/// Live preview of streaming tool-call payloads (parity with @liminal/core streaming_write_preview).

class StreamingWriteToolSpec {
  const StreamingWriteToolSpec({
    required this.contentFields,
    required this.labelFields,
    this.rawArgsFallback = false,
  });

  final List<String> contentFields;
  final List<String> labelFields;
  final bool rawArgsFallback;
}

class StreamingWritePreview {
  const StreamingWritePreview({
    required this.toolName,
    this.field,
    this.label,
    required this.content,
    required this.charCount,
    required this.lineCount,
    required this.incomplete,
    this.rawArgsTail,
  });

  final String toolName;
  final String? field;
  final String? label;
  final String content;
  final int charCount;
  final int lineCount;
  final bool incomplete;
  final String? rawArgsTail;
}

const fileEditDockTools = {'write_file', 'edit_file', 'multi_file_apply'};

const emailComposeDockTools = {
  'gmail_create_draft',
  'gmail_send_message',
  'outlook_create_draft',
  'outlook_send_message',
};

bool isFileEditDockTool(String toolName) => fileEditDockTools.contains(toolName);

bool isEmailComposeDockTool(String toolName) => emailComposeDockTools.contains(toolName);

bool isComposeDockTool(String toolName) =>
    isFileEditDockTool(toolName) || isEmailComposeDockTool(toolName);

bool shouldCloseComposeDockOnToolResult(String toolName) => isComposeDockTool(toolName);

const _streamingWriteToolSpecs = <String, StreamingWriteToolSpec>{
  'write_file': StreamingWriteToolSpec(
    contentFields: ['content'],
    labelFields: ['path'],
  ),
  'edit_file': StreamingWriteToolSpec(
    contentFields: ['diff', 'replace', 'new_string', 'replacements'],
    labelFields: ['path'],
    rawArgsFallback: true,
  ),
  'multi_file_apply': StreamingWriteToolSpec(
    contentFields: [],
    labelFields: [],
    rawArgsFallback: true,
  ),
  'gmail_create_draft': StreamingWriteToolSpec(
    contentFields: ['body_html', 'body'],
    labelFields: ['subject'],
  ),
  'gmail_send_message': StreamingWriteToolSpec(
    contentFields: ['body_html', 'body'],
    labelFields: ['subject'],
  ),
  'outlook_create_draft': StreamingWriteToolSpec(
    contentFields: ['body_html', 'body'],
    labelFields: ['subject'],
  ),
  'outlook_send_message': StreamingWriteToolSpec(
    contentFields: ['body_html', 'body'],
    labelFields: ['subject'],
  ),
};

class EmailStreamPreview {
  const EmailStreamPreview({
    this.subject,
    this.recipients,
    this.bodyHtml,
    this.bodyPlain,
    this.htmlIncomplete = true,
    this.plainCharCount = 0,
  });

  final String? subject;
  final String? recipients;
  final String? bodyHtml;
  final String? bodyPlain;
  final bool htmlIncomplete;
  final int plainCharCount;
}

String? tryExtractRecipientsPreview(String raw) {
  if (raw.isEmpty) return null;
  try {
    final decoded = jsonDecode(raw);
    if (decoded is Map) {
      final to = decoded['to'];
      if (to is List) {
        final parts = to.map((e) => e.toString().trim()).where((s) => s.isNotEmpty);
        final joined = parts.join(', ');
        if (joined.isNotEmpty) return joined;
      }
    }
  } catch (_) {
    // Streaming partial JSON — fall through.
  }
  final idx = raw.indexOf('"to"');
  if (idx < 0) return null;
  final end = idx + 600 < raw.length ? idx + 600 : raw.length;
  final slice = raw.substring(idx, end);
  final emails = RegExp(r'[\w.+-]+@[\w.-]+\.\w+')
      .allMatches(slice)
      .map((m) => m.group(0))
      .whereType<String>()
      .toSet()
      .toList();
  if (emails.isEmpty) return null;
  return emails.join(', ');
}

EmailStreamPreview extractEmailStreamPreview(String toolName, String argsJson) {
  final subjectPartial = decodePartialJsonStringField(argsJson, 'subject');
  final subjectClosed = tryExtractJsonStringField(argsJson, 'subject');
  final subject = sanitizeEmailPreviewCopy(
    (subjectClosed ?? subjectPartial.value).trim(),
  );

  final htmlPartial = decodePartialJsonStringField(argsJson, 'body_html');
  final htmlClosed = tryExtractJsonStringField(argsJson, 'body_html');
  final htmlStreaming = htmlPartial.started && !htmlPartial.closed && htmlClosed == null;
  final bodyHtmlRaw = htmlPartial.value.isNotEmpty
      ? htmlPartial.value
      : (htmlClosed ?? '');
  // Do not humanize HTML markup — only repair mojibake; structure must stay intact.
  final bodyHtml = bodyHtmlRaw.isNotEmpty
      ? (htmlStreaming ? bodyHtmlRaw : repairEmailUnicode(bodyHtmlRaw))
      : '';

  final plainPartial = decodePartialJsonStringField(argsJson, 'body');
  final plainClosed = tryExtractJsonStringField(argsJson, 'body');
  final plainStreaming = plainPartial.started && !plainPartial.closed && plainClosed == null;
  final bodyPlainRaw = plainPartial.value.isNotEmpty
      ? plainPartial.value
      : (plainClosed ?? '');
  final bodyPlain = bodyPlainRaw.isNotEmpty
      ? (plainStreaming ? bodyPlainRaw : sanitizeEmailPreviewCopy(bodyPlainRaw))
      : '';

  final recipients = tryExtractRecipientsPreview(argsJson);

  return EmailStreamPreview(
    subject: subject.isNotEmpty ? subject : null,
    recipients: recipients,
    bodyHtml: bodyHtml.isNotEmpty ? bodyHtml : null,
    bodyPlain: bodyPlain.isNotEmpty ? bodyPlain : null,
    htmlIncomplete: bodyHtml.isNotEmpty ? !htmlPartial.closed && htmlClosed == null : true,
    plainCharCount: bodyPlain.length,
  );
}

class PartialJsonStringField {
  const PartialJsonStringField({
    required this.value,
    required this.started,
    required this.closed,
  });

  final String value;
  final bool started;
  final bool closed;
}

String? tryExtractJsonStringField(String raw, String fieldName) {
  final pattern = RegExp(
    '"${RegExp.escape(fieldName)}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"',
  );
  final match = pattern.firstMatch(raw);
  if (match == null) return null;
  try {
    return jsonDecode('"${match.group(1)}"') as String;
  } catch (_) {
    return match.group(1)?.replaceAll(r'\"', '"').replaceAll(r'\\', r'\');
  }
}

PartialJsonStringField decodePartialJsonStringField(String raw, String fieldName) {
  final contentKey = '"$fieldName"';
  final keyIdx = raw.indexOf(contentKey);
  if (keyIdx < 0) {
    return const PartialJsonStringField(value: '', started: false, closed: false);
  }

  var i = keyIdx + contentKey.length;
  while (i < raw.length && RegExp(r'[\s:]').hasMatch(raw[i])) {
    i++;
  }
  if (i >= raw.length || raw[i] != '"') {
    return const PartialJsonStringField(value: '', started: true, closed: false);
  }

  final start = i + 1;
  var j = start;
  while (j < raw.length) {
    final c = raw[j];
    if (c == r'\') {
      j += 2;
      continue;
    }
    if (c == '"') {
      return PartialJsonStringField(
        value: _decodeJsonStringBody(raw.substring(start, j)),
        started: true,
        closed: true,
      );
    }
    j++;
  }
  return PartialJsonStringField(
    value: _decodeJsonStringBody(raw.substring(start)),
    started: true,
    closed: false,
  );
}

String _decodeJsonStringBody(String body) {
  try {
    return jsonDecode('"$body"') as String;
  } catch (_) {
    // Streaming partial JSON — fall through to incremental decode.
  }
  final out = StringBuffer();
  for (var i = 0; i < body.length; i++) {
    final c = body[i];
    if (c != r'\') {
      out.write(c);
      continue;
    }
    if (i + 1 >= body.length) break;
    final n = body[++i];
    switch (n) {
      case '"':
        out.write('"');
      case r'\':
        out.write(r'\');
      case '/':
        out.write('/');
      case 'b':
        out.write('\b');
      case 'f':
        out.write('\f');
      case 'n':
        out.write('\n');
      case 'r':
        out.write('\r');
      case 't':
        out.write('\t');
      case 'u':
        if (i + 4 < body.length) {
          final hex = body.substring(i + 1, i + 5);
          final code = int.tryParse(hex, radix: 16);
          if (code != null) {
            out.writeCharCode(code);
            i += 4;
          }
        }
      default:
        out.write(n);
    }
  }
  return out.toString();
}

String? _resolveStreamingLabel(String argsJson, List<String> labelFields) {
  for (final lf in labelFields) {
    final closed = tryExtractJsonStringField(argsJson, lf);
    if (closed != null && closed.isNotEmpty) return closed;
    final partial = decodePartialJsonStringField(argsJson, lf);
    if (partial.value.isNotEmpty) return partial.value;
  }
  return null;
}

StreamingWritePreview? extractStreamingWritePreview(
  String toolName,
  String argsJson, {
  int tailLines = 24,
  int maxChars = 24000,
  bool fullContent = false,
}) {
  final spec = _streamingWriteToolSpecs[toolName];
  if (spec == null) return null;

  final raw = argsJson;
  final label = raw.isNotEmpty ? _resolveStreamingLabel(raw, spec.labelFields) : null;

  if (raw.isEmpty) {
    return StreamingWritePreview(
      toolName: toolName,
      field: spec.contentFields.isNotEmpty ? spec.contentFields.first : null,
      label: null,
      content: '',
      charCount: 0,
      lineCount: 0,
      incomplete: true,
    );
  }

  for (final cf in spec.contentFields) {
    final partial = decodePartialJsonStringField(raw, cf);
    if (partial.value.isNotEmpty || partial.started) {
      final full = partial.value.length > maxChars
          ? partial.value.substring(0, maxChars)
          : partial.value;
      final lines = full.split('\n');
      final tail = lines.length > tailLines ? lines.sublist(lines.length - tailLines) : lines;
      return StreamingWritePreview(
        toolName: toolName,
        field: cf,
        label: label,
        content: fullContent ? full : tail.join('\n'),
        charCount: partial.value.length,
        lineCount: lines.length,
        incomplete: !partial.closed,
      );
    }
  }

  if (spec.rawArgsFallback || spec.contentFields.isEmpty) {
    final tailLen = raw.length > 800 ? 800 : raw.length;
    return StreamingWritePreview(
      toolName: toolName,
      field: null,
      label: label,
      content: '',
      charCount: 0,
      lineCount: 0,
      incomplete: true,
      rawArgsTail: raw.substring(raw.length - tailLen),
    );
  }

  final tailLen = raw.length > 800 ? 800 : raw.length;
  return StreamingWritePreview(
    toolName: toolName,
    field: spec.contentFields.isNotEmpty ? spec.contentFields.first : null,
    label: label,
    content: '',
    charCount: 0,
    lineCount: 0,
    incomplete: true,
    rawArgsTail: raw.substring(raw.length - tailLen),
  );
}