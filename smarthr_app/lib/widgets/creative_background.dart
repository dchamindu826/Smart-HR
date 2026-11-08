import 'package:flutter/material.dart';
import '../theme.dart';

enum BackgroundTheme {
  home, // Luminous ambient mesh blobs
  leave, // Organic sweeping waves & soft ripples
  roster, // Geometric calendar dots & arches
  payslips, // Sleek financial geometric curves
  profile, // Dramatic curved dark header & floating accents
}

/// A creative, artistic background pattern custom-crafted for each screen.
class CreativeBackground extends StatelessWidget {
  final BackgroundTheme theme;
  final Widget child;

  const CreativeBackground({
    super.key,
    required this.theme,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Stack(
      fit: StackFit.expand,
      children: [
        // Base decorative canvas
        Positioned.fill(
          child: CustomPaint(
            painter: _BackgroundPainter(theme: theme, dark: dark),
          ),
        ),
        // Screen content
        child,
      ],
    );
  }
}

class _BackgroundPainter extends CustomPainter {
  final BackgroundTheme theme;
  final bool dark;

  _BackgroundPainter({required this.theme, required this.dark});

  @override
  void paint(Canvas canvas, Size size) {
    switch (theme) {
      case BackgroundTheme.home:
        _paintHome(canvas, size);
        break;
      case BackgroundTheme.leave:
        _paintLeave(canvas, size);
        break;
      case BackgroundTheme.roster:
        _paintRoster(canvas, size);
        break;
      case BackgroundTheme.payslips:
        _paintPayslips(canvas, size);
        break;
      case BackgroundTheme.profile:
        _paintProfile(canvas, size);
        break;
    }
  }

  /// Ambient glowing mesh gradient blobs (Home / Today screen)
  void _paintHome(Canvas canvas, Size size) {
    // Top right pink/magenta glow
    final p1 = Paint()
      ..shader = RadialGradient(
        colors: [
          Brand.magenta.withValues(alpha: dark ? 0.16 : 0.12),
          Brand.pink.withValues(alpha: dark ? 0.08 : 0.05),
          Colors.transparent,
        ],
        stops: const [0.0, 0.5, 1.0],
      ).createShader(Rect.fromCircle(center: Offset(size.width * 0.9, size.height * 0.12), radius: 240));
    canvas.drawCircle(Offset(size.width * 0.9, size.height * 0.12), 240, p1);

    // Top left subtle cyan/blue glow
    final p2 = Paint()
      ..shader = RadialGradient(
        colors: [
          Brand.blue.withValues(alpha: dark ? 0.15 : 0.09),
          Colors.transparent,
        ],
      ).createShader(Rect.fromCircle(center: Offset(size.width * 0.05, size.height * 0.28), radius: 200));
    canvas.drawCircle(Offset(size.width * 0.05, size.height * 0.28), 200, p2);

    // Subtle decorative curved line
    final linePaint = Paint()
      ..color = (dark ? Colors.white : Brand.blue).withValues(alpha: dark ? 0.04 : 0.05)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    final path = Path()
      ..moveTo(0, size.height * 0.35)
      ..cubicTo(
        size.width * 0.35,
        size.height * 0.42,
        size.width * 0.7,
        size.height * 0.28,
        size.width,
        size.height * 0.36,
      );
    canvas.drawPath(path, linePaint);
  }

  /// Sweeping organic waves & ripples (Leave screen)
  void _paintLeave(Canvas canvas, Size size) {
    // Organic curved wave at top
    final wavePaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          Brand.magenta.withValues(alpha: dark ? 0.18 : 0.11),
          Brand.coral.withValues(alpha: dark ? 0.12 : 0.06),
          Colors.transparent,
        ],
      ).createShader(Rect.fromLTWH(0, 0, size.width, size.height * 0.4));

    final wavePath = Path()
      ..moveTo(0, 0)
      ..lineTo(0, size.height * 0.22)
      ..quadraticBezierTo(
        size.width * 0.3,
        size.height * 0.28,
        size.width * 0.65,
        size.height * 0.20,
      )
      ..quadraticBezierTo(
        size.width * 0.88,
        size.height * 0.15,
        size.width,
        size.height * 0.22,
      )
      ..lineTo(size.width, 0)
      ..close();
    canvas.drawPath(wavePath, wavePaint);

    // Floating subtle decorative concentric ripples
    final ripplePaint = Paint()
      ..color = (dark ? Colors.white : Brand.coral).withValues(alpha: dark ? 0.05 : 0.06)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    canvas.drawCircle(Offset(size.width * 0.85, size.height * 0.18), 36, ripplePaint);
    canvas.drawCircle(Offset(size.width * 0.85, size.height * 0.18), 64, ripplePaint);

