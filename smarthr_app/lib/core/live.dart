import 'dart:async';
import 'package:flutter/foundation.dart';
import 'api.dart';

/// Unread counts shown on the More tab and its menu (GET /me/badges).
class Badges {
  final int messages;
  final int announcements;
  final int notifications;
  const Badges({this.messages = 0, this.announcements = 0, this.notifications = 0});
  int get total => messages + announcements;
}

/// Small app-wide signals: unread counts, the visible tab, and "the app came back".
class Live {
  static final ValueNotifier<Badges> badges = ValueNotifier(const Badges());

  /// Label of the tab now on screen ("Today", "Roster", ...).
  static final ValueNotifier<String> tab = ValueNotifier('Today');

  /// Bumped when the app returns to the foreground.
  static final ValueNotifier<int> resumed = ValueNotifier(0);

  static Future<Badges> refreshBadges() async {
    try {
      final r = (await Api.instance.get('/me/badges') as Map).cast<String, dynamic>();
      final b = Badges(
        messages: (r['messages'] as num? ?? 0).toInt(),
        announcements: (r['announcements'] as num? ?? 0).toInt(),
        notifications: (r['notifications'] as num? ?? 0).toInt(),
      );
      badges.value = b;
      return b;
    } catch (_) {
      return badges.value;
    }
  }

  static void reset() => badges.value = const Badges();
}
