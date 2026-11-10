import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'dart:async';
import '../core/live.dart';
import '../core/session.dart';
import '../widgets/common.dart';
import '../theme.dart';
import 'home_screen.dart';
import 'leave_screen.dart';
import 'more_screen.dart';
import 'payslips_screen.dart';
import 'roster_screen.dart';

/// Bottom navigation: Today, Roster, Leave, Payslips, More with a modern floating dock.
class Shell extends StatefulWidget {
  const Shell({super.key});
  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> with WidgetsBindingObserver {
  int _i = 0;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _checkBadges(first: true);
    _poll = Timer.periodic(const Duration(seconds: 30), (_) => _checkBadges());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s != AppLifecycleState.resumed) return;
    // HR may have changed settings, the roster or my profile while the app was closed.
    context.read<Session>().reloadMe().catchError((_) {});
    Live.resumed.value++;
    _checkBadges();
  }

  /// Polls unread counts; tells the user when something new arrives while the app is open.
  Future<void> _checkBadges({bool first = false}) async {
    final before = Live.badges.value;
    final now = await Live.refreshBadges();
    if (first || !mounted) return;
    if (now.messages > before.messages) {
      toast(context, 'New message. Open More → Messages.');
    } else if (now.announcements > before.announcements) {
      toast(context, 'New announcement. Open More → Announcements.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = context.watch<Session>().me!;
    final pages = <Widget>[
      const HomeScreen(),
      if (me.has('roster')) const RosterScreen(),
      const LeaveScreen(),
      const PayslipsScreen(),
      const MoreScreen(),
    ];

    final tabs = <({IconData icon, String label})>[
      (icon: Icons.fingerprint_rounded, label: 'Today'),
      if (me.has('roster')) (icon: Icons.calendar_view_week_rounded, label: 'Roster'),
      (icon: Icons.beach_access_rounded, label: 'Leave'),
      (icon: Icons.receipt_long_rounded, label: 'Payslips'),
      (icon: Icons.grid_view_rounded, label: 'More'),
    ];

    final i = _i.clamp(0, pages.length - 1);
    final dark = Theme.of(context).brightness == Brightness.dark;

    // More screen (index 4) has a dark curved header -> light status icons.
    // Other screens (Today, Roster, Leave, Payslips) have white/light backgrounds -> dark status icons.
    final isMoreTab = tabs[i].label == 'More';
    final overlayStyle = dark
        ? SystemUiOverlayStyle.light
        : (isMoreTab
            ? SystemUiOverlayStyle.light
            : const SystemUiOverlayStyle(
                statusBarColor: Colors.transparent,
                statusBarBrightness: Brightness.light,
                statusBarIconBrightness: Brightness.dark,
              ));

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: overlayStyle,
      child: Scaffold(
        extendBody: true,
        body: IndexedStack(index: i, children: pages),
        bottomNavigationBar: SafeArea(
          top: false,
          bottom: true,
          minimum: const EdgeInsets.only(bottom: 10),
          child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 16),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          decoration: BoxDecoration(
            color: const Color(0xFF0F172A),
            borderRadius: BorderRadius.circular(32),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.22),
                blurRadius: 28,
                offset: const Offset(0, 10),
              ),
            ],
            border: Border.all(color: Colors.white.withValues(alpha: 0.08), width: 1),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: List.generate(tabs.length, (idx) {
              final active = idx == i;
              final tab = tabs[idx];
              return GestureDetector(
                onTap: () {
                  setState(() => _i = idx);
                  Live.tab.value = tab.label;
                  if (tab.label == 'More') _checkBadges(first: true);
                },
                behavior: HitTestBehavior.opaque,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 240),
                  curve: Curves.easeOutCubic,
                  padding: EdgeInsets.symmetric(
                    horizontal: active ? 16 : 10,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    gradient: active ? Brand.gradient : null,
                    borderRadius: BorderRadius.circular(24),
                    boxShadow: active
                        ? [
                            BoxShadow(
                              color: Brand.magenta.withValues(alpha: 0.4),
                              blurRadius: 14,
                              offset: const Offset(0, 4),
                            ),
                          ]
                        : null,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ValueListenableBuilder<Badges>(
                        valueListenable: Live.badges,
                        builder: (context, b, child) => Badge(
                          isLabelVisible: tab.label == 'More' && b.total > 0,
                          label: Text(b.total > 99 ? '99+' : '${b.total}'),
                          backgroundColor: Brand.magenta,
                          child: child,
                        ),
                        child: Icon(
                          tab.icon,
                          size: 22,
                          color: active ? Colors.white : const Color(0xFF94A3B8),
                        ),
                      ),
                      if (active) ...[
                        const SizedBox(width: 6),
                        Text(
                          tab.label,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            letterSpacing: -.01,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    ),
  );
  }
}
