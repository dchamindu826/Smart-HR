/// Where the SmartHR backend runs. Set it when you build:
///   flutter run --dart-define=API_BASE=http://10.0.2.2:4000          (Android emulator → your PC)
///   flutter build ipa --dart-define=API_BASE=https://app.yourdomain.lk (App Store build)
class AppConfig {
  static const apiBase = String.fromEnvironment('API_BASE', defaultValue: 'https://smarthr.lumi-automation.com');
  static String get api => '$apiBase/api/v1';
  static const appName = 'SmartHR';
  static const supportEmail = 'info.lumiautomation@gmail.com';
  static String get privacyUrl => '$apiBase/privacy';
}
