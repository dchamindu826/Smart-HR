import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/session.dart';
import '../theme.dart';
import '../widgets/common.dart';
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
    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 115), children: [
        Tile(
          glow: Brand.gradient,
          child: Row(children: [
            CircleAvatar(radius: 26, backgroundColor: Colors.white24, child: Text(initials(me.name), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800))),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(me.name, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
                Text([if (emp?['designation'] != null) emp!['designation'], me.companyName].join(' · '), style: const TextStyle(color: Colors.white)),
                if (emp?['empNo'] != null) Text('No. ${emp!['empNo']}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
              ]),
            ),
          ]),
        ),
        const SectionTitle('My work'),
        Tile(
          padding: EdgeInsets.zero,
          child: Column(children: [
            item(Icons.history, 'Attendance history', () => _go(context, const AttendanceHistoryScreen())),
            item(Icons.more_time, 'My overtime', () => _go(context, const OvertimeScreen())),
            if (me.has('messaging')) item(Icons.chat_bubble_outline, 'Messages', () => _go(context, const MessagesScreen())),
            item(Icons.campaign_outlined, 'Announcements', () => _go(context, const AnnouncementsScreen())),
            item(Icons.notifications_none, 'Notifications', () => _go(context, const NotificationsScreen())),
            if (me.has('assets')) item(Icons.devices_other_outlined, 'My assets', () => _go(context, const AssetsScreen())),
          ]),
        ),
        if (me.approves) ...[
          const SectionTitle('Manager'),
          Tile(padding: EdgeInsets.zero, child: item(Icons.fact_check_outlined, 'Approvals', () => _go(context, const ApprovalsScreen()))),
        ],
        const SectionTitle('Account'),
        Tile(
          padding: EdgeInsets.zero,
          child: Column(children: [
            item(Icons.lock_outline, 'Change password', () => _go(context, const ChangePasswordScreen())),
            item(Icons.privacy_tip_outlined, 'Privacy policy', () => launchUrl(Uri.parse(AppConfig.privacyUrl), mode: LaunchMode.externalApplication)),
            item(Icons.mail_outline, 'Help & support', () => launchUrl(Uri.parse('mailto:${AppConfig.supportEmail}'))),
            item(Icons.logout, 'Sign out', () async {
              if (await confirm(context, title: 'Sign out?', ok: 'Sign out')) await s.logout();
            }),
            item(Icons.delete_outline, 'Delete my account', () => _deleteAccount(context), color: c.error),
          ]),
        ),
        const SizedBox(height: 16),
        Center(child: Text('SmartHR by Lumi AI', style: TextStyle(color: c.onSurfaceVariant, fontSize: 12))),
      ]),
    );
  }
}
