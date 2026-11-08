import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';
import 'api.dart';

/// Punches made without internet wait here and are sent in order later.
/// Each has a clientId, so sending one twice never makes two sessions.
class PunchQueue {
  static const _key = 'smarthr.punchQueue';
  static const _uuid = Uuid();
  static bool _sending = false;

  static Map<String, dynamic> build({
    required String kind,
    required String mode,
    double? lat,
    double? lng,
    double? accuracy,
    bool mocked = false,
    bool? faceVerified,
    double? faceScore,
  }) => {
        'clientId': _uuid.v4(),
        'kind': kind,
        'mode': mode,
        'occurredAt': DateTime.now().toUtc().toIso8601String(),
        if (lat != null) 'lat': lat,
        if (lng != null) 'lng': lng,
        if (accuracy != null) 'accuracyM': accuracy,
        'mocked': mocked,
        if (faceVerified != null) 'faceVerified': faceVerified,
        if (faceScore != null) 'faceScore': faceScore,
      };

  static Future<List<Map<String, dynamic>>> pending() async {
    final p = await SharedPreferences.getInstance();
    final raw = p.getString(_key);
    if (raw == null) return [];
    return (jsonDecode(raw) as List).map((e) => (e as Map).cast<String, dynamic>()).toList();
  }

  static Future<void> add(Map<String, dynamic> punch) async {
    final list = await pending()..add(punch);
    final p = await SharedPreferences.getInstance();
    await p.setString(_key, jsonEncode(list));
  }

  static Future<void> _save(List<Map<String, dynamic>> list) async {
    final p = await SharedPreferences.getInstance();
    if (list.isEmpty) {
      await p.remove(_key);
    } else {
      await p.setString(_key, jsonEncode(list));
    }
  }

  /// Sends everything waiting. Returns the server's "today" if anything was sent,
  /// plus the reasons for any punch the server refused.
  static Future<({Map<String, dynamic>? today, List<String> rejected})> flush() async {
    if (_sending) return (today: null, rejected: <String>[]);
    final list = await pending();
    if (list.isEmpty) return (today: null, rejected: <String>[]);
    _sending = true;
    try {
      final r = await Api.instance.post('/attendance/sync', {'punches': list});
      final results = ((r['results'] as List?) ?? []).cast<Map>();
      final rejected = results.where((x) => x['result'] == 'REJECTED').map((x) => '${x['reason'] ?? 'Refused'}').toList();
      // every punch got an answer (accepted, duplicate or refused): clear the queue
      await _save([]);
      return (today: (r['today'] as Map?)?.cast<String, dynamic>(), rejected: rejected);
    } on ApiError catch (e) {
      if (e.status == 0) return (today: null, rejected: <String>[]); // still offline: keep them
      rethrow;
    } finally {
      _sending = false;
    }
  }
}