    // Bottom soft warm glow
    final bgGlow = Paint()
      ..shader = RadialGradient(
        colors: [
          Brand.blue.withValues(alpha: dark ? 0.12 : 0.06),
          Colors.transparent,
        ],
      ).createShader(Rect.fromCircle(center: Offset(size.width * 0.1, size.height * 0.75), radius: 260));
    canvas.drawCircle(Offset(size.width * 0.1, size.height * 0.75), 260, bgGlow);
  }

  /// Modern calendar dots & rhythmic arches (Roster screen)
  void _paintRoster(Canvas canvas, Size size) {
    // Top blue aura
    final aura = Paint()
      ..shader = RadialGradient(
        colors: [
          Brand.blue.withValues(alpha: dark ? 0.18 : 0.10),
          Colors.transparent,
        ],
      ).createShader(Rect.fromCircle(center: Offset(size.width * 0.8, size.height * 0.15), radius: 220));
    canvas.drawCircle(Offset(size.width * 0.8, size.height * 0.15), 220, aura);

    // Subtle decorative dot matrix
    final dotPaint = Paint()
      ..color = (dark ? Colors.white : Brand.navy).withValues(alpha: dark ? 0.05 : 0.04);
    const spacing = 28.0;
    for (double x = size.width * 0.55; x < size.width; x += spacing) {
      for (double y = 40.0; y < size.height * 0.22; y += spacing) {
        canvas.drawCircle(Offset(x, y), 2.2, dotPaint);
      }
    }

    // Gentle sweeping arch
    final archPaint = Paint()
      ..color = (dark ? const Color(0xFF38BDF8) : Brand.blue).withValues(alpha: dark ? 0.07 : 0.06)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    final arch = Path()
      ..moveTo(0, size.height * 0.18)
      ..cubicTo(size.width * 0.4, size.height * 0.12, size.width * 0.7, size.height * 0.24, size.width, size.height * 0.16);
    canvas.drawPath(arch, archPaint);
  }

  /// Sleek geometric arches (Payslips screen)
  void _paintPayslips(Canvas canvas, Size size) {
    // Emerald / Teal / Navy luxury glow
    final pGlow = Paint()
      ..shader = RadialGradient(
        colors: [
          Brand.ok.withValues(alpha: dark ? 0.15 : 0.08),
          Brand.blue.withValues(alpha: dark ? 0.10 : 0.05),
          Colors.transparent,
        ],
      ).createShader(Rect.fromCircle(center: Offset(size.width * 0.2, size.height * 0.16), radius: 250));
    canvas.drawCircle(Offset(size.width * 0.2, size.height * 0.16), 250, pGlow);

    // Geometric curved crest
    final crestPaint = Paint()
      ..shader = LinearGradient(
        colors: [
          Brand.ok.withValues(alpha: dark ? 0.10 : 0.06),
          Colors.transparent,
        ],
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
      ).createShader(Rect.fromLTWH(0, 0, size.width, size.height * 0.3));

    final crest = Path()
      ..moveTo(0, 0)
      ..lineTo(0, size.height * 0.18)
      ..cubicTo(size.width * 0.3, size.height * 0.24, size.width * 0.7, size.height * 0.14, size.width, size.height * 0.20)
      ..lineTo(size.width, 0)
      ..close();
    canvas.drawPath(crest, crestPaint);
  }

  /// Organic sweeping dark crest (More / Profile screen - like Image 2!)
  void _paintProfile(Canvas canvas, Size size) {
    // Dramatic curved dark top container
    final headerPaint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          Color(0xFF0F172A),
          Color(0xFF1E1B4B),
          Color(0xFF0F172A),
        ],
      ).createShader(Rect.fromLTWH(0, 0, size.width, size.height * 0.34));

    final headerPath = Path()
      ..moveTo(0, 0)
      ..lineTo(0, size.height * 0.28)
      ..quadraticBezierTo(
        size.width * 0.5,
        size.height * 0.35,
        size.width,
        size.height * 0.28,
      )
      ..lineTo(size.width, 0)
      ..close();
    canvas.drawPath(headerPath, headerPaint);

    // Glowing accents behind header
    final glow = Paint()
      ..shader = RadialGradient(
        colors: [
          Brand.magenta.withValues(alpha: 0.30),
          Colors.transparent,
        ],
      ).createShader(Rect.fromCircle(center: Offset(size.width * 0.5, size.height * 0.16), radius: 120));
    canvas.drawCircle(Offset(size.width * 0.5, size.height * 0.16), 120, glow);
  }

  @override
  bool shouldRepaint(_BackgroundPainter old) => old.theme != theme || old.dark != dark;
}
