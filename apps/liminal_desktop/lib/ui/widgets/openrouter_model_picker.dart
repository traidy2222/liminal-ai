import 'package:flutter/material.dart';
import '../../models/openrouter_catalog.dart';
import '../theme/liminal_theme_extension.dart';

class OpenRouterModelPicker extends StatefulWidget {
  const OpenRouterModelPicker(
      {super.key,
      required this.value,
      required this.onChanged,
      required this.load,
      this.enabled = true,
      this.singleModel = false});
  final String value;
  final ValueChanged<String> onChanged;
  final Future<List<OpenRouterCatalogModel>> Function(bool refresh) load;
  final bool enabled, singleModel;
  @override
  State<OpenRouterModelPicker> createState() => _OpenRouterModelPickerState();
}

class _OpenRouterModelPickerState extends State<OpenRouterModelPicker> {
  List<OpenRouterCatalogModel> _models = [];
  String _query = '';
  String? _error;
  bool _loading = true;
  @override
  void initState() {
    super.initState();
    _load(false);
  }

  Future<void> _load(bool refresh) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await widget.load(refresh);
      if (mounted) setState(() => _models = rows);
    } catch (e) {
      if (mounted)
        setState(() => _error =
            'Models could not be loaded. Your selection has not changed. Try Refresh.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final rows = _models
        .where((m) => '${m.name} ${m.id}'
            .toLowerCase()
            .contains(_query.toLowerCase().trim()))
        .toList();
    final selected = _models.where((m) => m.id == widget.value).firstOrNull;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Expanded(
            child: Text('OpenRouter model',
                style: Theme.of(context).textTheme.titleMedium)),
        TextButton(
            onPressed: _loading || !widget.enabled ? null : () => _load(true),
            child: const Text('Refresh'))
      ]),
      Text(
          _loading
              ? 'Loading catalog…'
              : '${_models.length} models · individual models, no bundles',
          style: TextStyle(color: lim.textMuted, fontSize: 12)),
      Container(
          margin: const EdgeInsets.symmetric(vertical: 12),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
              color: lim.accent.withValues(alpha: .07),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: lim.border)),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Selected model',
                style: TextStyle(color: lim.textMuted, fontSize: 12)),
            const SizedBox(height: 5),
            Text(selected?.name ??
                (widget.value.isEmpty ? 'Choose a model' : widget.value)),
            Text(widget.value,
                style: TextStyle(color: lim.textMuted, fontSize: 11)),
          ])),
      TextField(
          decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search),
              hintText: 'Search OpenRouter models…'),
          onChanged: (v) => setState(() => _query = v)),
      const SizedBox(height: 10),
      if (_loading) const LinearProgressIndicator(),
      if (_error != null)
        Padding(
            padding: const EdgeInsets.all(10),
            child: Text(_error!, style: TextStyle(color: lim.warn))),
      if (!_loading && _error == null && rows.isEmpty)
        const Padding(
            padding: EdgeInsets.all(18),
            child: Text('No models match your search.')),
      if (rows.isNotEmpty)
        SizedBox(
            height: 280,
            child: Material(
                color: Colors.transparent,
                child: ListView.builder(
                  key: ValueKey(_query),
                  itemCount: rows.length,
                  itemBuilder: (context, i) {
                    final m = rows[i];
                    return ListTile(
                        enabled: widget.enabled &&
                            !(widget.singleModel && m.isRouter),
                        selected: widget.value == m.id,
                        selectedTileColor: lim.accent.withValues(alpha: .08),
                        selectedColor: lim.accent,
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 4),
                        title:
                            Text(m.name, style: const TextStyle(fontSize: 14)),
                        subtitle: Text(
                            '${m.id}\n${m.contextLength ~/ 1000}k context · ${m.supportsTools ? 'Tools' : 'No tool support'}${m.vision ? ' · Vision' : ''}${m.isRouter ? ' · Routes across models' : ''}',
                            style:
                                TextStyle(color: lim.textMuted, fontSize: 11)),
                        trailing: widget.value == m.id
                            ? const Icon(Icons.check, size: 18)
                            : null,
                        onTap: () => widget.onChanged(m.id));
                  },
                ))),
      if (selected != null && !selected.supportsTools)
        const Text(
            'This model does not advertise tool calling. Agent actions may be unavailable.'),
      if (widget.singleModel && selected != null && !selected.vision)
        const Text(
            'This model is text-only. Vision requests will not switch to another model.'),
      const SizedBox(height: 12),
    ]);
  }
}
