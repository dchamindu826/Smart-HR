import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _login = TextEditingController();
  final _password = TextEditingController();
  List<Map<String, dynamic>>? _companies;
  String? _company;
  String? _error;
  bool _busy = false;
  bool _show = false;

  Future<void> _submit() async {
    if (_login.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Enter your email or mobile number and your password.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final list = await context.read<Session>().login(_login.text, _password.text, company: _company);
      if (list != null && mounted) {
        setState(() {
          _companies = list;
          _company = list.isNotEmpty ? '${list.first['code']}' : null;
          _error = 'Your login is in more than one company. Choose yours.';
        });
      }
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _forgot() async {
    final email = TextEditingController(text: _login.text.contains('@') ? _login.text.trim() : '');
    final session = context.read<Session>();
    await showDialog<void>(
      context: context,
      builder: (ctx) {
        String? msg;
        bool busy = false;
        return StatefulBuilder(
          builder: (ctx, setS) => AlertDialog(
            title: const Text('Reset your password'),
            content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Enter the email on your SmartHR account. We will email you a link to set a new password.'),
              const SizedBox(height: 12),
              TextField(controller: email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email')),
              const SizedBox(height: 10),
              Text('Sign in with a mobile number? Ask your HR to reset your password.', style: TextStyle(fontSize: 12, color: Theme.of(ctx).colorScheme.onSurfaceVariant)),
              if (msg != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(msg!, style: const TextStyle(fontWeight: FontWeight.w600))),
            ]),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close')),
              FilledButton(
                onPressed: busy
                    ? null
                    : () async {
                        if (!email.text.contains('@')) {
                          setS(() => msg = 'Enter a valid email.');
                          return;
                        }
                        setS(() => busy = true);
                        try {
                          final m = await session.forgotPassword(email.text, company: _company);
                          setS(() => msg = m);
                        } on ApiError catch (e) {
                          setS(() => msg = e.message);
                        } finally {
                          setS(() => busy = false);
                        }
                      },
                child: const Text('Send link'),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Image.asset('assets/logo.png', height: 84, alignment: Alignment.centerLeft),
                  const SizedBox(height: 28),
                  Text('Log in', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  Text('Use the login your company HR gave you.', style: TextStyle(color: c.onSurfaceVariant)),
                  const SizedBox(height: 22),
                  TextField(
                    controller: _login,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.username, AutofillHints.email],
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(labelText: 'Email or mobile number', prefixIcon: Icon(Icons.person_outline)),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _password,
                    obscureText: !_show,
                    autofillHints: const [AutofillHints.password],
                    onSubmitted: (_) => _submit(),
                    decoration: InputDecoration(
                      labelText: 'Password',
                      prefixIcon: const Icon(Icons.lock_outline),
                      suffixIcon: IconButton(
                        tooltip: _show ? 'Hide password' : 'Show password',
                        icon: Icon(_show ? Icons.visibility_off_outlined : Icons.visibility_outlined),
                        onPressed: () => setState(() => _show = !_show),
                      ),
                    ),
                  ),
                  if (_companies != null) ...[
                    const SizedBox(height: 14),
                    DropdownButtonFormField<String>(
                      initialValue: _company,
                      decoration: const InputDecoration(labelText: 'Company'),
                      items: _companies!.map((co) => DropdownMenuItem(value: '${co['code']}', child: Text('${co['name']}'))).toList(),
                      onChanged: (v) => setState(() => _company = v),
                    ),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 14),
                    Text(_error!, style: TextStyle(color: c.error)),
                  ],
                  const SizedBox(height: 22),
                  DecoratedBox(
                    decoration: BoxDecoration(gradient: Brand.gradient, borderRadius: BorderRadius.circular(14)),
                    child: FilledButton(
                      style: FilledButton.styleFrom(backgroundColor: Colors.transparent, shadowColor: Colors.transparent),
                      onPressed: _busy ? null : _submit,
                      child: _busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white)) : const Text('Log in', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                    ),
                  ),
                  const SizedBox(height: 18),
                  TextButton(onPressed: _forgot, child: const Text('Forgot password?')),
                  TextButton(onPressed: () => launchUrl(Uri.parse(AppConfig.privacyUrl)), child: const Text('Privacy policy')),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
