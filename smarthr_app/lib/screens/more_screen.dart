import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/session.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/creative_background.dart';
import 'approvals_screen.dart';
import 'attendance_history_screen.dart';
import 'change_password_screen.dart';
import 'messages_screen.dart';
import 'overtime_screen.dart';
import 'simple_screens.dart';

class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  void _go(BuildContext context, Widget w) => Navigator.push(context, MaterialPageRoute(builder: (_) => w));

  Future<void> _deleteAccount(BuildContext context) async {
    final ok = await confirm(
      context,
      title: 'Delete my account?',
      body: 'Your employer owns your HR records, so we send this request to your company\'s HR. They will close your login and delete or anonymise your personal data, keeping only what the law requires (for example EPF/ETF and payroll records). You will be signed out now.',
      ok: 'Request deletion',
      danger: true,
    );
    if (!ok || !context.mounted) return;
    final reason = await askText(context, title: 'Anything to add? (optional)', label: 'Reason', ok: 'Send request');
    if (reason == null || !context.mounted) return;
    try {
      final r = asMap(await Api.instance.post('/me/deletion-request', {if (reason.isNotEmpty) 'reason': reason}));
      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Request sent'),
          content: Text('${r['message'] ?? 'Your HR team has your request.'}'),
          actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
        ),
      );
      if (context.mounted) await context.read<Session>().logout();
    } on ApiError catch (e) {
      if (context.mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    final me = s.me!;
    final c = Theme.of(context).colorScheme;
    final emp = me.employee;
    Widget item(IconData icon, String text, VoidCallback onTap, {Color? color}) => ListTile(
          leading: Icon(icon, color: color),
          title: Text(text, style: TextStyle(color: color)),
          trailing: const Icon(Icons.chevron_right),
          onTap: onTap,
        );
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        extendBodyBehindAppBar: true,
        appBar: AppBar(
          title: const Text(
            'Account & Profile',
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w700,
              fontSize: 19,
              letterSpacing: -0.2,
            ),
          ),
          backgroundColor: Colors.transparent,
          systemOverlayStyle: SystemUiOverlayStyle.light,
          iconTheme: const IconThemeData(color: Colors.white),
        ),
        body: CreativeBackground(
          theme: BackgroundTheme.profile,
          child: SafeArea(
            bottom: false,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 160),
              children: [
              // ── Creative Profile Card (Matching Image 2) ──
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
                decoration: BoxDecoration(
                  gradient: Brand.gradient,
                  borderRadius: BorderRadius.circular(28),
                  boxShadow: [
                    BoxShadow(
                      color: Brand.magenta.withValues(alpha: .35),
                      blurRadius: 24,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    Stack(
                      alignment: Alignment.bottomRight,
                      children: [
                        Container(
                          width: 72,
                          height: 72,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: .2),
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white, width: 2.5),
                          ),
                          child: Center(
                            child: Text(
                              initials(me.name),
                              style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w900),
                            ),
                          ),
                        ),
                        Container(
                          width: 18,
                          height: 18,
                          decoration: BoxDecoration(
                            color: Brand.ok,
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white, width: 2),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      me.name,
                      style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      [if (emp?['designation'] != null) emp!['designation'], me.companyName].join(' • '),
                      style: TextStyle(color: Colors.white.withValues(alpha: .85), fontSize: 13),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .2),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        emp?['empNo'] != null ? 'Employee #${emp!['empNo']}' : 'Staff Member',
                        style: const TextStyle(color: Colors.white, fontSize: 11.5, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              const SectionTitle('My work'),
              const SizedBox(height: 8),
              Tile(
                padding: EdgeInsets.zero,
                child: Column(
                  children: [
                    item(Icons.history_rounded, 'Attendance history', () => _go(context, const AttendanceHistoryScreen())),
                    const Divider(height: 1, indent: 56),
                    item(Icons.more_time_rounded, 'My overtime', () => _go(context, const OvertimeScreen())),
                    if (me.has('messaging')) ...[
                      const Divider(height: 1, indent: 56),
                      item(Icons.chat_bubble_outline_rounded, 'Messages', () => _go(context, const MessagesScreen())),
                    ],
                    const Divider(height: 1, indent: 56),
                    item(Icons.campaign_outlined, 'Announcements', () => _go(context, const AnnouncementsScreen())),
                    const Divider(height: 1, indent: 56),
                    item(Icons.notifications_none_rounded, 'Notifications', () => _go(context, const NotificationsScreen())),
                    if (me.has('assets')) ...[
                      const Divider(height: 1, indent: 56),
                      item(Icons.devices_other_rounded, 'My assets', () => _go(context, const AssetsScreen())),
                    ],
                  ],
                ),
              ),
              if (me.approves) ...[
                const SizedBox(height: 16),
                const SectionTitle('Manager'),
                const SizedBox(height: 8),
                Tile(
                  padding: EdgeInsets.zero,
                  child: item(Icons.fact_check_outlined, 'Approvals', () => _go(context, const ApprovalsScreen())),
                ),
              ],
              const SizedBox(height: 16),
              const SectionTitle('Account & Security'),
              const SizedBox(height: 8),
              Tile(
                padding: EdgeInsets.zero,
                child: Column(
                  children: [
                    item(Icons.lock_outline_rounded, 'Change password', () => _go(context, const ChangePasswordScreen())),
                    const Divider(height: 1, indent: 56),
                    item(Icons.privacy_tip_outlined, 'Privacy policy', () => launchUrl(Uri.parse(AppConfig.privacyUrl), mode: LaunchMode.externalApplication)),
                    const Divider(height: 1, indent: 56),
                    item(Icons.mail_outline_rounded, 'Help & support', () => launchUrl(Uri.parse('mailto:${AppConfig.supportEmail}'))),
                    const Divider(height: 1, indent: 56),
                    item(Icons.logout_rounded, 'Sign out', () async {
                      if (await confirm(context, title: 'Sign out?', ok: 'Sign out')) await s.logout();
                    }),
                    const Divider(height: 1, indent: 56),
                    item(Icons.delete_outline_rounded, 'Delete my account', () => _deleteAccount(context), color: c.error),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              Center(
                child: Text(
                  'Smart HR by Lumi AI',
                  style: TextStyle(color: c.onSurfaceVariant, fontSize: 12, fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
}
