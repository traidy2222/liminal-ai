import 'package:flutter/material.dart';

import '../../models/file_edit_view_state.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';
import 'email_html_preview.dart';

/// Collapsible live compose panel — files (monospace) and email (HTML preview).
class FileEditDock extends StatefulWidget {
  const FileEditDock({
    super.key,
    required this.view,
    required this.expanded,
    required this.onToggleExpanded,
    this.width = 420,
    this.collapsedWidth = 44,
  });

  final FileEditViewState view;
  final bool expanded;
  final VoidCallback onToggleExpanded;
  final double width;
  final double collapsedWidth;

  @override
  State<FileEditDock> createState() => _FileEditDockState();
}

class _FileEditDockState extends State<FileEditDock> {
  final ScrollController _scroll = ScrollController();

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant FileEditDock oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.view.updatedAt != oldWidget.view.updatedAt) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToEnd());
    }
  }

  void _scrollToEnd() {
    if (!_scroll.hasClients) return;
    _scroll.animateTo(
      _scroll.position.maxScrollExtent,
      duration: const Duration(milliseconds: 120),
      curve: Curves.easeOut,
    );
  }

  String _phaseLabel(FileEditViewState view) {
    if (view.isEmail) {
      switch (view.phase) {
        case FileEditPhase.streaming:
          return view.incomplete ? 'streaming' : 'ready';
        case FileEditPhase.pendingApproval:
          return 'awaiting approval';
        case FileEditPhase.writing:
          if (view.toolName == 'gmail_send_message' ||
              view.toolName == 'outlook_send_message') {
            return 'sending…';
          }
          return 'drafting…';
      }
    }
    switch (view.phase) {
      case FileEditPhase.streaming:
        return view.incomplete ? 'streaming' : 'args complete';
      case FileEditPhase.pendingApproval:
        return 'awaiting approval';
      case FileEditPhase.writing:
        return 'writing to disk…';
    }
  }

  String _headerTitle(FileEditViewState view) {
    if (view.isEmail) {
      if (view.toolName == 'gmail_create_draft' || view.toolName == 'outlook_create_draft') {
        return 'Email draft';
      }
      return 'Email send';
    }
    return view.toolName;
  }

  String _headerSubtitle(FileEditViewState view) {
    if (view.isEmail) {
      final subject = view.subject?.trim();
      if (subject != null && subject.isNotEmpty) return subject;
      final path = view.path?.trim();
      if (path != null && path.isNotEmpty) return path;
      return 'Preparing message…';
    }
    final p = view.path?.trim();
    if (p != null && p.isNotEmpty) return p;
    return 'Resolving path…';
  }

  String _bodyText(FileEditViewState view) {
    final content = view.content;
    if (content.isNotEmpty) return content;
    if (view.phase == FileEditPhase.streaming && view.charCount == 0) {
      return view.isEmail ? 'Waiting for email content…' : 'Waiting for file content…';
    }
    return '';
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final theme = Theme.of(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        final maxW = constraints.maxWidth;
        final maxH = constraints.maxHeight;
        if (!maxW.isFinite || !maxH.isFinite || maxW <= 0 || maxH <= 0) {
          return const SizedBox.shrink();
        }

        if (!widget.expanded) {
          return SizedBox(
            width: widget.collapsedWidth.clamp(0, maxW),
            height: maxH,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: lim.panel.withValues(alpha: 0.98),
                border: Border(left: BorderSide(color: lim.border)),
              ),
              child: _collapsedRail(context, lim),
            ),
          );
        }

        return DecoratedBox(
          decoration: BoxDecoration(
            color: lim.panel.withValues(alpha: 0.98),
            border: Border(left: BorderSide(color: lim.border)),
          ),
          child: SizedBox(
            width: maxW,
            height: maxH,
            child: _expandedBody(context, lim, theme, maxW),
          ),
        );
      },
    );
  }

  Widget _collapsedRail(BuildContext context, LiminalTokens lim) {
    final isEmail = widget.view.isEmail;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: widget.onToggleExpanded,
        child: Tooltip(
          message: isEmail ? 'Expand email preview' : 'Expand file editor',
          child: Center(
            child: RotatedBox(
              quarterTurns: 1,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    isEmail ? Icons.mail_outline : Icons.edit_note,
                    color: lim.accent,
                    size: 18,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    isEmail ? 'Email' : 'File',
                    style: TextStyle(
                      color: lim.accent,
                      fontSize: 11,
                      letterSpacing: 0.6,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _expandedBody(
    BuildContext context,
    LiminalTokens lim,
    ThemeData theme,
    double panelWidth,
  ) {
    final view = widget.view;
    final stats = _buildStatsLine(view);
    final showPhaseChip = panelWidth >= 280;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Material(
          color: lim.panel.withValues(alpha: 0.95),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: LiminalSpacing.sm,
              vertical: LiminalSpacing.xs,
            ),
            child: Row(
              children: [
                Icon(
                  view.isEmail ? Icons.mail_outline : Icons.edit_note,
                  color: lim.accent,
                  size: 18,
                ),
                const SizedBox(width: LiminalSpacing.xs),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _headerTitle(view),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleSmall?.copyWith(color: lim.text),
                      ),
                      Text(
                        _headerSubtitle(view),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall?.copyWith(color: lim.textMuted),
                      ),
                      if (view.isEmail &&
                          view.recipients != null &&
                          view.recipients!.trim().isNotEmpty)
                        Text(
                          'To: ${view.recipients}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: lim.textMuted,
                            fontSize: 11,
                          ),
                        ),
                    ],
                  ),
                ),
                if (showPhaseChip) ...[
                  const SizedBox(width: 4),
                  Flexible(
                    fit: FlexFit.loose,
                    child: _PhaseChip(label: _phaseLabel(view), lim: lim),
                  ),
                ],
                IconButton(
                  tooltip: 'Collapse panel',
                  visualDensity: VisualDensity.compact,
                  icon: Icon(Icons.chevron_right, color: lim.textMuted, size: 20),
                  onPressed: widget.onToggleExpanded,
                ),
              ],
            ),
          ),
        ),
        Divider(height: 1, color: lim.border),
        Expanded(child: _previewBody(context, lim, theme, view)),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            LiminalSpacing.sm,
            LiminalSpacing.xs,
            LiminalSpacing.sm,
            LiminalSpacing.sm,
          ),
          child: Text(
            stats,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall?.copyWith(
              color: lim.textMuted,
              height: 1.35,
            ),
          ),
        ),
      ],
    );
  }

  String _buildStatsLine(FileEditViewState view) {
    if (view.isEmail) {
      final htmlLen = view.bodyHtml?.length ?? 0;
      if (htmlLen > 0) {
        return '$htmlLen HTML chars · ${_phaseLabel(view)}';
      }
      if (view.charCount > 0) {
        return '${view.charCount} chars · ${_phaseLabel(view)}';
      }
      return _phaseLabel(view);
    }
    if (view.charCount > 0) {
      return '${view.charCount} chars · ${view.lineCount} lines';
    }
    return _phaseLabel(view);
  }

  Widget _previewBody(
    BuildContext context,
    LiminalTokens lim,
    ThemeData theme,
    FileEditViewState view,
  ) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final contentWidth = constraints.maxWidth;

        if (view.isEmail) {
          final html = view.bodyHtml?.trim() ?? '';
          if (html.isNotEmpty) {
            return ColoredBox(
              color: const Color(0xFFECECEC),
              child: EmailHtmlPreview(
                html: html,
                streaming: view.incomplete,
              ),
            );
          }
          final plain = view.bodyPlain?.trim() ?? _bodyText(view);
          return ColoredBox(
            color: Colors.white,
            child: Scrollbar(
              thumbVisibility: true,
              controller: _scroll,
              child: SingleChildScrollView(
                controller: _scroll,
                padding: const EdgeInsets.all(LiminalSpacing.md),
                child: ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: contentWidth),
                  child: SelectableText(
                    plain.isNotEmpty ? plain : 'Waiting for styled HTML…',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontSize: 14,
                      height: 1.5,
                      color: const Color(0xFF333333),
                    ),
                  ),
                ),
              ),
            ),
          );
        }

        final body = _bodyText(view);
        return ColoredBox(
          color: lim.codeBackground.withValues(alpha: 0.85),
          child: Scrollbar(
            thumbVisibility: true,
            controller: _scroll,
            child: SingleChildScrollView(
              controller: _scroll,
              padding: const EdgeInsets.all(LiminalSpacing.sm),
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: contentWidth),
                child: SelectableText(
                  body,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontFamily: 'Consolas, Courier New, monospace',
                    fontSize: 12.5,
                    height: 1.45,
                    color: lim.text,
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _PhaseChip extends StatelessWidget {
  const _PhaseChip({required this.label, required this.lim});

  final String label;
  final LiminalTokens lim;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: lim.accent.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: lim.accent.withValues(alpha: 0.35)),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: lim.accent,
          fontSize: 10,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.3,
        ),
      ),
    );
  }
}
