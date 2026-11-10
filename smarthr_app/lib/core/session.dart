import 'package:flutter/foundation.dart';
import '../widgets/avatar.dart';
import 'live.dart';
import 'api.dart';
import 'push.dart';

/// The signed-in user (from GET /me).
class Me {
  final Map<String, dynamic> raw;
  Me(this.raw);

  Map<String, dynamic> get user => (raw['user'] as Map).cast<String, dynamic>();
  Map<String, dynamic> get tenant => (raw['tenant'] as Map).cast<String, dynamic>();
  Map<String, dynamic>? get employee => user['employee'] == null ? null : (user['employee'] as Map).cast<String, dynamic>();
  Map<String, dynamic>? get attendance => raw['attendance'] == null ? null : (raw['attendance'] as Map).cast<String, dynamic>();

  String get name => '${user['name']}';
  String get roleLabel => '${user['roleLabel'] ?? ''}';
  String get companyName => '${tenant['name']}';
  bool get mustChangePassword => user['mustChangePassword'] == true;
  bool get isManager => raw['isManager'] == true;
  List<String> get permissions => ((raw['permissions'] as List?) ?? []).map((e) => '$e').toList();
  List<String> get features => ((tenant['features'] as List?) ?? []).map((e) => '$e').toList();
  bool can(String a) => permissions.contains(a);
  bool has(String f) => features.contains(f);
  bool get requireLocation => attendance?['requireLocation'] == true;
  bool get requireFace => attendance?['requireFace'] == true;
  bool get allowRemote => attendance?['allowRemote'] == true;
  bool get approves => isManager || can('leave.approve') || can('overtime.approve');
  bool get hasPhoto => employee?['photoPath'] != null;
  String? get birthdayMd {
    final dob = employee?['dob'];
    if (dob == null) return null;
    final s = '$dob';
    if (s.length >= 10) return s.substring(5, 10);
    return null;
  }
  bool get birthdayHidden => employee?['birthdayOptOut'] == true;
}

enum AuthState { loading, signedOut, signedIn }

class Session extends ChangeNotifier {
  final api = Api.instance;
  AuthState state = AuthState.loading;
  Me? me;

  Future<void> boot() async {
    api.onSessionExpired = () {
      if (state == AuthState.signedIn) _signedOut();
    };
    if (await api.tokens.refresh() == null) return _signedOut();
    try {
      me = Me((await api.get('/me') as Map).cast<String, dynamic>());
      state = AuthState.signedIn;
      Push.register();
    } on ApiError catch (e) {
      if (e.status == 401 || e.status == 403) {
        await api.tokens.clear();
        return _signedOut();
      }
      // offline at start: keep the session, show what we can
      state = me == null ? AuthState.signedOut : AuthState.signedIn;
    }
    notifyListeners();
  }

  /// Returns null on success; a list of companies when the login is in several.
  Future<List<Map<String, dynamic>>?> login(String login, String password, {String? company}) async {
    try {
      final r = await api.postNoAuth('/auth/login', {
        'login': login.trim(),
        'password': password,
        'client': 'mobile',
        if (company != null && company.isNotEmpty) 'company': company,
      });
      await api.tokens.save(r['accessToken'] as String, r['refreshToken'] as String);
      await reloadMe();
      state = AuthState.signedIn;
      notifyListeners();
      Push.register();
      return null;
    } on ApiError catch (e) {
      final d = e.details;
      if (e.status == 409 && d is Map && d['code'] == 'COMPANY_REQUIRED') {
        return ((d['companies'] as List?) ?? []).map((c) => (c as Map).cast<String, dynamic>()).toList();
      }
      rethrow;
    }
  }

  Future<void> reloadMe() async {
    me = Me((await api.get('/me') as Map).cast<String, dynamic>());
    notifyListeners();
  }

  /// Sends a reset link to the email on the account.
  Future<String> forgotPassword(String email, {String? company}) async {
    final r = await api.postNoAuth('/auth/forgot-password', {'email': email.trim(), if (company != null && company.isNotEmpty) 'company': company});
    return '${(r as Map)['message'] ?? 'If this email has an account, a reset link is on its way.'}';
  }

  Future<void> changePassword(String current, String next) async {
    await api.post('/auth/change-password', {'current': current, 'next': next});
    await reloadMe();
  }

  Future<void> logout() async {
    await Push.unregister();
    final rt = await api.tokens.refresh();
    try {
      if (rt != null) await api.postNoAuth('/auth/logout', {'refreshToken': rt});
    } catch (_) {}
    await api.tokens.clear();
    _signedOut();
  }

  void _signedOut() {
    PhotoCache.bump();
    Live.reset();
    me = null;
    state = AuthState.signedOut;
    notifyListeners();
  }
}
