import 'package:flutter/material.dart';

enum IntegrationBrandId { google, microsoft, xero, slack, linear, notion, github, advanced }

class IntegrationBrandMeta {
  const IntegrationBrandMeta({
    required this.id,
    required this.title,
    required this.tagline,
    required this.accent,
    required this.accentSoft,
  });

  final IntegrationBrandId id;
  final String title;
  final String tagline;
  final Color accent;
  final Color accentSoft;
}

const integrationBrands = <IntegrationBrandId, IntegrationBrandMeta>{
  IntegrationBrandId.google: IntegrationBrandMeta(
    id: IntegrationBrandId.google,
    title: 'Google',
    tagline: 'Gmail, Calendar, Drive & Docs',
    accent: Color(0xFF4285F4),
    accentSoft: Color(0x244285F4),
  ),
  IntegrationBrandId.microsoft: IntegrationBrandMeta(
    id: IntegrationBrandId.microsoft,
    title: 'Microsoft 365',
    tagline: 'Outlook, Teams & OneDrive',
    accent: Color(0xFF00A4EF),
    accentSoft: Color(0x2400A4EF),
  ),
  IntegrationBrandId.xero: IntegrationBrandMeta(
    id: IntegrationBrandId.xero,
    title: 'Xero',
    tagline: 'Invoices & accounting',
    accent: Color(0xFF13B5EA),
    accentSoft: Color(0x2413B5EA),
  ),
  IntegrationBrandId.slack: IntegrationBrandMeta(
    id: IntegrationBrandId.slack,
    title: 'Slack',
    tagline: 'Channels, messages & team chat',
    accent: Color(0xFFE01E5A),
    accentSoft: Color(0x24E01E5A),
  ),
  IntegrationBrandId.linear: IntegrationBrandMeta(
    id: IntegrationBrandId.linear,
    title: 'Linear',
    tagline: 'Issues, teams & project tracking',
    accent: Color(0xFF5E6AD2),
    accentSoft: Color(0x245E6AD2),
  ),
  IntegrationBrandId.notion: IntegrationBrandMeta(
    id: IntegrationBrandId.notion,
    title: 'Notion',
    tagline: 'Pages, databases & workspace docs',
    accent: Color(0xFFFFFFFF),
    accentSoft: Color(0x14FFFFFF),
  ),
  IntegrationBrandId.github: IntegrationBrandMeta(
    id: IntegrationBrandId.github,
    title: 'GitHub',
    tagline: 'Repos, issues & pull requests',
    accent: Color(0xFFE6EDF3),
    accentSoft: Color(0x1AE6EDF3),
  ),
  IntegrationBrandId.advanced: IntegrationBrandMeta(
    id: IntegrationBrandId.advanced,
    title: 'Advanced',
    tagline: 'Custom APIs & servers',
    accent: Color(0xFF9AA8B8),
    accentSoft: Color(0x1A9AA8B8),
  ),
};

class IntegrationBrandIcon extends StatelessWidget {
  const IntegrationBrandIcon({super.key, required this.id, this.size = 48});

  final IntegrationBrandId id;
  final double size;

  @override
  Widget build(BuildContext context) {
    final brand = integrationBrands[id]!;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: brand.accentSoft,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: brand.accent.withValues(alpha: 0.2)),
      ),
      alignment: Alignment.center,
      child: _BrandLogo(id: id),
    );
  }
}

class _BrandLogo extends StatelessWidget {
  const _BrandLogo({required this.id});

  final IntegrationBrandId id;

  @override
  Widget build(BuildContext context) {
    switch (id) {
      case IntegrationBrandId.google:
        return CustomPaint(size: const Size(28, 28), painter: _GoogleLogoPainter());
      case IntegrationBrandId.microsoft:
        return CustomPaint(size: const Size(28, 28), painter: _MicrosoftLogoPainter());
      case IntegrationBrandId.xero:
        return CustomPaint(size: const Size(28, 28), painter: _XeroLogoPainter());
      case IntegrationBrandId.slack:
        return Icon(Icons.tag_faces_rounded, size: 26, color: integrationBrands[id]!.accent);
      case IntegrationBrandId.linear:
        return Icon(Icons.linear_scale_rounded, size: 26, color: integrationBrands[id]!.accent);
      case IntegrationBrandId.notion:
        return Icon(Icons.description_outlined, size: 26, color: integrationBrands[id]!.accent);
      case IntegrationBrandId.github:
        return CustomPaint(size: const Size(28, 28), painter: _GithubLogoPainter());
      case IntegrationBrandId.advanced:
        return Icon(Icons.tune_rounded, size: 26, color: integrationBrands[id]!.accent);
    }
  }
}

