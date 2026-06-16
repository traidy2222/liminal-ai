import 'dart:async';

import 'package:flutter/material.dart';

import '../../models/harness_settings.dart';
import '../../models/inbox_snapshot.dart';
import '../../models/integrations_snapshot.dart';
import '../../state/app_controller.dart';
import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';
import 'inbox_panel.dart';

/// Integration-scoped automations (inbox watcher, etc.) — lives on Integrations, not Settings.
class IntegrationsAutomationSection extends StatefulWidget {
  const IntegrationsAutomationSection({
    super.key,
    required this.host,
    required this.integrations,
    required this.inbox,
    required this.harness,
    required this.busy,
    required this.onOpenInbox,
  });

  final AppController host;
  final IntegrationsSnapshot integrations;
  final InboxSnapshot inbox;
  final HarnessSettingsSnapshot? harness;
  final bool busy;
  final Future<void> Function() onOpenInbox;

  @override
  State<IntegrationsAutomationSection> createState() => _IntegrationsAutomationSectionState();
}

class _IntegrationsAutomationSectionState extends State<IntegrationsAutomationSection> {
  bool _showActivityLog = false;

  bool get _mailConnected =>
      widget.integrations.googleConnected || widget.integrations.microsoftConnected;

  bool _boolField(String key, {bool fallback = false}) {
    final snap = widget.harness;
    if (snap == null) return fallback;
    for (final f in snap.fields) {
      if (f.key == key) {
        final v = f.value.trim().toLowerCase();
        return v == '1' || v == 'true';
      }
    }
    return fallback;
  }

  bool _locked(String key) {
    final snap = widget.harness;
    if (snap == null) return false;
    for (final f in snap.fields) {
      if (f.key == key) return f.lockedByEnv;
    }
    return false;
  }

  int _intervalMs() {
    final snap = widget.harness;
    if (snap == null) return 300000;
    for (final f in snap.fields) {
      if (f.key == 'AGENT_INBOX_WATCH_INTERVAL_MS') {
        return int.tryParse(f.value.trim()) ?? 300000;
      }
    }
    return 300000;
  }

  Future<void> _patchBool(String key, bool value) async {
    await widget.host.patchHarnessSettings({key: value ? '1' : '0'});
    if (key == 'AGENT_INBOX_WATCH') {
      final msg = await widget.host.triggerInboxWatch();
      if (mounted && msg != null) _toast(msg);
    }
  }

