import 'package:flutter/material.dart';
import '../theme/liminal_theme_extension.dart';

const settingsDestinations = [
  (id: 'models_api', title: 'Model & provider', icon: Icons.tune),
  (
    id: 'session_ui',
    title: 'Preferences',
    icon: Icons.desktop_windows_outlined
  ),
  (id: 'memory_vault', title: 'Memory', icon: Icons.auto_stories_outlined),
  (id: 'safety', title: 'Permissions', icon: Icons.verified_user_outlined),
  (id: 'advanced', title: 'Advanced', icon: Icons.code),
  (id: 'account', title: 'Account', icon: Icons.person_outline),
  (id: 'about', title: 'About & updates', icon: Icons.info_outline),
];

/// Stable navigation, one scroll surface, and a search that includes advanced options.
class SettingsWorkspace extends StatelessWidget {
  const SettingsWorkspace(
      {super.key,
      required this.selected,
      required this.onSelect,
      required this.search,
      required this.onSearch,
      required this.child,});
  final String selected;
  final ValueChanged<String> onSelect;
  final TextEditingController search;
  final ValueChanged<String> onSearch;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return LayoutBuilder(builder: (context, bounds) {
      final wide = bounds.maxWidth >= 800;
      final navigation = [
        for (final item in settingsDestinations)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: TextButton.icon(
              onPressed: () => onSelect(item.id),
              icon: Icon(item.icon, size: 18),
              label: Text(item.title),
              style: TextButton.styleFrom(
                alignment: Alignment.centerLeft,
                minimumSize: Size(wide ? 208 : 0, 46),
                padding: const EdgeInsets.symmetric(horizontal: 14),
                foregroundColor:
                    selected == item.id ? lim.accent : lim.textMuted,
                backgroundColor: selected == item.id
                    ? lim.accent.withValues(alpha: .09)
                    : Colors.transparent,
                textStyle: const TextStyle(fontFamily: 'Inter', fontSize: 13),
              ),
            ),
          ),
      ];
      final content =
          Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
            padding:
                EdgeInsets.fromLTRB(wide ? 32 : 20, 24, wide ? 32 : 20, 16),
            child: TextField(
              controller: search,
              onChanged: onSearch,
              decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search, size: 20),
                  hintText: 'Search all settings, including advanced…',
                  suffixIcon: search.text.isEmpty
                      ? null
                      : IconButton(
                          tooltip: 'Clear search',
                          onPressed: () {
                            search.clear();
                            onSearch('');
                          },
                          icon: const Icon(Icons.close, size: 18),),),
            ),),
        Expanded(
            child: SingleChildScrollView(
          key: PageStorageKey('settings-$selected-${search.text.isNotEmpty}'),
          padding: EdgeInsets.fromLTRB(wide ? 32 : 20, 8, wide ? 32 : 20, 36),
          child: Align(
              alignment: Alignment.topLeft,
              child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 920),
                  child: child,),),
        ),),
      ],);
      if (!wide) {
        return Column(children: [
          SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Row(children: navigation),),
          Expanded(child: content),
        ],);
      }
      return Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Container(
            width: 240,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
                color: lim.surface,
                border: Border(right: BorderSide(color: lim.border)),),
            child: SingleChildScrollView(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: navigation,),),),
        Expanded(child: content),
      ],);
    },);
  }
}
