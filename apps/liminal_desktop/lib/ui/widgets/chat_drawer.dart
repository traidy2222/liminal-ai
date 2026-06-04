import 'package:flutter/material.dart';

import '../../protocol/chat_summary.dart';
import '../theme/liminal_theme_extension.dart';
import 'liminal_brand.dart';

class ChatDrawer extends StatelessWidget {
  const ChatDrawer({
    super.key,
    required this.chats,
    required this.activeChatId,
    required this.onSelect,
    required this.onNewChat,
    required this.onDelete,
  });

  final List<ChatSummary> chats;
  final String? activeChatId;
  final ValueChanged<String> onSelect;
  final VoidCallback onNewChat;
  final ValueChanged<String> onDelete;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Drawer(
      child: Column(
        children: [
          DrawerHeader(
            margin: EdgeInsets.zero,
            padding: const EdgeInsets.fromLTRB(16, 24, 16, 16),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: lim.border)),
            ),
            child: const Align(
              alignment: Alignment.bottomLeft,
              child: LiminalBrandMark(compact: true),
            ),
          ),
          ListTile(
            leading: Icon(Icons.add_circle_outline, color: lim.accent),
            title: const Text('New chat'),
            onTap: () {
              Navigator.pop(context);
              onNewChat();
            },
          ),
          const Divider(height: 1),
          Expanded(
            child: ListView.builder(
              itemCount: chats.length,
              itemBuilder: (context, i) {
                final chat = chats[i];
                final selected = chat.chatId == activeChatId;
                return ListTile(
                  selected: selected,
                  selectedTileColor: lim.accent.withValues(alpha: 0.1),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  title: Text(
                    chat.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: selected ? lim.accent : lim.text,
                      fontWeight: selected ? FontWeight.w600 : null,
                    ),
                  ),
                  subtitle: Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      chat.busy ? 'Running…' : chat.workspaceRoot,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: LiminalTheme.mono(
                        context,
                        fontSize: 11,
                        color: lim.textDim,
                      ).copyWith(height: 1.25),
                    ),
                  ),
                  onTap: () {
                    Navigator.pop(context);
                    onSelect(chat.chatId);
                  },
                  trailing: IconButton(
                    icon: Icon(Icons.delete_outline, size: 20, color: lim.textMuted),
                    onPressed: () => onDelete(chat.chatId),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
