import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/ui/rich_message/liminal_markdown_utils.dart';

void main() {
  test('isHtmlEmbedLang recognizes html embed languages', () {
    expect(isHtmlEmbedLang('html'), isTrue);
    expect(isHtmlEmbedLang('HTML'), isTrue);
    expect(isHtmlEmbedLang('htm'), isTrue);
    expect(isHtmlEmbedLang('xhtml'), isTrue);
    expect(isHtmlEmbedLang('javascript'), isFalse);
    expect(isHtmlEmbedLang(null), isFalse);
  });

  test('extractFencedCodeText strips trailing newline', () {
    expect(extractFencedCodeText('<div></div>\n'), '<div></div>');
  });

  test('balanceHtmlForStreamingPreview closes open elements', () {
    const partial = '<div style="color:red"><p>Hello<strong>world';
    final balanced = balanceHtmlForStreamingPreview(partial);
    expect(balanced, contains('<div'));
    expect(balanced, contains('Hello'));
    expect(balanced, endsWith('</div>'));
  });

  test('extractStreamingHtmlFence peels open html fence', () {
    const open = 'Intro\n\n```html\n<div>partial';
    final split = extractStreamingHtmlFence(open);
    expect(split.outerMarkdown, 'Intro');
    expect(split.htmlLive, '<div>partial');
  });

  test('extractStreamingHtmlFence null when fence closed', () {
    const closed = '```html\n<div>ok</div>\n```\n\nAfter';
    final split = extractStreamingHtmlFence(closed);
    expect(split.htmlLive, isNull);
    expect(split.outerMarkdown, closed);
  });

  test('splitMessageSegments extracts closed html block', () {
    const text = 'Before\n\n```html\n<div>x</div>\n```\n\nAfter';
    final segs = splitMessageSegments(text);
    expect(segs.length, 3);
    expect(segs[0].kind, MessageSegmentKind.markdown);
    expect(segs[1].kind, MessageSegmentKind.htmlEmbed);
    expect(segs[1].content, contains('<div>x</div>'));
  });
}
