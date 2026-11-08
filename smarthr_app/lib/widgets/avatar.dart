import 'dart:typed_data';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../theme.dart';

class PhotoCache {
  static final Map<String, Future<Uint8List?>> _cache = {};
  static final ValueNotifier<int> version = ValueNotifier<int>(0);

  static Future<Uint8List?> get(String path) {
    return _cache.putIfAbsent(
      path,
      () => Api.instance.bytes(path).catchError((_) => null),
    );
  }

  static void bump([String? path]) {
    if (path != null) {
      _cache.remove(path);
    } else {
      _cache.clear();
    }
    version.value++;
  }
}

class PersonAvatar extends StatelessWidget {
  final String name;
  final String? photoPath;
  final double size;
  final Color? ring;

  const PersonAvatar({
    super.key,
    required this.name,
    this.photoPath,
    this.size = 44,
    this.ring,
  });

  String get _initials {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts[0].isEmpty) return '?';
    if (parts.length == 1) return parts[0].substring(0, 1).toUpperCase();
    return (parts[0].substring(0, 1) + parts[parts.length - 1].substring(0, 1)).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final border = ring != null
        ? Border.all(color: ring!, width: size > 60 ? 3 : 2)
        : null;

    Widget fallback() => Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: Brand.gradient,
            border: border,
          ),
          alignment: Alignment.center,
          child: Text(
            _initials,
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
              fontSize: size * 0.38,
            ),
          ),
        );

    if (photoPath == null || photoPath!.isEmpty) {
      return fallback();
    }

    return ValueListenableBuilder<int>(
      valueListenable: PhotoCache.version,
      builder: (context, _, __) {
        return FutureBuilder<Uint8List?>(
          future: PhotoCache.get(photoPath!),
          builder: (context, snapshot) {
            final bytes = snapshot.data;
            if (bytes != null && bytes.isNotEmpty) {
              return Container(
                width: size,
                height: size,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: border,
                ),
                child: ClipOval(
                  child: Image.memory(
                    bytes,
                    width: size,
                    height: size,
                    fit: BoxFit.cover,
                  ),
                ),
              );
            }
            return fallback();
          },
        );
      },
    );
  }
}

