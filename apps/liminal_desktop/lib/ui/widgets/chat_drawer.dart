import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../protocol/chat_summary.dart';
import '../../routing/routes.dart';
import '../design_system/liminal_design_system.dart';
import '../theme/liminal_theme_extension.dart';
import 'liminal_brand.dart';

class ChatDrawer extends StatefulWidget {
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
    this.embedded = false,
  });
  final List<ChatSummary> chats;
  final String? activeChatId;
  final List<String> visibleChatIds;
  final VoidCallback onHome;
  final ValueChanged<String> onSelect;
  final ValueChanged<String> onOpenBeside;
  final VoidCallback onNewChat;
  final ValueChanged<String> onDelete;
  final bool embedded;
  @override
  State<ChatDrawer> createState() => _ChatDrawerState();
}

class _ChatDrawerState extends State<ChatDrawer> {
  String search = '';
  void select(VoidCallback action) {
    if (!widget.embedded) Navigator.pop(context);
    action();
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final sorted = widget.chats
        .where(
          (c) => '${c.title} ${c.workspaceRoot}'
              .toLowerCase()
              .contains(search.toLowerCase()),
        )
        .toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    final content = Material(
      color: lim.surface,
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(right: BorderSide(color: lim.border)),
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 28, 18, 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(7, 0, 7, 30),
                  child: LiminalBrandMark(
                    compact: true,
                    subtitle: 'Your working space',
                  ),
                ),
                LiminalButton.icon(
                  label: 'New chat',
                  icon: Icons.add,
                  onPressed: () => select(widget.onNewChat),
                ),
                const SizedBox(height: 14),
                TextField(
                  onChanged: (value) => setState(() => search = value),
                  style: TextStyle(fontSize: 12, color: lim.text),
                  decoration: InputDecoration(
                    hintText: 'Find a conversation',
                    hintStyle: TextStyle(
                      fontSize: 12,
                      color: lim.textMuted,
                    ),
                    prefixIcon: Icon(
                      Icons.search,
                      size: 18,
                      color: lim.textMuted,
                    ),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    constraints: const BoxConstraints(minHeight: 42),
                  ),
                ),
                const SizedBox(height: 20),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: Row(
                    children: [
                      Text(
                        'Conversations',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: lim.textMuted,
                        ),
                      ),
                      const Spacer(),
                      Text(
                        '${widget.chats.length}',
                        style: lim.monoStyle(fontSize: 10),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Expanded(
                  child: sorted.isEmpty
                      ? Padding(
                          padding: const EdgeInsets.all(8),
                          child: Text(
                            search.isEmpty
                                ? 'Start a chat to make room for your next idea.'
                                : 'No matching conversations.',
                            style: TextStyle(
                              fontSize: 12,
                              height: 1.7,
                              color: lim.textMuted,
                            ),
                          ),
                        )
                      : ListView.builder(
                          itemCount: sorted.length,
                          itemBuilder: (context, i) {
                            final chat = sorted[i];
                            final active = chat.chatId == widget.activeChatId;
                            final folder = chat.workspaceRoot
                                    .split(RegExp(r'[/\\]'))
                                    .where((s) => s.isNotEmpty)
                                    .lastOrNull ??
                                'Workspace';
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 6),
                              child: Material(
                                color: active
                                    ? lim.accent.withValues(alpha: 0.09)
                                    : Colors.transparent,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(10),
                                  side: BorderSide(
                                    color: active
                                        ? lim.accent.withValues(
                                            alpha: 0.16,
                                          )
                                        : Colors.transparent,
                                  ),
                                ),
                                clipBehavior: Clip.antiAlias,
                                child: ListTile(
                                  dense: true,
                                  contentPadding: const EdgeInsets.only(
                                    left: 12,
                                    right: 2,
                                  ),
                                  horizontalTitleGap: 10,
                                  leading: Icon(
                                    chat.busy
                                        ? Icons.bolt_rounded
                                        : Icons.chat_bubble_outline_rounded,
                                    size: 18,
                                    color: active ? lim.accent : lim.textDim,
                                  ),
                                  title: Text(
                                    chat.title,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: active
                                          ? FontWeight.w600
                                          : FontWeight.w400,
                                      color: active ? lim.text : lim.textMuted,
                                    ),
                                  ),
                                  subtitle: Padding(
                                    padding: const EdgeInsets.only(
                                      top: 5,
                                    ),
                                    child: Text(
                                      chat.busy ? 'Working…' : folder,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontSize: 10,
                                        color: lim.textDim,
                                      ),
                                    ),
                                  ),
                                  onTap: () => select(
                                    () => widget.onSelect(chat.chatId),
                                  ),
                                  trailing: PopupMenuButton<String>(
                                    tooltip: 'Conversation actions',
                                    icon: Icon(
                                      Icons.more_horiz,
                                      size: 17,
                                      color: lim.textDim,
                                    ),
                                    onSelected: (value) {
                                      if (value == 'split') {
                                        select(
                                          () => widget.onOpenBeside(
                                            chat.chatId,
                                          ),
                                        );
                                      }
                                      if (value == 'delete') {
                                        widget.onDelete(
                                          chat.chatId,
                                        );
                                      }
                                    },
                                    itemBuilder: (_) => [
                                      const PopupMenuItem(
                                        value: 'split',
                                        child: Text(
                                          'Open beside current chat',
                                        ),
                                      ),
                                      const PopupMenuItem(
                                        value: 'delete',
                                        child: Text(
                                          'Delete chat',
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                ),
                Divider(color: lim.border, height: 28),
                LiminalListRow(
                  title: 'Workspace home',
                  leading: Icon(
                    Icons.grid_view_outlined,
                    size: 18,
                    color: lim.textMuted,
                  ),
                  onTap: () => select(widget.onHome),
                ),
                LiminalListRow(
                  title: 'Settings',
                  leading: Icon(
                    Icons.tune_rounded,
                    size: 18,
                    color: lim.textMuted,
                  ),
                  onTap: () => select(() => context.push(AppRoutes.settings)),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(8, 18, 8, 0),
                  child: Text(
                    'LIMINAL  /  DESKTOP',
                    style: lim.monoStyle(
                      fontSize: 9,
                      color: lim.textDim,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    return widget.embedded
        ? content
        : Drawer(
            width: 300,
            shape: const RoundedRectangleBorder(),
            child: content,
          );
  }
}
