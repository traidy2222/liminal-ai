import 'package:flutter/material.dart';

import '../../protocol/chat_summary.dart';
import '../../state/app_controller.dart';
import '../theme/liminal_theme_extension.dart';
import 'liminal_brand.dart';

class ChatDrawer extends StatelessWidget {
  const ChatDrawer({
    super.key,
    required this.chats,
    required this.activeChatId,
    required this.visibleChatIds,
    required this.onHome,
    required this.onSelect,
    required this.onOpenBeside,
    required this.onNewChat,
    required this.onDelete,
  });

  final List<ChatSummary> chats;
  final String? activeChatId;
  final List<String> visibleChatIds;
  final VoidCallback onHome;
  final ValueChanged<String> onSelect;
  final ValueChanged<String> onOpenBeside;
  final VoidCallback onNewChat;
  final ValueChanged<String> onDelete;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final splitActive = visibleChatIds.length > 1;
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
            leading: Icon(Icons.home_outlined, color: lim.textMuted),
            title: const Text('Home'),
            onTap: () {
              Navigator.pop(context);
              onHome();
            },
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
                final focused = chat.chatId == activeChatId;
                final inPane = visibleChatIds.contains(chat.chatId);
                final canSplit = !inPane ||
                    (inPane && visibleChatIds.length < AppController.maxVisibleChats);
                return ListTile(
                  selected: focused,
                  selectedTileColor: lim.accent.withValues(alpha: 0.1),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  leading: chat.isOrchestrator
                      ? Icon(Icons.hub_outlined, size: 20, color: lim.accent)
                      : inPane && splitActive
                          ? Icon(
                              focused ? Icons.radio_button_checked : Icons.circle_outlined,
                              size: 18,
                              color: focused ? lim.accent : lim.textDim,
                            )
                          : null,
                  title: Text(
                    chat.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: focused ? lim.accent : lim.text,
                      fontWeight: focused ? FontWeight.w600 : null,
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
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (canSplit)
                        IconButton(
                          tooltip: inPane ? 'Focus in split view' : 'Open beside current chat',
                          visualDensity: VisualDensity.compact,
                          iconSize: 20,
                          icon: Icon(Icons.vertical_split_outlined, color: lim.textMuted),
                          onPressed: () {
                            Navigator.pop(context);
                            onOpenBeside(chat.chatId);
                          },
                        ),
                      IconButton(
                        tooltip: 'Delete chat',
                        visualDensity: VisualDensity.compact,
                        iconSize: 20,
                        icon: Icon(Icons.delete_outline, color: lim.textMuted),
                        onPressed: () => onDelete(chat.chatId),
                      ),
                    ],
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
