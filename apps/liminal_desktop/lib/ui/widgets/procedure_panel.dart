import 'dart:convert';
import 'package:flutter/material.dart';

typedef ProcedureCommand = Future<Map<String, dynamic>> Function(
  String action,
  Map<String, dynamic> payload,
);

/// Real runtime data through procedure_manage, including immutable evidence and
/// lifecycle history. No local synthetic learning score or dashboard fixtures.
class ProcedurePanel extends StatefulWidget {
  const ProcedurePanel({super.key, required this.command});
  final ProcedureCommand command;
  @override
  State<ProcedurePanel> createState() => _ProcedurePanelState();
}

class _ProcedurePanelState extends State<ProcedurePanel> {
  Map<String, dynamic>? _snapshot;
  Map<String, dynamic>? _detail;
  Map<String, dynamic>? _contractPreview;
  String? _selected;
  String? _contract;
  String? _episode;
  String? _error;
  bool _loading = false;
  final _path = TextEditingController();
  final _correction = TextEditingController();
  final Map<String, TextEditingController> _inputs = {};
  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    _path.dispose();
    _correction.dispose();
    for (final c in _inputs.values) {
      c.dispose();
    }
    super.dispose();
  }

  List<Map<String, dynamic>> _rows(String key) =>
      (_snapshot?[key] as List? ?? const [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
  Future<void> _refresh() async {
    setState(() => _loading = true);
    try {
      final result = await widget.command('list', {});
      if (!mounted) return;
      setState(() {
        _snapshot = result;
        _error = null;
      });
      final contracts = _rows('contracts');
      if (!contracts.any((c) => c['id'] == _contract)) {
        _contract = contracts.isEmpty ? null : contracts.first['id'] as String?;
      }
      if (!_rows('episodes').any((e) => e['runId'] == _episode)) {
        _episode = null;
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _act(String action, Map<String, dynamic> data) async {
    setState(() => _loading = true);
    try {
      final result = await widget.command(action, data);
      if (action == 'adopt_contract') {
        _contract = result['id'] as String?;
        _contractPreview = null;
      }
      if (action == 'learn') {
        _selected = (result['body'] as Map?)?['versionId'] as String?;
      }
      if (!mounted) return;
      await _refresh();
      if (_selected != null) await _inspect(_selected!);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _inspect(String id) async {
    try {
      final detail = await widget.command('inspect', {'versionId': id});
      if (mounted) {
        setState(() {
          _selected = id;
          _detail = detail;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Map<String, String> _values() =>
      {for (final key in _parameters()) key: _inputs[key]!.text.trim()};
  List<String> _parameters() {
    final contracts = _rows('contracts').where((e) => e['id'] == _contract);
    if (contracts.isEmpty) return const [];
    final body = Map<String, dynamic>.from(contracts.first['body'] as Map);
    final names = <String>{body['filenameParameter'] as String};
    for (final field in (body['fields'] as Map).values) {
      if (field is Map && field['parameter'] is String) {
        names.add(field['parameter'] as String);
      }
    }
    for (final name in names) {
      _inputs.putIfAbsent(name, () => TextEditingController());
    }
    return names.toList();
  }

  String _stateLabel(String state) => switch (state) {
        'candidate' => 'Candidate · not yet validated',
        'validating' => 'Checking outcome',
        'active' => 'Verified for recorded conditions',
        'needs_revalidation' => 'Needs revalidation',
        'retired' => 'Retired',
        'rejected' => 'Rejected',
        _ => state,
      };
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final procedures = _rows('procedures');
    final parameters = _parameters();
    return Material(
      color: theme.colorScheme.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 20, 16, 12),
            child: Row(
              children: [
                Icon(
                  Icons.psychology_outlined,
                  color: theme.colorScheme.primary,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Procedures', style: theme.textTheme.headlineSmall),
                      const Text(
                        'Useful experience, checked against this workspace.',
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Refresh procedures',
                  onPressed: _loading ? null : _refresh,
                  icon: const Icon(Icons.refresh),
                ),
              ],
            ),
          ),
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                _error!,
                style: TextStyle(color: theme.colorScheme.error),
              ),
            ),
          Expanded(
            child: LayoutBuilder(
              builder: (context, size) {
                final list = _procedureList(procedures, theme);
                final details = _details(theme, parameters);
                if (size.maxWidth < 760) {
                  return ListView(
                    children: [SizedBox(height: 240, child: list), details],
                  );
                }
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SizedBox(width: 320, child: list),
                    const VerticalDivider(width: 1),
                    Expanded(child: SingleChildScrollView(child: details)),
                  ],
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              'Retrievals are not successes. Verification covers the recorded conditions; general benefit is unproven. Notes and recipes remain legacy hints.',
              style: theme.textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }

  Widget _procedureList(List<Map<String, dynamic>> rows, ThemeData theme) =>
      rows.isEmpty
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'No procedures yet. Adopt a verifier, complete a task with objective checks, then learn from its episode.',
                ),
              ),
            )
          : ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: rows.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final row = rows[index],
                    body = Map<String, dynamic>.from(row['body'] as Map),
                    id = body['versionId'] as String;
                return Card(
                  child: ListTile(
                    selected: _selected == id,
                    onTap: () => _inspect(id),
                    title: Text(body['name'] as String? ?? 'Procedure'),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _stateLabel(
                            row['state'] as String? ?? 'candidate',
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          row['reason'] as String? ?? '',
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                        Text(
                          'Version ${body['version']} · ${row['successes'] ?? 0} verified uses · ${row['failures'] ?? 0} incorrect outcomes',
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                );
              },
            );
  Widget _details(ThemeData theme, List<String> parameters) {
    final procedure = _detail?['procedure'] as Map?;
    final body = procedure?['body'] as Map?;
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Workspace checks', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          const Text(
            'Choose a JSON-record convention file you trust. The learner can propose steps, but cannot change these checks.',
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _path,
            onChanged: (_) => setState(() => _contractPreview = null),
            decoration: const InputDecoration(
              labelText: 'Convention file inside this workspace',
              hintText: 'dev/record-convention.json',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _loading
                ? null
                : () async {
                    try {
                      final requested = _path.text.trim();
                      final preview = await widget.command(
                        'preview_contract',
                        {'contractPath': requested},
                      );
                      if (mounted && requested == _path.text.trim()) {
                        setState(() => _contractPreview = preview);
                      }
                    } catch (e) {
                      if (mounted) setState(() => _error = e.toString());
                    }
                  },
            icon: const Icon(Icons.fact_check_outlined),
            label: const Text('Inspect checks'),
          ),
          if (_contractPreview != null) ...[
            _section('Checks to adopt', _contractPreview!['body']),
            FilledButton.tonal(
              onPressed: _loading
                  ? null
                  : () => _act('adopt_contract', {
                        'contractPath': _contractPreview!['sourcePath'],
                        'expectedSourceHash': _contractPreview!['sourceHash'],
                      }),
              child: const Text('Use these inspected checks'),
            ),
          ],
          if (_rows('contracts').isNotEmpty) ...[
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              key: ValueKey('contract-$_contract'),
              initialValue: _contract,
              decoration:
                  const InputDecoration(labelText: 'Verification convention'),
              items: _rows('contracts')
                  .map(
                    (c) => DropdownMenuItem(
                      value: c['id'] as String,
                      child: Text((c['body'] as Map)['name'] as String),
                    ),
                  )
                  .toList(),
              onChanged: (v) => setState(() => _contract = v),
            ),
            for (final name in parameters)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: TextField(
                  controller: _inputs[name],
                  decoration: InputDecoration(
                    labelText: 'Example $name',
                    border: const OutlineInputBorder(),
                  ),
                ),
              ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: ValueKey('episode-$_episode'),
              initialValue: _episode,
              decoration: const InputDecoration(
                labelText: 'Completed source episode',
              ),
              isExpanded: true,
              items: _rows('episodes')
                  .where(
                    (e) =>
                        e['finished'] != null &&
                        e['finished'] != 'user_management',
                  )
                  .map(
                    (e) => DropdownMenuItem(
                      value: e['runId'] as String,
                      child: Text(
                        e['goal'] as String? ?? 'Development task',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: (v) => setState(() => _episode = v),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _loading || _episode == null
                  ? null
                  : () => _act('learn', {
                        'contractId': _contract,
                        'runId': _episode,
                        'inputs': _values(),
                        if (procedure?['state'] == 'needs_revalidation')
                          'versionId': _selected,
                      }),
              icon: const Icon(Icons.auto_awesome_outlined),
              label: Text(
                procedure?['state'] == 'needs_revalidation'
                    ? 'Propose a repaired version'
                    : 'Propose from verified episode',
              ),
            ),
          ],
          if (body != null) ...[
            const Divider(height: 36),
            Text(
              body['name'] as String? ?? 'Procedure',
              style: theme.textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            Text(body['purpose'] as String? ?? ''),
            const SizedBox(height: 8),
            Text(_stateLabel(procedure!['state'] as String)),
            const SizedBox(height: 8),
            Text(procedure['reason'] as String? ?? ''),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (procedure['state'] == 'validating')
                  OutlinedButton(
                    onPressed: _loading
                        ? null
                        : () => _act('recover', {'versionId': _selected}),
                    child: const Text('Recover interrupted check'),
                  ),
                if (['candidate', 'needs_revalidation']
                    .contains(procedure['state']))
                  FilledButton.tonal(
                    onPressed: _loading
                        ? null
                        : () => _act(
                              'validate',
                              {'versionId': _selected, 'inputs': _values()},
                            ),
                    child: const Text('Verify observed outcome'),
                  ),
                OutlinedButton(
                  onPressed: _loading
                      ? null
                      : () => _act('disable', {
                            'versionId': _selected,
                            'disabled': procedure['disabled'] != true,
                          }),
                  child: Text(
                    procedure['disabled'] == true
                        ? 'Enable retrieval'
                        : 'Disable retrieval',
                  ),
                ),
                OutlinedButton(
                  onPressed: _loading || procedure['state'] == 'retired'
                      ? null
                      : () => _act('retire', {
                            'versionId': _selected,
                            'correction': 'Retired by user from Procedures',
                          }),
                  child: const Text('Retire'),
                ),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _correction,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Correct an assumption',
                hintText: 'What changed or proved this advice wrong?',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: _loading
                  ? null
                  : () => _act('correct', {
                        'versionId': _selected,
                        'correction': _correction.text,
                      }),
              child: const Text('Submit correction and suspend'),
            ),
            _section('When it applies', {
              'applicability': body['applicability'],
              'preconditions': body['preconditions'],
              'limitations': body['negativeExamples'],
            }),
            for (final event
                in (_detail?['events'] as List? ?? const []).whereType<Map>())
              TextButton(
                onPressed: () => _evidence(event['eventId'] as String),
                child: Text(
                  'Inspect ${event['kind']} · ${event['ok'] == false ? 'failed' : 'recorded'} attempt',
                ),
              ),
            _section('Observed attempts and checks', {
              'orderedEvents': _detail?['events'],
              'objectiveChecks': _detail?['validations'],
            }),
            _section('Changed assumptions and history', {
              'dependencies': body['dependencies'],
              'transitions': _detail?['history'],
              'unproven': body['missingEvidence'],
              'explanation': body['explanation'],
            }),
          ],
        ],
      ),
    );
  }

  Future<void> _evidence(String id) async {
    try {
      final page =
          await widget.command('evidence', {'eventId': id, 'offset': 0});
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => _EvidenceDialog(
          command: widget.command,
          eventId: id,
          initialPage: page,
        ),
      );
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Widget _section(String title, Object? value) => ExpansionTile(
        tilePadding: EdgeInsets.zero,
        title: Text(title),
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: SelectableText(
              const JsonEncoder.withIndent('  ').convert(value),
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
            ),
          ),
        ],
      );
}

class _EvidenceDialog extends StatefulWidget {
  const _EvidenceDialog({
    required this.command,
    required this.eventId,
    required this.initialPage,
  });
  final ProcedureCommand command;
  final String eventId;
  final Map<String, dynamic> initialPage;
  @override
  State<_EvidenceDialog> createState() => _EvidenceDialogState();
}

class _EvidenceDialogState extends State<_EvidenceDialog> {
  late Map<String, dynamic> page = widget.initialPage;
  String? error;
  bool loading = false;
  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Recorded evidence · redacted'),
        content: SizedBox(
          width: 720,
          height: 480,
          child: SingleChildScrollView(
            child: SelectableText(
              error ?? page['content'] as String? ?? '',
            ),
          ),
        ),
        actions: [
          Text(
            'Characters ${page['offset']}–${(page['offset'] as int) + (page['content'] as String).length} of ${page['totalCharacters']}',
          ),
          TextButton(
            onPressed: loading || page['nextOffset'] == null
                ? null
                : () async {
                    setState(() => loading = true);
                    try {
                      final result = await widget.command('evidence', {
                        'eventId': widget.eventId,
                        'offset': page['nextOffset'],
                      });
                      if (mounted) setState(() => page = result);
                    } catch (e) {
                      if (mounted) setState(() => error = e.toString());
                    } finally {
                      if (mounted) setState(() => loading = false);
                    }
                  },
            child: const Text('Next page'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
      );
}
