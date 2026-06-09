import 'package:flutter/material.dart';

import '../../protocol/chat_summary.dart';
import '../../state/app_controller.dart';
import '../design_system/liminal_design_system.dart';
import '../layout/liminal_spacing.dart';
import '../screens/hub/hub_format.dart';
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
    final sorted = List<ChatSummary>.from(chats)
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

    return Drawer(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
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
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: LiminalSpacing.sm),
            child: Column(
              children: [
                LiminalListRow(
                  title: 'Home',
                  leading: Icon(Icons.home_outlined, size: 18, color: lim.textMuted),
                  onTap: () {
                    Navigator.pop(context);
                    onHome();
                  },
                ),
                LiminalListRow(
                  title: 'New chat',
                  leading: Icon(Icons.add_circle_outline, size: 18, color: lim.accent),
                  onTap: () {
                    Navigator.pop(context);
                    onNewChat();
                  },
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
            child: Text(
              'CHATS',
              style: LiminalTheme.mono(
                context,
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: lim.textDim,
              ).copyWith(letterSpacing: 0.1),
            ),
          ),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: LiminalSpacing.xs),
              itemCount: sorted.length,
              itemBuilder: (context, i) {
                final chat = sorted[i];
                final focused = chat.chatId == activeChatId;
                final inPane = visibleChatIds.contains(chat.chatId);
                final canSplit = !inPane ||
                    (inPane && visibleChatIds.length < AppController.maxVisibleChats);
                final time = hubRelativeTime(chat.updatedAt);

                return LiminalListRow(
                  title: chat.title,
                  subtitle: chat.busy ? 'Running…' : chat.workspaceRoot,
                  monoSubtitle: true,
                  enabled: true,
                  onTap: () {
                    Navigator.pop(context);
                    onSelect(chat.chatId);
                  },
                  leading: chat.isOrchestrator
                      ? Icon(Icons.hub_outlined, size: 18, color: lim.accent)
                      : inPane && splitActive
                          ? Icon(
                              focused ? Icons.radio_button_checked : Icons.circle_outlined,
                              size: 16,
                              color: focused ? lim.accent : lim.textDim,
                            )
                          : Icon(
                              chat.busy ? Icons.bolt : Icons.chat_bubble_outline,
                              size: 18,
                              color: focused ? lim.accent : lim.textDim,
                            ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (chat.busy)
                        const Padding(
                          padding: EdgeInsets.only(right: 4),
                          child: LiminalBadge(label: 'Busy', tone: LiminalBadgeTone.accent),
                        ),
                      if (time.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(right: 4),
                          child: Text(time, style: LiminalTypography.caption(context)),
                        ),
                      if (canSplit)
                        LiminalIconButton(
                          icon: Icons.vertical_split_outlined,
                          tooltip: inPane ? 'Focus in split view' : 'Open beside current chat',
                          size: 18,
                          onPressed: () {
                            Navigator.pop(context);
                            onOpenBeside(chat.chatId);
                          },
                        ),
                      LiminalIconButton(
                        icon: Icons.delete_outline,
                        tooltip: 'Delete chat',
                        size: 18,
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