class _GoogleLogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24;
    void arc(Color c, double start, double sweep) {
      final p = Paint()
        ..color = c
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4.2 * s
        ..strokeCap = StrokeCap.round;
      canvas.drawArc(Rect.fromLTWH(4 * s, 4 * s, 16 * s, 16 * s), start, sweep, false, p);
    }

    arc(const Color(0xFFEA4335), -0.45, 1.15);
    arc(const Color(0xFF34A853), 0.7, 1.15);
    arc(const Color(0xFFFBBC05), 2.0, 1.15);
    arc(const Color(0xFF4285F4), 3.3, 1.15);
    canvas.drawLine(Offset(12 * s, 11.5 * s), Offset(18.5 * s, 11.5 * s), Paint()..color = const Color(0xFF4285F4)..strokeWidth = 3.6 * s);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _MicrosoftLogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24;
    void sq(double x, double y, Color c) {
      canvas.drawRect(Rect.fromLTWH(x * s, y * s, 9.2 * s, 9.2 * s), Paint()..color = c);
    }

    sq(2, 2, const Color(0xFFF25022));
    sq(12.8, 2, const Color(0xFF7FBA00));
    sq(2, 12.8, const Color(0xFF00A4EF));
    sq(12.8, 12.8, const Color(0xFFFFB900));
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _XeroLogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24;
    canvas.drawCircle(Offset(12 * s, 12 * s), 11 * s, Paint()..color = const Color(0xFF13B5EA));
    final tp = TextPainter(
      text: const TextSpan(
        text: 'X',
        style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w700),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, Offset((size.width - tp.width) / 2, (size.height - tp.height) / 2));
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _GithubLogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24;
    final paint = Paint()..color = const Color(0xFFE6EDF3);
    final path = Path()
      ..moveTo(12 * s, 2 * s)
      ..cubicTo(6.48 * s, 2 * s, 2 * s, 6.58 * s, 2 * s, 12.26 * s)
      ..cubicTo(2 * s, 16.78 * s, 4.87 * s, 20.61 * s, 8.84 * s, 21.96 * s)
      ..cubicTo(9.34 * s, 22.06 * s, 9.52 * s, 21.74 * s, 9.52 * s, 21.48 * s)
      ..cubicTo(9.52 * s, 21.24 * s, 9.51 * s, 20.61 * s, 9.51 * s, 19.78 * s)
      ..cubicTo(6.73 * s, 20.4 * s, 6.14 * s, 18.42 * s, 6.14 * s, 18.42 * s)
      ..cubicTo(5.69 * s, 17.25 * s, 5.03 * s, 16.94 * s, 5.03 * s, 16.94 * s)
      ..cubicTo(4.12 * s, 16.3 * s, 5.1 * s, 16.29 * s, 5.1 * s, 16.29 * s)
      ..cubicTo(6.1 * s, 16.36 * s, 6.63 * s, 17.34 * s, 6.63 * s, 17.34 * s)
      ..cubicTo(7.53 * s, 18.9 * s, 8.99 * s, 18.45 * s, 9.57 * s, 18.19 * s)
      ..cubicTo(9.66 * s, 17.52 * s, 9.92 * s, 17.08 * s, 10.2 * s, 16.82 * s)
      ..cubicTo(7.98 * s, 16.56 * s, 5.64 * s, 15.68 * s, 5.64 * s, 11.75 * s)
      ..cubicTo(5.64 * s, 10.63 * s, 6.03 * s, 9.72 * s, 6.67 * s, 9 * s)
      ..cubicTo(6.57 * s, 8.74 * s, 6.22 * s, 7.58 * s, 6.77 * s, 6.16 * s)
      ..cubicTo(6.77 * s, 6.16 * s, 7.61 * s, 5.89 * s, 9.52 * s, 7.16 * s)
      ..cubicTo(10.37 * s, 6.96 * s, 11.23 * s, 6.86 * s, 12.09 * s, 6.86 * s)
      ..cubicTo(12.94 * s, 6.86 * s, 13.8 * s, 6.96 * s, 14.65 * s, 7.16 * s)
      ..cubicTo(16.56 * s, 5.89 * s, 17.4 * s, 6.16 * s, 17.4 * s, 6.16 * s)
      ..cubicTo(17.95 * s, 7.58 * s, 17.6 * s, 8.74 * s, 17.5 * s, 9 * s)
      ..cubicTo(18.14 * s, 9.72 * s, 18.53 * s, 10.63 * s, 18.53 * s, 11.75 * s)
      ..cubicTo(18.53 * s, 15.69 * s, 16.19 * s, 16.56 * s, 13.96 * s, 16.82 * s)
      ..cubicTo(14.24 * s, 17.08 * s, 14.5 * s, 17.52 * s, 14.59 * s, 18.19 * s)
      ..cubicTo(15.17 * s, 18.45 * s, 16.63 * s, 18.9 * s, 17.53 * s, 17.34 * s)
      ..cubicTo(17.53 * s, 17.34 * s, 18.06 * s, 16.36 * s, 19.06 * s, 16.29 * s)
      ..cubicTo(19.06 * s, 16.29 * s, 20.04 * s, 16.3 * s, 19.13 * s, 16.94 * s)
      ..cubicTo(19.13 * s, 16.94 * s, 18.47 * s, 17.25 * s, 18.02 * s, 18.42 * s)
      ..cubicTo(18.02 * s, 18.42 * s, 17.43 * s, 20.4 * s, 14.65 * s, 19.78 * s)
      ..cubicTo(14.65 * s, 20.61 * s, 14.64 * s, 21.24 * s, 14.64 * s, 21.48 * s)
      ..cubicTo(14.64 * s, 21.74 * s, 14.82 * s, 22.06 * s, 15.32 * s, 21.96 * s)
      ..cubicTo(19.29 * s, 20.61 * s, 22.16 * s, 16.78 * s, 22.16 * s, 12.26 * s)
      ..cubicTo(22 * s, 6.58 * s, 17.52 * s, 2 * s, 12 * s, 2 * s)
      ..close();
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
