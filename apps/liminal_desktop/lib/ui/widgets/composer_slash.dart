// Keep in sync with packages/core/src/composer_slash_commands.ts

enum SlashCommandKind {
  receiptWorkflow,
  attach,
  connect,
  disconnect,
  integrationsStatus,
  abort,
  help,
}

class SlashCommandDef {
  const SlashCommandDef({
    required this.name,
    this.aliases = const [],
    required this.summary,
    required this.usage,
    required this.kind,
  });

  final String name;
  final List<String> aliases;
  final String summary;
  final String usage;
  final SlashCommandKind kind;
}

class SlashCompletionItem {
  const SlashCompletionItem({
    required this.label,
    required this.insert,
    this.detail,
    required this.kind,
  });

  final String label;
  final String insert;
  final String? detail;
  final String kind; // command | provider | flag
}

class ParsedComposerSlash {
  const ParsedComposerSlash({
    required this.kind,
    required this.command,
    required this.args,
    required this.readOnly,
    required this.raw,
    required this.note,
  });

  final SlashCommandKind kind;
  final String command;
  final List<String> args;
  final bool readOnly;
  final String raw;
  final String note;
}

class SlashInputState {
  const SlashInputState({
    required this.lineStart,
    required this.lineEnd,
    required this.line,
    required this.tokenIndex,
    required this.tokens,
    required this.tokenPrefix,
  });

  final int lineStart;
  final int lineEnd;
  final String line;
  final int tokenIndex;
  final List<String> tokens;
  final String tokenPrefix;
}

const _providers = <({String id, String label})>[
  (id: 'slack', label: 'Slack'),
  (id: 'linear', label: 'Linear'),
  (id: 'notion', label: 'Notion'),
  (id: 'xero', label: 'Xero'),
  (id: 'github', label: 'GitHub'),
  (id: 'google', label: 'Google Workspace'),
  (id: 'microsoft', label: 'Microsoft 365'),
  (id: 'azure', label: 'Azure'),
];

const _commands = <SlashCommandDef>[
  SlashCommandDef(
    name: 'receipt',
    aliases: ['receipts', 'process-receipts'],
    summary: 'Process attached receipt image(s) into a Xero DRAFT bill',
    usage: '/receipt [note]',
    kind: SlashCommandKind.receiptWorkflow,
  ),
  SlashCommandDef(
    name: 'attach',
    summary: 'Attach an image file from disk',
    usage: '/attach <image-path>',
    kind: SlashCommandKind.attach,
  ),
  SlashCommandDef(
    name: 'connect',
    summary: 'Connect a hosted integration (opens browser OAuth)',
    usage: '/connect <provider> [--read-only]',
    kind: SlashCommandKind.connect,
  ),
  SlashCommandDef(
    name: 'disconnect',
    summary: 'Disconnect a hosted integration',
    usage: '/disconnect <provider>',
    kind: SlashCommandKind.disconnect,
  ),
  SlashCommandDef(
    name: 'integrations',
    aliases: ['status'],
    summary: 'Show connected integrations',
    usage: '/integrations',
    kind: SlashCommandKind.integrationsStatus,
  ),
  SlashCommandDef(
    name: 'abort',
    summary: 'Abort the in-flight agent turn',
    usage: '/abort',
    kind: SlashCommandKind.abort,
  ),
  SlashCommandDef(
    name: 'help',
    aliases: ['commands', '?'],
    summary: 'List composer slash commands',
    usage: '/help',
    kind: SlashCommandKind.help,
  ),
];

SlashCommandDef? resolveSlashCommandDef(String name) {
  final key = name.trim().toLowerCase();
  for (final def in _commands) {
    if (def.name == key) return def;
    if (def.aliases.any((a) => a == key)) return def;
  }
  return null;
}

({int lineStart, int lineEnd, String line}) lineAtCursor(String text, int cursor) {
  final safe = cursor.clamp(0, text.length);
  final before = text.substring(0, safe);
  final lineStart = before.lastIndexOf('\n') + 1;
  final after = text.substring(safe);
  final nl = after.indexOf('\n');
  final lineEnd = nl == -1 ? text.length : safe + nl;
  return (lineStart: lineStart, lineEnd: lineEnd, line: text.substring(lineStart, lineEnd));
}

({int slashStart, List<String> tokens})? tokenizeSlashLine(String line) {
  final trimmed = line.trimLeft();
  if (!trimmed.startsWith('/')) return null;
  final slashStart = line.length - trimmed.length + trimmed.indexOf('/');
  final body = trimmed.substring(1);
  if (body.isEmpty) return (slashStart: slashStart, tokens: ['']);
  return (slashStart: slashStart, tokens: body.split(RegExp(r'\s+')));
}

int cursorTokenIndex(String line, int cursorInLine, List<String> tokens) {
  if (tokens.isEmpty) return 0;
  var pos = line.indexOf('/') + 1;
  for (var i = 0; i < tokens.length; i++) {
    final tok = tokens[i];
    final start = line.indexOf(tok, pos);
    if (start < 0) return i;
    final end = start + tok.length;
    if (cursorInLine <= end || i == tokens.length - 1) return i;
    pos = end;
  }
  return tokens.length - 1;
}

SlashInputState? detectSlashInput(String text, int cursor) {
  final loc = lineAtCursor(text, cursor);
  final parsed = tokenizeSlashLine(loc.line);
  if (parsed == null) return null;
  final cursorInLine = cursor - loc.lineStart;
  final tokenIndex = cursorTokenIndex(loc.line, cursorInLine, parsed.tokens);
  return SlashInputState(
    lineStart: loc.lineStart,
    lineEnd: loc.lineEnd,
    line: loc.line,
    tokenIndex: tokenIndex,
    tokens: parsed.tokens,
    tokenPrefix: parsed.tokens[tokenIndex],
  );
}

