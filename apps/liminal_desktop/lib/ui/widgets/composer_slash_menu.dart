import 'package:flutter/material.dart';

import '../theme/liminal_theme_extension.dart';
import 'composer_slash.dart';

class ComposerSlashMenu extends StatelessWidget {
  const ComposerSlashMenu({
    super.key,
    required this.items,
    required this.selectedIndex,
    required this.onPick,
  });

  final List<SlashCompletionItem> items;
  final int selectedIndex;
  final ValueChanged<SlashCompletionItem> onPick;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    final lim = LiminalTheme.of(context);

    return Material(
      elevation: 8,
      color: lim.panel.withValues(alpha: 0.98),
      borderRadius: BorderRadius.circular(8),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 220),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: ListView.builder(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                itemCount: items.length,
                itemBuilder: (context, index) {
                  final item = items[index];
                  final active = index == selectedIndex;
                  return InkWell(
                    onTap: () => onPick(item),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      color: active ? lim.accent.withValues(alpha: 0.12) : null,
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(
                            width: 110,
                            child: Text(
                              item.label,
                              style: TextStyle(
                                fontFamily: 'Consolas',
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: active ? lim.accent : lim.text,
                              ),
                            ),
                          ),
                          if (item.detail != null)
                            Expanded(
                              child: Text(
                                item.detail!,
                                style: TextStyle(
                                  fontFamily: 'Consolas',
                                  fontSize: 10,
                                  color: lim.textMuted,
                                  height: 1.35,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 4, 10, 6),
              child: Text(
                'Tab complete · ↑↓ navigate · Esc dismiss',
                style: TextStyle(fontSize: 9, color: lim.textMuted.withValues(alpha: 0.8)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
