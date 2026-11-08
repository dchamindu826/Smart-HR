import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Tokens live in the Keychain (iOS) / Keystore (Android), never in plain storage.
class TokenStore {
  static const _s = FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));
  String? _access;

  Future<String?> access() async => _access ??= await _s.read(key: 'at');
  Future<String?> refresh() => _s.read(key: 'rt');

  Future<void> save(String access, String refresh) async {
    _access = access;
    await _s.write(key: 'at', value: access);
    await _s.write(key: 'rt', value: refresh);
  }

  Future<void> clear() async {
    _access = null;
    await _s.delete(key: 'at');
    await _s.delete(key: 'rt');
  }
}
