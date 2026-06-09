import 'package:flutter/material.dart';

import '../theme/liminal_theme_extension.dart';
import 'html_embed_view.dart';
import 'liminal_markdown_utils.dart';
import 'markdown_block.dart';

/// Assistant message rich renderer (web `AssistantMessageContent` parity).
class LiminalMessageContent extends StatelessWidget {
  const LiminalMessageContent({
    super.key,
    required this.text,
    this.streaming = false,
  });

  final String text;
  final bool streaming;

  @override
  Widget build(BuildContext context) {
    final body = text.isEmpty ? '…' : text;

    if (streaming) {
      final split = extractStreamingHtmlFence(body);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (split.outerMarkdown.trim().isNotEmpty)
            LiminalMarkdownBlock(
              data: split.outerMarkdown,
              streaming: true,
            ),
          if (split.htmlLive != null)
            HtmlEmbedView(html: split.htmlLive!, streaming: true),
          if (streaming && text.isNotEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 4),
              child: _StreamingCursor(),
            ),
        ],
      );
    }

    final segments = splitMessageSegments(body);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final seg in segments)
          switch (seg.kind) {
            MessageSegmentKind.markdown => LiminalMarkdownBlock(data: seg.content),
            MessageSegmentKind.htmlEmbed => HtmlEmbedView(html: seg.content),
          },
      ],
    );
  }
}

class _StreamingCursor extends StatelessWidget {
  const _StreamingCursor();

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Text(
      '▍',
      style: TextStyle(
        color: lim.assistantAccent,
        fontFamily: lim.fontFamilyMono,
        fontSize: 14,
      ),
    );
  }
}