List<SlashCompletionItem> listSlashCompletions(String text, int cursor) {
  final state = detectSlashInput(text, cursor);
  if (state == null) return [];

  if (state.tokenIndex == 0) {
    final q = state.tokenPrefix.toLowerCase();
    final out = <SlashCompletionItem>[];
    final seen = <String>{};
    for (final def in _commands) {
      for (final name in [def.name, ...def.aliases]) {
        if (q.isNotEmpty && !name.startsWith(q)) continue;
        final label = '/$name';
        if (seen.add(label)) {
          out.add(SlashCompletionItem(
            label: label,
            insert: name,
            detail: def.summary,
            kind: 'command',
          ));
        }
      }
    }
    return out;
  }

  final cmdDef = resolveSlashCommandDef(state.tokens.first);
  if (cmdDef == null) return [];

  if ((cmdDef.kind == SlashCommandKind.connect ||
          cmdDef.kind == SlashCommandKind.disconnect) &&
      state.tokenIndex == 1) {
    final q = state.tokenPrefix.toLowerCase();
    return _providers
        .where((p) =>
            q.isEmpty ||
            p.id.startsWith(q) ||
            p.label.toLowerCase().contains(q))
        .map((p) => SlashCompletionItem(
              label: p.id,
              insert: p.id,
              detail: p.label,
              kind: 'provider',
            ))
        .toList();
  }

  if (cmdDef.kind == SlashCommandKind.connect && state.tokenIndex >= 2) {
    final q = state.tokenPrefix.toLowerCase();
    if (q.isEmpty || '--read-only'.startsWith(q)) {
      return const [
        SlashCompletionItem(
          label: '--read-only',
          insert: '--read-only',
          detail: 'OAuth with read-only scopes',
          kind: 'flag',
        ),
      ];
    }
  }

  return const [];
}

({String text, int cursor}) applySlashCompletion(
  String text,
  int cursor,
  SlashCompletionItem item,
) {
  final state = detectSlashInput(text, cursor);
  if (state == null) return (text: text, cursor: cursor);

  final tokens = List<String>.from(state.tokens);
  tokens[item.kind == 'command' ? 0 : state.tokenIndex] = item.insert;
  final trimmedLine = state.line.trimLeft();
  final lead = state.line.substring(0, state.line.length - trimmedLine.length);
  final rebuilt = '/${tokens.join(' ')}';
  final suffix = item.kind == 'flag' ? '' : ' ';
  final newLine = '$lead$rebuilt$suffix';
  final newText = text.substring(0, state.lineStart) + newLine + text.substring(state.lineEnd);
  return (text: newText, cursor: state.lineStart + newLine.length);
}

ParsedComposerSlash? parseComposerSlashSubmit(String text) {
  final trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  final receiptRe = RegExp(r'^/(?:receipt|receipts|process-receipts)(?:\s+(.*))?$', caseSensitive: false);
  final receiptMatch = receiptRe.firstMatch(trimmed);
  if (receiptMatch != null) {
    return ParsedComposerSlash(
      kind: SlashCommandKind.receiptWorkflow,
      command: trimmed.split(RegExp(r'\s+')).first.substring(1).toLowerCase(),
      args: const [],
      readOnly: false,
      raw: trimmed,
      note: (receiptMatch.group(1) ?? '').trim(),
    );
  }

  final parts = trimmed.split(RegExp(r'\s+'));
  final cmdRaw = parts.first.substring(1).toLowerCase();
  final def = resolveSlashCommandDef(cmdRaw);
  if (def == null) return null;

  final readOnly = parts.contains('--read-only');
  final rest = parts.skip(1).where((p) => p != '--read-only').toList();

  if (def.kind == SlashCommandKind.attach) {
    var path = rest.join(' ').trim();
    if ((path.startsWith('"') && path.endsWith('"')) ||
        (path.startsWith("'") && path.endsWith("'"))) {
      path = path.substring(1, path.length - 1).trim();
    }
    return ParsedComposerSlash(
      kind: SlashCommandKind.attach,
      command: def.name,
      args: path.isEmpty ? const [] : [path],
      readOnly: false,
      raw: trimmed,
      note: '',
    );
  }

  if (def.kind == SlashCommandKind.connect || def.kind == SlashCommandKind.disconnect) {
    final provider = rest.isNotEmpty ? rest.first.toLowerCase() : '';
    return ParsedComposerSlash(
      kind: def.kind,
      command: def.name,
      args: provider.isEmpty ? const [] : [provider],
      readOnly: readOnly,
      raw: trimmed,
      note: '',
    );
  }

  return ParsedComposerSlash(
    kind: def.kind,
    command: def.name,
    args: rest,
    readOnly: readOnly,
    raw: trimmed,
    note: rest.join(' ').trim(),
  );
}

String formatSlashHelpText() {
  final buf = StringBuffer('Composer slash commands:\n');
  for (final def in _commands) {
    final aliases = def.aliases.isEmpty ? '' : ' (/${def.aliases.join(', /')})';
    buf.writeln('  /${def.name}$aliases — ${def.summary}');
    buf.writeln('    ${def.usage}');
  }
  buf.write('Tab or ↑↓ complete while typing.');
  return buf.toString();
}
