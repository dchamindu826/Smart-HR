import 'dart:async';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import '../config.dart';
import 'token_store.dart';

/// An error the backend explained, ready to show to the user.
class ApiError implements Exception {
  final int status;
  final String code;
  final String message;
  final dynamic details;
  ApiError(this.status, this.code, this.message, [this.details]);
  @override
  String toString() => message;

  static ApiError from(Object e) {
    if (e is ApiError) return e;
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map && data['error'] is Map) {
        final err = data['error'] as Map;
        return ApiError(e.response?.statusCode ?? 0, '${err['code'] ?? 'ERROR'}', '${err['message'] ?? 'Something went wrong.'}', err['details']);
      }
      if (e.type == DioExceptionType.connectionError || e.type == DioExceptionType.connectionTimeout || e.type == DioExceptionType.receiveTimeout) {
        return ApiError(0, 'OFFLINE', 'No connection to SmartHR. Check your internet and try again.');
      }
      return ApiError(e.response?.statusCode ?? 0, 'ERROR', 'Something went wrong (${e.response?.statusCode ?? e.type.name}).');
    }
    return ApiError(0, 'ERROR', e.toString());
  }
}

/// The one HTTP client. Adds the access token; on 401 refreshes once and retries.
class Api {
  Api._();
  static final Api instance = Api._();

  final TokenStore tokens = TokenStore();
  final Dio dio = Dio(BaseOptions(
    baseUrl: AppConfig.api,
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 30),
    headers: {'x-smarthr-client': 'mobile'},
  ));
  Completer<bool>? _refreshing;

  /// Called when the session can no longer be refreshed (log the user out).
  void Function()? onSessionExpired;

  void init() {
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final at = await tokens.access();
        if (at != null && options.extra['noAuth'] != true) options.headers['Authorization'] = 'Bearer $at';
        handler.next(options);
      },
      onError: (e, handler) async {
        final req = e.requestOptions;
        final is401 = e.response?.statusCode == 401;
        if (is401 && req.extra['retried'] != true && req.extra['noAuth'] != true) {
          if (await _refresh()) {
            req.extra['retried'] = true;
            req.headers['Authorization'] = 'Bearer ${await tokens.access()}';
            try {
              return handler.resolve(await dio.fetch(req));
            } catch (err) {
              if (err is DioException) return handler.next(err);
            }
          } else {
            onSessionExpired?.call();
          }
        }
        handler.next(e);
      },
    ));
  }

  Future<bool> _refresh() async {
    if (_refreshing != null) return _refreshing!.future;
    final c = Completer<bool>();
    _refreshing = c;
    try {
      final rt = await tokens.refresh();
      if (rt == null) {
        c.complete(false);
      } else {
        final r = await dio.post('/auth/refresh', data: {'refreshToken': rt}, options: Options(extra: {'noAuth': true}));
        await tokens.save(r.data['accessToken'] as String, r.data['refreshToken'] as String);
        c.complete(true);
      }
    } catch (_) {
      c.complete(false);
    } finally {
      _refreshing = null;
    }
    return c.future;
  }

  Future<dynamic> get(String path, [Map<String, dynamic>? query]) async {
    try {
      return (await dio.get(path, queryParameters: query)).data;
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  Future<dynamic> post(String path, [Object? body]) async {
    try {
      return (await dio.post(path, data: body ?? {})).data;
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  Future<dynamic> patch(String path, [Object? body]) async {
    try {
      return (await dio.patch(path, data: body ?? {})).data;
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  Future<dynamic> upload(String path, String filePath, {String? filename}) async {
    try {
      final form = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath, filename: filename),
      });
      return (await dio.post(path, data: form)).data;
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  Future<Uint8List?> bytes(String path) async {
    try {
      final r = await dio.get<List<int>>(
        path,
        options: Options(responseType: ResponseType.bytes),
      );
      if (r.data == null) return null;
      return Uint8List.fromList(r.data!);
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) return null;
      throw ApiError.from(e);
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  Future<dynamic> delete(String path, [Object? body]) async {
    try {
      return (await dio.delete(path, data: body ?? {})).data;
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  Future<dynamic> postNoAuth(String path, Object body) async {
    try {
      return (await dio.post(path, data: body, options: Options(extra: {'noAuth': true}))).data;
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  /// Download a file (payslip PDF) to a local path.
  Future<void> download(String path, String savePath) async {
    try {
      await dio.download(path, savePath);
    } catch (e) {
      throw ApiError.from(e);
    }
  }
}
