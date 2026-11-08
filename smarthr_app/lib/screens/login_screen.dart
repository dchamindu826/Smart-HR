import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

  @override
  void initState() {
    super.initState();
    if (kDebugMode) {
      _login.text = 'kamal.demo@demo.lumiai.lk';
      _password.text = 'Demo@1234';
    }
  }

  Future<void> _submit() async {
    if (_login.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Enter your email or mobile number and password.');
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
          _error = 'Your login belongs to multiple companies. Please choose yours.';
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
            title: const Text('Reset password'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Enter the email on your Smart HR account. We will email you a password reset link.'),
                const SizedBox(height: 12),
                TextField(
                  controller: email,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(labelText: 'Email'),
                ),
                const SizedBox(height: 10),
                Text(
                  'Sign in with mobile? Ask your company HR to reset your password.',
                  style: TextStyle(fontSize: 12, color: Theme.of(ctx).colorScheme.onSurfaceVariant),
                ),
                if (msg != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(msg!, style: const TextStyle(fontWeight: FontWeight.w600)),
                  ),
              ],
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close')),
              FilledButton(
                onPressed: busy
                    ? null
                    : () async {
                        if (!email.text.contains('@')) {
                          setS(() => msg = 'Enter a valid email address.');
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
    final dark = Theme.of(context).brightness == Brightness.dark;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: dark ? const Color(0xFF080D1A) : const Color(0xFFF3F5F9),
        body: Stack(
          children: [
            // ── Atmospheric Curved Dark Header ──
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              height: 320,
              child: Stack(
                children: [
                  Container(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          Color(0xFF0F172A),
                          Color(0xFF1E1B4B),
                          Color(0xFF0F172A),
                        ],
                      ),
                    ),
                  ),
                  // Glow circles
                  Positioned(
                    top: -40,
                    right: -20,
                    child: Container(
                      width: 220,
                      height: 220,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Brand.magenta.withValues(alpha: 0.28),
                      ),
                    ),
                  ),
                  Positioned(
                    top: 60,
                    left: -40,
                    child: Container(
                      width: 180,
                      height: 180,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Brand.blue.withValues(alpha: 0.22),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // ── Scrollable Content ──
            SafeArea(
              child: Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 420),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const SizedBox(height: 12),

                        // ── App Brand Header ──
                        Center(
                          child: Column(
                            children: [
                              Container(
                                width: 72,
                                height: 72,
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  shape: BoxShape.circle,
                                  boxShadow: [
                                    BoxShadow(
                                      color: Brand.magenta.withValues(alpha: 0.40),
                                      blurRadius: 24,
                                      offset: const Offset(0, 8),
                                    ),
                                  ],
                                ),
                                padding: const EdgeInsets.all(14),
                                child: Image.asset('assets/mark.png'),
                              ),
                              const SizedBox(height: 14),
                              const Text(
                                'Smart HR',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 26,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: -0.5,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'Modern Workplace & Attendance',
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.75),
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ),
                        ),

                        const SizedBox(height: 28),

                        // ── Login Card (Matching Reference Theme) ──
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 26),
                          decoration: BoxDecoration(
                            color: dark ? const Color(0xFF131C31) : Colors.white,
                            borderRadius: BorderRadius.circular(28),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: dark ? 0.4 : 0.08),
                                blurRadius: 28,
                                offset: const Offset(0, 10),
                              ),
                            ],
                            border: Border.all(
                              color: dark ? const Color(0xFF1E293B) : const Color(0x0F000000),
                              width: 1,
                            ),
                          ),
                          child: AutofillGroup(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text(
                                  'Sign In',
                                  style: TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.w800,
                                    color: dark ? Colors.white : Brand.ink,
                                    letterSpacing: -0.3,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'Use the credentials given by your company HR.',
                                  style: TextStyle(
                                    fontSize: 13,
                                    color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted,
                                  ),
                                ),
                                const SizedBox(height: 22),

                                // Login field
                                TextField(
                                  controller: _login,
                                  keyboardType: TextInputType.emailAddress,
                                  autofillHints: const [AutofillHints.username, AutofillHints.email],
                                  textInputAction: TextInputAction.next,
                                  decoration: InputDecoration(
                                    labelText: 'Email or mobile number',
                                    prefixIcon: const Icon(Icons.alternate_email_rounded, size: 20, color: Brand.blue),
                                    fillColor: dark ? const Color(0xFF0E1626) : const Color(0xFFF8FAFC),
                                  ),
                                ),
                                const SizedBox(height: 14),

                                // Password field
                                TextField(
                                  controller: _password,
                                  obscureText: !_show,
                                  autofillHints: const [AutofillHints.password],
                                  onSubmitted: (_) => _submit(),
                                  decoration: InputDecoration(
                                    labelText: 'Password',
                                    prefixIcon: const Icon(Icons.lock_outline_rounded, size: 20, color: Brand.magenta),
                                    fillColor: dark ? const Color(0xFF0E1626) : const Color(0xFFF8FAFC),
                                    suffixIcon: IconButton(
                                      tooltip: _show ? 'Hide password' : 'Show password',
                                      icon: Icon(
                                        _show ? Icons.visibility_off_rounded : Icons.visibility_rounded,
                                        size: 20,
                                        color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted,
                                      ),
                                      onPressed: () => setState(() => _show = !_show),
                                    ),
                                  ),
                                ),

                                if (_companies != null) ...[
                                  const SizedBox(height: 14),
                                  DropdownButtonFormField<String>(
                                    initialValue: _company,
                                    decoration: InputDecoration(
                                      labelText: 'Company',
                                      prefixIcon: const Icon(Icons.business_rounded, size: 20, color: Brand.ok),
                                      fillColor: dark ? const Color(0xFF0E1626) : const Color(0xFFF8FAFC),
                                    ),
                                    items: _companies!
                                        .map((co) => DropdownMenuItem(value: '${co['code']}', child: Text('${co['name']}')))
                                        .toList(),
                                    onChanged: (v) => setState(() => _company = v),
                                  ),
                                ],

                                if (_error != null) ...[
                                  const SizedBox(height: 14),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                    decoration: BoxDecoration(
                                      color: Brand.bad.withValues(alpha: 0.1),
                                      borderRadius: BorderRadius.circular(12),
                                      border: Border.all(color: Brand.bad.withValues(alpha: 0.3)),
                                    ),
                                    child: Row(
                                      children: [
                                        const Icon(Icons.error_outline_rounded, size: 18, color: Brand.bad),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: Text(
                                            _error!,
                                            style: const TextStyle(color: Brand.bad, fontSize: 13, fontWeight: FontWeight.w500),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],

                                const SizedBox(height: 22),

                                // Gradient Sign In Button
                                Container(
                                  height: 52,
                                  decoration: BoxDecoration(
                                    gradient: Brand.gradient,
                                    borderRadius: BorderRadius.circular(16),
                                    boxShadow: [
                                      BoxShadow(
                                        color: Brand.magenta.withValues(alpha: 0.4),
                                        blurRadius: 16,
                                        offset: const Offset(0, 5),
                                      ),
                                    ],
                                  ),
                                  child: FilledButton(
                                    style: FilledButton.styleFrom(
                                      backgroundColor: Colors.transparent,
                                      shadowColor: Colors.transparent,
                                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                                    ),
                                    onPressed: _busy ? null : _submit,
                                    child: _busy
                                        ? const SizedBox(
                                            width: 22,
                                            height: 22,
                                            child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                                          )
                                        : const Row(
                                            mainAxisAlignment: MainAxisAlignment.center,
                                            children: [
                                              Text(
                                                'Sign in',
                                                style: TextStyle(
                                                  fontSize: 16,
                                                  fontWeight: FontWeight.w700,
                                                  color: Colors.white,
                                                ),
                                              ),
                                              SizedBox(width: 8),
                                              Icon(Icons.arrow_forward_rounded, size: 18, color: Colors.white),
                                            ],
                                          ),
                                  ),
                                ),

                                const SizedBox(height: 16),

                                Center(
                                  child: TextButton(
                                    onPressed: _forgot,
                                    child: Text(
                                      'Forgot password?',
                                      style: TextStyle(
                                        color: dark ? const Color(0xFF60A5FA) : Brand.blue,
                                        fontWeight: FontWeight.w600,
                                        fontSize: 13.5,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),

                        const SizedBox(height: 20),

                        // Privacy policy link
                        Center(
                          child: TextButton(
                            onPressed: () => launchUrl(Uri.parse(AppConfig.privacyUrl)),
                            child: Text(
                              'Privacy policy',
                              style: TextStyle(
                                color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted,
                                fontSize: 13,
                              ),
                            ),
                          ),
                        ),

                        const SizedBox(height: 12),

                        // Footer badge
                        Center(
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.shield_outlined, size: 14, color: dark ? const Color(0xFF64748B) : Brand.inkLight),
                              const SizedBox(width: 6),
                              Text(
                                'Secured by Lumi AI · Multi-tenant Platform',
                                style: TextStyle(
                                  fontSize: 11.5,
                                  color: dark ? const Color(0xFF64748B) : Brand.inkLight,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
