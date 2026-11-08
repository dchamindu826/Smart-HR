# SmartHR mobile app (Flutter)

The employee app: mark in/out (office or remote, GPS), roster, leave, payslips (PDF),
overtime reasons, attendance history and corrections, announcements, notifications,
assets, manager approvals, change password, **delete my account**.

It talks to the same backend as the web console: `https://<your-domain>/api/v1`.

## 1. Put this code into your existing Flutter project

Keep your existing `ios/` and `android/` folders. They hold the bundle id, the app icon
and the signing that App Store Connect already knows (build 15).

1. Replace `lib/`, `test/`, `assets/`, `pubspec.yaml` and `analysis_options.yaml` with the ones here.
2. In `pubspec.yaml`, if your project's `name:` is not `smarthr_app`, change the name here to
   match **or** change `import 'package:smarthr_app/...'` in `test/format_test.dart`.
3. `flutter pub get`

`version: 1.0.2+17` — the build number must be higher than any build already uploaded.

## 2. Permissions

**iOS — `ios/Runner/Info.plist`** (inside `<dict>`):

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>SmartHR records your location only when you press Mark in or Mark out, so your employer can confirm you are at the office or at your approved remote location.</string>
<key>LSApplicationQueriesSchemes</key>
<array><string>mailto</string><string>https</string></array>
```

Do **not** add "Always" location keys or background location — the app does not use them,
and Apple rejects apps that ask for more than they use.

**Android — `android/app/src/main/AndroidManifest.xml`** (above `<application>`):

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
<queries>
  <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="https"/></intent>
  <intent><action android:name="android.intent.action.SENDTO"/><data android:scheme="mailto"/></intent>
</queries>
```

`open_filex` (payslip PDF) needs no extra permission because the file is in the app's temp folder.

Needs **Flutter 3.27 or newer** (`flutter --version`; `flutter upgrade` if older).

## Push notifications (Firebase)

Staff have no web access, so push is how they hear that leave was approved, a roster
was published, a payslip is ready, or someone sent a message. The server already sends them;
the app needs Firebase:

1. https://console.firebase.google.com → create a project → add an **Android** app
   (your package name) and an **iOS** app (your bundle id).
2. Download `google-services.json` → `android/app/`, and `GoogleService-Info.plist` →
   `ios/Runner/` (add it in Xcode so it is in the Runner target).
3. Android: follow the Firebase steps to add the `com.google.gms.google-services` Gradle plugin.
4. iOS: Xcode → Runner → Signing & Capabilities → add **Push Notifications** and
   **Background Modes → Remote notifications**. In Firebase → Project settings → Cloud Messaging,
   upload your APNs key (.p8 from developer.apple.com → Keys).
5. Server: Firebase → Project settings → Service accounts → Generate new private key.
   Copy the JSON to the VPS (e.g. `/root/smarthr/fcm.json`), set
   `FCM_SERVICE_ACCOUNT_FILE=/root/smarthr/fcm.json` in `backend/.env`, then `pm2 restart all`.

Without these files the app still runs; it just doesn't get push.

## 3. Run and build

```bash
# Android emulator → backend on your PC
flutter run --dart-define=API_BASE=http://10.0.2.2:4000

# real phone on the same Wi-Fi → your PC's IP
flutter run --dart-define=API_BASE=http://192.168.1.20:4000

# store builds → the production server (HTTPS only)
flutter build ipa       --release --dart-define=API_BASE=https://hr.yourdomain.lk
flutter build appbundle --release --dart-define=API_BASE=https://hr.yourdomain.lk
```

Then set your real domain in `lib/config.dart` as the default too, so a build without
`--dart-define` never points at a placeholder.

iOS blocks plain `http://` by default; that is fine because production is HTTPS.
For local testing on an iPhone, use the Android emulator or a tunnel with HTTPS.

## 4. Tests

```bash
flutter analyze
flutter test
```

## Where things are

| Path | What |
|---|---|
| `lib/config.dart` | API base URL, support email, privacy URL |
| `lib/core/api.dart` | Dio client, Bearer token, refresh once on 401 |
| `lib/core/session.dart` | who is signed in (`/me`), permissions, features |
| `lib/core/punch_queue.dart` | offline punches, synced to `/attendance/sync` |
| `lib/core/location.dart` | GPS fix, mock-location flag |
| `lib/screens/home_screen.dart` | Today: mark in/out |
| `lib/screens/more_screen.dart` | profile, menu, sign out, delete account |
