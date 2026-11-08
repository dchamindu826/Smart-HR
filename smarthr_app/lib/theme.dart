import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Colours from the SmartHR logo & modern design system.
class Brand {
  static const navy = Color(0xFF001A45);
  static const blue = Color(0xFF0B6FD4);
  static const magenta = Color(0xFFC810B0);
  static const pink = Color(0xFFE40675);
  static const coral = Color(0xFFFF5268);
  static const ok = Color(0xFF10B981);
  static const warn = Color(0xFFF59E0B);
  static const bad = Color(0xFFEF4444);

  static const ink = Color(0xFF0F172A);
  static const inkMuted = Color(0xFF64748B);
  static const inkLight = Color(0xFF94A3B8);

  static const gradient = LinearGradient(
    colors: [pink, magenta, blue],
    stops: [0, .5, 1],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const coralGradient = LinearGradient(
    colors: [Color(0xFFFF5268), Color(0xFFFF7A8A)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const subtleGrad = LinearGradient(
    colors: [Color(0xFFFDE8F3), Color(0xFFEAF2FD)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}

ThemeData buildTheme(Brightness b) {
  final dark = b == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: Brand.blue,
    brightness: b,
    primary: dark ? const Color(0xFF4FA6F8) : Brand.blue,
    secondary: dark ? const Color(0xFFEE72DA) : Brand.magenta,
    surface: dark ? const Color(0xFF11192C) : Colors.white,
    error: dark ? const Color(0xFFF08370) : Brand.bad,
  );
  final bg = dark ? const Color(0xFF080D1A) : const Color(0xFFF4F6FA);

  return ThemeData(
    useMaterial3: true,
    brightness: b,
    colorScheme: scheme,
    scaffoldBackgroundColor: bg,
    appBarTheme: AppBarTheme(
      backgroundColor: bg,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      foregroundColor: dark ? Colors.white : Brand.ink,
      systemOverlayStyle: dark
          ? SystemUiOverlayStyle.light
          : const SystemUiOverlayStyle(
              statusBarColor: Colors.transparent,
              statusBarBrightness: Brightness.light,
              statusBarIconBrightness: Brightness.dark,
              systemNavigationBarColor: Colors.transparent,
              systemNavigationBarIconBrightness: Brightness.dark,
            ),
      titleTextStyle: TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.w700,
        color: dark ? Colors.white : Brand.ink,
        letterSpacing: -.02,
      ),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: scheme.surface,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
        side: BorderSide(color: dark ? const Color(0xFF1E293B) : const Color(0x0F000000)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: dark ? const Color(0xFF1E293B) : const Color(0xFFE2E8F0)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Brand.blue, width: 2),
      ),
      filled: true,
      fillColor: dark ? const Color(0xFF162035) : Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        elevation: 0,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        side: BorderSide(color: dark ? const Color(0xFF334155) : const Color(0xFFCBD5E1)),
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: dark ? const Color(0xFF11192C) : Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(32))),
      elevation: 12,
    ),
  );
}
