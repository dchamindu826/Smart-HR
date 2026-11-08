import 'package:geolocator/geolocator.dart';

class Fix {
  final double lat;
  final double lng;
  final double accuracy;
  final bool mocked;
  Fix(this.lat, this.lng, this.accuracy, this.mocked);
}

class LocationError implements Exception {
  final String message;
  final bool openSettings;
  LocationError(this.message, {this.openSettings = false});
  @override
  String toString() => message;
}

/// Location is read only at the moment of marking in or out. No background tracking.
class LocationService {
  static Future<Fix> current() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw LocationError('Location is turned off. Turn it on to mark attendance.', openSettings: true);
    }
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    if (p == LocationPermission.denied) throw LocationError('SmartHR needs your location to mark attendance.');
    if (p == LocationPermission.deniedForever) {
      throw LocationError('Location permission is blocked. Allow it for SmartHR in Settings.', openSettings: true);
    }
    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 12)),
      );
      return Fix(pos.latitude, pos.longitude, pos.accuracy, pos.isMocked);
    } catch (_) {
      final last = await Geolocator.getLastKnownPosition();
      if (last != null) {
        return Fix(last.latitude, last.longitude, last.accuracy, last.isMocked);
      }
      rethrow;
    }
  }

  static Future<void> openSettings() => Geolocator.openAppSettings();
}
