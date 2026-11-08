import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/api.dart';
import 'core/push.dart';
import 'core/session.dart';
import 'screens/change_password_screen.dart';
import 'screens/login_screen.dart';
import 'screens/shell.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  Api.instance.init();
  await Push.init();
  runApp(ChangeNotifierProvider(create: (_) => Session()..boot(), child: const SmartHrApp()));
}

class SmartHrApp extends StatelessWidget {
  const SmartHrApp({super.key});
  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    Widget home;
    if (s.state == AuthState.loading) {
      home = const _Splash();
    } else if (s.state == AuthState.signedOut || s.me == null) {
      home = const LoginScreen();
    } else if (s.me!.mustChangePassword) {
      home = const ChangePasswordScreen(firstTime: true);
    } else {
      home = const Shell();
    }
    return MaterialApp(
      title: 'SmartHR',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
      themeMode: ThemeMode.system,
      home: home,
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();
  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Image.asset('assets/mark.png', width: 96),
            const SizedBox(height: 24),
            const CircularProgressIndicator(),
          ]),
        ),
      );
}
