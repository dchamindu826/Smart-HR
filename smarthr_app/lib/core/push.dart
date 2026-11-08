import 'dart:io';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'api.dart';

/// Push notifications (Firebase Cloud Messaging).
///
/// The backend sends a push when leave or overtime is decided, a roster is
/// published, a payslip is released, an announcement is posted or a message
/// arrives. If Firebase is not set up yet (no google-services.json /
/// GoogleService-Info.plist), everything here quietly does nothing and the
/// app keeps working without push.
class Push {
  static bool _ready = false;
  static String? _token;

  static Future<void> init() async {
    try {
      await Firebase.initializeApp();
      _ready = true;
    } catch (_) {
      _ready = false;
    }
  }

  /// Call after sign-in. Asks permission once and sends the token to the server.
  static Future<void> register() async {
    if (!_ready) return;
    try {
      final fm = FirebaseMessaging.instance;
      final perm = await fm.requestPermission(alert: true, badge: true, sound: true);
      if (perm.authorizationStatus == AuthorizationStatus.denied) return;
      await fm.setForegroundNotificationPresentationOptions(alert: true, badge: true, sound: true);
      if (Platform.isIOS) {
        // the APNs token must exist before FCM can give a token on iOS
        for (var i = 0; i < 5 && await fm.getAPNSToken() == null; i++) {
          await Future<void>.delayed(const Duration(seconds: 1));
        }
      }
      final t = await fm.getToken();
      if (t == null) return;
      _token = t;
      await Api.instance.post('/me/push-token', {'token': t, 'platform': Platform.isIOS ? 'ios' : 'android'});
      fm.onTokenRefresh.listen((nt) {
        _token = nt;
        Api.instance.post('/me/push-token', {'token': nt, 'platform': Platform.isIOS ? 'ios' : 'android'}).catchError((_) => null);
      });
    } catch (_) {
      // push is optional
    }
  }

  /// Call before sign-out so this phone stops getting the user's notifications.
  static Future<void> unregister() async {
    final t = _token;
    if (!_ready || t == null) return;
    try {
      await Api.instance.delete('/me/push-token', {'token': t});
    } catch (_) {}
    _token = null;
  }
}