  Future<void> _patchInterval(int ms) async {
    await widget.host.patchHarnessSettings({'AGENT_INBOX_WATCH_INTERVAL_MS': '$ms'});
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _scanNow() async {
    final msg = await widget.host.triggerInboxWatch();
    if (!mounted || msg == null) return;
    _toast(msg);
  }

  String _statusLine() {
    if (widget.host.inboxScanBusy) return 'Scanning…';
    if (widget.host.inboxLastScanMessage != null && widget.host.inboxLastScanMessage!.isNotEmpty) {
      return 'Last result: ${widget.host.inboxLastScanMessage}';
    }
    if (!_mailConnected) {
      return 'Connect Gmail or Microsoft below to enable inbox automation.';
    }
    if (!_boolField('AGENT_INBOX_WATCH')) {
      return 'Inbox watcher is off — enable to poll for new mail while Liminal runs.';
    }
    final parts = <String>[];
    if (widget.inbox.pendingCount > 0) {
      parts.add('${widget.inbox.pendingCount} pending');
    }
    if (widget.inbox.needsActionCount > 0) {
      parts.add('${widget.inbox.needsActionCount} need you');
    }
    final scan = _formatLastScan(widget.inbox.lastScanAt);
    if (scan != null) parts.add('last scan $scan');
    return parts.isEmpty ? 'Watching — no pending items' : parts.join(' · ');
  }

  String? _formatLastScan(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    final dt = DateTime.tryParse(iso);
    if (dt == null) return null;
    final diff = DateTime.now().difference(dt.toLocal());
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }

  String _formatRunTime(String iso) {
    final dt = DateTime.tryParse(iso);
    if (dt == null) return iso;
    final local = dt.toLocal();
    final h = local.hour.toString().padLeft(2, '0');
    final m = local.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final watchOn = _boolField('AGENT_INBOX_WATCH');
    final watchLocked = _locked('AGENT_INBOX_WATCH');
    final interval = _intervalMs();
    final scanning = widget.host.inboxScanBusy;
    final runs = widget.inbox.recentRuns;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Automations',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 4),
        Text(
          'Background tasks for connected integrations. Configure here — not in Settings.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: lim.textMuted, height: 1.4),
        ),
        const SizedBox(height: 12),
        Material(
          color: lim.surface.withValues(alpha: 0.55),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
            side: BorderSide(color: lim.accent.withValues(alpha: 0.18)),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Icon(Icons.inbox_outlined, size: 20, color: lim.accent),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Inbox watcher',
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                      ),
                    ),
                    if (watchLocked)
                      Tooltip(
                        message: 'Locked by .env',
                        child: Icon(Icons.lock_outline, size: 16, color: lim.textDim),
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  'Fully automated: polls mail, triages, creates Liminal labels/categories in Gmail or Outlook, and handles urgent items in chat. No manual sorting. Reconnect Google once for label permissions.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: lim.textMuted, height: 1.4),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    _ConnectorChip(
                      label: 'Gmail',
                      connected: widget.integrations.googleConnected,
                      lim: lim,
                    ),
                    _ConnectorChip(
                      label: 'Outlook',
                      connected: widget.integrations.microsoftConnected,
                      lim: lim,
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  _statusLine(),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: watchOn && _mailConnected ? lim.text : lim.textMuted,
                      ),
                ),
                const SizedBox(height: 10),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: const Text('Enable inbox watcher'),
                  subtitle: watchLocked ? const Text('Set AGENT_INBOX_WATCH in .env') : null,
                  value: watchOn,
                  onChanged: widget.busy || watchLocked || !_mailConnected
                      ? null
                      : (v) => unawaited(_patchBool('AGENT_INBOX_WATCH', v)),
                ),
                if (watchOn && _mailConnected) ...[
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: const Text('Sort mail into Liminal labels'),
                    subtitle: const Text('Creates Liminal/Urgent, Action, FYI, etc. in your mailbox'),
                    value: _boolField('AGENT_INBOX_AUTO_LABEL', fallback: true),
                    onChanged: widget.busy || _locked('AGENT_INBOX_AUTO_LABEL')
                        ? null
                        : (v) => unawaited(_patchBool('AGENT_INBOX_AUTO_LABEL', v)),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: const Text('Auto-handle urgent mail in chat'),
                    subtitle: const Text('Agent drafts replies — never sends without approval'),
                    value: _boolField('AGENT_INBOX_AUTO_PROCESS', fallback: true),
                    onChanged: widget.busy || _locked('AGENT_INBOX_AUTO_PROCESS')
                        ? null
                        : (v) => unawaited(_patchBool('AGENT_INBOX_AUTO_PROCESS', v)),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: const Text('Desktop notification on urgent mail'),
                    value: _boolField('AGENT_INBOX_NOTIFY_URGENT', fallback: true),
                    onChanged: widget.busy || _locked('AGENT_INBOX_NOTIFY_URGENT')
                        ? null
                        : (v) => unawaited(_patchBool('AGENT_INBOX_NOTIFY_URGENT', v)),
                  ),
                  Row(
                    children: [
                      Text('Poll every', style: Theme.of(context).textTheme.bodySmall),
                      const SizedBox(width: 12),
                      DropdownButton<int>(
                        value: switch (interval) {
                          >= 1800000 => 1800000,
                          >= 900000 => 900000,
                          _ => 300000,
                        },
                        items: const [
                          DropdownMenuItem(value: 300000, child: Text('5 minutes')),
                          DropdownMenuItem(value: 900000, child: Text('15 minutes')),
                          DropdownMenuItem(value: 1800000, child: Text('30 minutes')),
                        ],
                        onChanged: widget.busy || _locked('AGENT_INBOX_WATCH_INTERVAL_MS')
                            ? null
                            : (v) {
                                if (v != null) unawaited(_patchInterval(v));
                              },
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 4),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: widget.busy || scanning || !watchOn || !_mailConnected
                          ? null
                          : () => unawaited(_scanNow()),
                      icon: scanning
                          ? SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2, color: lim.accent),
                            )
                          : const Icon(Icons.radar, size: 18),
                      label: Text(scanning ? 'Scanning…' : 'Scan now'),
                    ),
                    OutlinedButton.icon(
                      onPressed: widget.busy ? null : widget.onOpenInbox,
                      icon: const Icon(Icons.list_alt, size: 18),
                      label: const Text('Review queue'),
                    ),
                  ],
                ),
                if (runs.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  InkWell(
                    onTap: () => setState(() => _showActivityLog = !_showActivityLog),
                    child: Row(
                      children: [
                        Icon(
                          _showActivityLog ? Icons.expand_less : Icons.expand_more,
                          size: 18,
                          color: lim.textDim,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          'Activity log (${runs.length})',
                          style: Theme.of(context).textTheme.labelLarge?.copyWith(color: lim.textDim),
                        ),
                        const Spacer(),
                        Text(
                          'saved locally',
                          style: Theme.of(context).textTheme.labelSmall?.copyWith(color: lim.textDim),
                        ),
                      ],
                    ),
                  ),
                  if (_showActivityLog)
                    Container(
                      margin: const EdgeInsets.only(top: 8),
                      constraints: const BoxConstraints(maxHeight: 220),
                      decoration: BoxDecoration(
                        border: Border.all(color: lim.border.withValues(alpha: 0.35)),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: ListView.separated(
                        shrinkWrap: true,
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        itemCount: runs.length.clamp(0, 20),
                        separatorBuilder: (_, __) => Divider(height: 1, color: lim.border.withValues(alpha: 0.25)),
                        itemBuilder: (context, i) {
                          final run = runs[i];
                          final color = run.isSkipped ? lim.textDim : lim.success;
                          return ListTile(
                            dense: true,
                            visualDensity: VisualDensity.compact,
                            leading: Icon(
                              run.isSkipped ? Icons.remove_circle_outline : Icons.check_circle_outline,
                              size: 18,
                              color: color,
                            ),
                            title: Text(
                              run.summary,
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                            subtitle: Text(
                              '${run.triggerLabel} · ${_formatRunTime(run.finishedAt)} · ${run.durationMs}ms',
                              style: Theme.of(context).textTheme.labelSmall?.copyWith(color: lim.textDim),
                            ),
                          );
                        },
                      ),
                    ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 20),
      ],
    );
  }
}

class _ConnectorChip extends StatelessWidget {
  const _ConnectorChip({
    required this.label,
    required this.connected,
    required this.lim,
  });

  final String label;
  final bool connected;
  final LiminalTokens lim;

  @override
  Widget build(BuildContext context) {
    final color = connected ? lim.success : lim.textDim;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        border: Border.all(color: color.withValues(alpha: 0.45)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        connected ? '$label · connected' : '$label · not connected',
        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color),
      ),
    );
  }
}

Future<void> showInboxPanelSheet(BuildContext context, AppController host) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => InboxPanel(
      snapshot: host.inbox,
      busy: host.inboxBusy,
      onRefresh: host.loadInboxStatus,
      onDismiss: host.dismissInboxItems,
      onProcess: host.processInboxItems,
    ),
  );
}
