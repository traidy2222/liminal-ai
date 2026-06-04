import 'html_sanitizer.dart';

/// YouTube / Vimeo detection (web `App.tsx` parity).

class VideoEmbed {
  const VideoEmbed({required this.platform, required this.id});

  final String platform;
  final String id;
}

VideoEmbed? detectVideoEmbed(String url) {
  final trimmed = url.trim();
  if (trimmed.isEmpty) return null;

  final yt = RegExp(
    r'(?:youtube\.com/(?:watch\?.*v=|embed/)|youtu\.be/)([a-zA-Z0-9_-]{11})',
  ).firstMatch(trimmed);
  if (yt != null) {
    return VideoEmbed(platform: 'youtube', id: yt.group(1)!);
  }

  final vm = RegExp(r'vimeo\.com/(?:video/)?(\d+)').firstMatch(trimmed);
  if (vm != null) {
    return VideoEmbed(platform: 'vimeo', id: vm.group(1)!);
  }

  return null;
}

String videoEmbedIframeSrc(VideoEmbed embed) {
  if (embed.platform == 'youtube') {
    return 'https://www.youtube.com/embed/${embed.id}?rel=0';
  }
  return 'https://player.vimeo.com/video/${embed.id}';
}

String videoEmbedIframeHtml(VideoEmbed embed) {
  final src = videoEmbedIframeSrc(embed);
  return sanitizeEmbedHtml('''
<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;background:#010305;">
<iframe src="$src" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"
 allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
 allowfullscreen title="Video"></iframe>
</div>
''');
}
