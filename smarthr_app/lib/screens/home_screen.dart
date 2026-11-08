import 'dart:async';
import 'dart:math' as math;
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/location.dart';
import '../core/punch_queue.dart';
import '../core/session.dart';
import '../theme.dart';
import '../widgets/avatar.dart';
import '../widgets/common.dart';
import '../widgets/creative_background.dart';
import 'birthdays_screen.dart';
import 'overtime_screen.dart';
import 'punch_confirm_modal.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  Map<String, dynamic>? _today;
  String? _error;
  bool _busy = false;
  int _pending = 0;
  String _mode = 'OFFICE';
  Timer? _timer;
  StreamSubscription<List<ConnectivityResult>>? _net;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    _timer = Timer.periodic(const Duration(seconds: 60), (_) => _load(quiet: true));
    _net = Connectivity().onConnectivityChanged.listen((r) {
      if (!r.contains(ConnectivityResult.none)) _sync();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _net?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) _load(quiet: true);
  }

  Future<void> _load({bool quiet = false}) async {
    await _sync();
    try {
      final t = asMap(await Api.instance.get('/attendance/today'));
      if (!mounted) return;
      setState(() {
        _today = t;
        _error = null;
        final open = t['openSession'];
        if (open is Map) _mode = '${open['mode']}';
      });
    } on ApiError catch (e) {
      if (mounted && !quiet) setState(() => _error = e.message);
    }
    final p = (await PunchQueue.pending()).length;
    if (mounted) setState(() => _pending = p);
  }

  Future<void> _sync() async {
    try {
      final r = await PunchQueue.flush();
      if (!mounted) return;
      if (r.today != null) setState(() => _today = r.today);
      for (final reason in r.rejected) {
        toast(context, 'A saved punch was refused: $reason', error: true);
      }
      final p = (await PunchQueue.pending()).length;
      if (mounted) setState(() => _pending = p);
    } catch (_) {}
  }

  /// Opens the Confirmation Modal before Mark-in or Mark-out.
  Future<void> _requestPunch(String kind, Me me) async {
    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => PunchConfirmModal(
        kind: kind,
        me: me,
        initialMode: kind == 'OUT' ? '${(_today?['openSession'] as Map?)?['mode'] ?? _mode}' : _mode,
        openSession: _today?['openSession'] as Map<String, dynamic>?,
        totals: _today?['totals'] as Map<String, dynamic>?,
      ),
    );

    if (result == null || result['confirmed'] != true) return;

    final mode = (result['mode'] as String?) ?? _mode;
    final fix = result['fix'] as Fix?;
    final faceVerified = result['faceVerified'] as bool?;

    await _executePunch(kind: kind, mode: mode, fix: fix, faceVerified: faceVerified);
  }

  Future<void> _executePunch({
    required String kind,
    required String mode,
    Fix? fix,
    bool? faceVerified,
  }) async {
    setState(() => _busy = true);
    final p = PunchQueue.build(
      kind: kind,
      mode: mode,
      lat: fix?.lat,
      lng: fix?.lng,
      accuracy: fix?.accuracy,
      mocked: fix?.mocked ?? false,
      faceVerified: faceVerified,
      faceScore: null,
    );

    try {
      final r = asMap(await Api.instance.post('/attendance/punch', p));
      if (!mounted) return;
      setState(() => _today = asMap(r['today']));
      toast(
        context,
        kind == 'IN'
            ? 'Marked in successfully at ${time(p['occurredAt'])}'
            : 'Marked out successfully at ${time(p['occurredAt'])}',
      );
    } on ApiError catch (e) {
      if (e.status == 0) {
        await PunchQueue.add(p);
        if (!mounted) return;
        setState(() => _pending++);
        toast(
          context,
          'No internet. Your ${kind == 'IN' ? 'mark-in' : 'mark-out'} is saved and will be sent automatically.',
        );
      } else if (mounted) {
        toast(context, e.message, error: true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = context.watch<Session>().me!;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final t = _today;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: dark
          ? SystemUiOverlayStyle.light
          : const SystemUiOverlayStyle(
              statusBarColor: Colors.transparent,
              statusBarBrightness: Brightness.light,
              statusBarIconBrightness: Brightness.dark,
            ),
      child: Scaffold(
        body: CreativeBackground(
          theme: BackgroundTheme.home,
          child: SafeArea(
            bottom: false,
            child: RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(18, 12, 18, 160),
                children: [
                  _buildHeader(context, me),
                  const SizedBox(height: 16),
                  const BirthdayTodayBanner(),
                  if (_error != null && t == null) ErrorState(message: _error!, onRetry: _load),
                  if (t == null && _error == null)
                    const Padding(
                      padding: EdgeInsets.all(60),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                  if (t != null) ..._content(context, me, t),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context, Me me) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final dept = (me.employee?['department'] as Map?)?['name'] as String?;

    return Row(
      children: [
        if (me.hasPhoto)
          ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: PersonAvatar(
              name: me.name,
              photoPath: '/me/photo',
              size: 50,
            ),
          )
        else
          Container(
            width: 50,
            height: 50,
            decoration: BoxDecoration(
              gradient: Brand.gradient,
              borderRadius: BorderRadius.circular(18),
              boxShadow: [
                BoxShadow(
                  color: Brand.magenta.withValues(alpha: 0.35),
                  blurRadius: 14,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Center(
              child: Text(
                me.name.isNotEmpty ? me.name[0] : 'S',
                style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800),
              ),
            ),
          ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Hi, ${me.name.split(' ').first} 👋',
                style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w800, letterSpacing: -.02),
              ),
              const SizedBox(height: 2),
              Row(
                children: [
                  Flexible(
                    child: Text(
                      me.companyName,
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w500,
                        color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (dept != null) ...[
                    Text(' • ', style: TextStyle(color: dark ? const Color(0xFF64748B) : Brand.inkLight)),
                    Flexible(
                      child: Text(
                        dept,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: dark ? const Color(0xFF38BDF8) : Brand.blue,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: dark ? const Color(0xFF162035) : Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: dark ? const Color(0xFF1E293B) : const Color(0x0F000000)),
          ),
          child: IconButton(
            onPressed: () => _load(),
            icon: const Icon(Icons.refresh_rounded, size: 22),
            color: dark ? Colors.white70 : Brand.inkMuted,
            tooltip: 'Refresh',
          ),
        ),
      ],
    );
  }

  List<Widget> _content(BuildContext context, Me me, Map<String, dynamic> t) {
    final dark = Theme.of(context).brightness == Brightness.dark;
        final isIn = t['state'] == 'IN';
    final totals = asMap(t['totals']);
    final paid = (totals['paidMinutes'] as num?) ?? 0;
    final normal = (t['normalDayMinutes'] as num?) ?? 480;
    final roster = t['roster'] == null ? null : asMap(t['roster']);
    final holiday = t['holiday'] == null ? null : asMap(t['holiday']);
    final leave = t['leave'] == null ? null : asMap(t['leave']);
    final sessions = asList(t['sessions']);
    final open = t['openSession'] == null ? null : asMap(t['openSession']);
    final needsReason = (t['needsReason'] as num?) ?? 0;

    return [
      Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            day(t['date'] as String?, year: true),
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: (isIn ? Brand.ok : (dark ? Colors.white12 : Colors.black.withValues(alpha: 0.06))).withValues(alpha: isIn ? 0.14 : 0.08),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 7,
                  height: 7,
                  decoration: BoxDecoration(
                    color: isIn ? Brand.ok : (dark ? const Color(0xFF94A3B8) : Brand.inkLight),
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  isIn ? 'Active Session' : 'Shift Inactive',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: isIn ? Brand.ok : (dark ? const Color(0xFF94A3B8) : Brand.inkMuted),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      const SizedBox(height: 12),

      if (_pending > 0)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Tile(
            child: Row(
              children: [
                const Icon(Icons.cloud_upload_rounded, color: Brand.warn, size: 22),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    '$_pending punch${_pending == 1 ? '' : 'es'} waiting to sync',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                TextButton(onPressed: _sync, child: const Text('Send now')),
              ],
            ),
          ),
        ),

      if (holiday != null)
        _banner(
          context,
          Icons.celebration_rounded,
          '${holiday['name']} — Holiday Pay ${holiday['multiplier']}×',
          Brand.magenta,
        ),
      if (leave != null)
        _banner(
          context,
          Icons.beach_access_rounded,
          'On leave: ${leave['type']}${leave['halfDay'] != null ? ' (${leave['halfDay']})' : ''}',
          Brand.magenta,
        ),
      if (needsReason > 0)
        _banner(
          context,
          Icons.more_time_rounded,
          'You have $needsReason overtime claim${needsReason == 1 ? '' : 's'} waiting for reason',
          Brand.warn,
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const OvertimeScreen())),
        ),

      // ── Main Attendance Dial Bento Card ──
      Tile(
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 24),
        child: Column(
          children: [
            // Status & Time since row
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 9,
                  height: 9,
                  decoration: BoxDecoration(
                    color: isIn ? Brand.ok : (dark ? Colors.white30 : Brand.inkLight),
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  isIn
                      ? 'Marked in${open != null ? ' at ${time(open['startAt'])}' : ''}${open?['mode'] == 'REMOTE' ? ' (Remote)' : ''}'
                      : 'Not marked in yet',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 14.5,
                    color: isIn ? Brand.ok : (dark ? Colors.white70 : Brand.inkMuted),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),

            // The Dial Gauge
            _Dial(paid: paid.toDouble(), normal: normal.toDouble()),
            const SizedBox(height: 12),

            // Roster or rest day notice
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(
                color: dark ? Colors.white.withValues(alpha: 0.05) : const Color(0xFFF1F5F9),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Text(
                roster == null
                    ? 'No roster for today'
                    : (roster['isOff'] == true || asList(roster['segments']).isEmpty)
                        ? 'Rest day'
                        : 'Roster: ${asList(roster['segments']).map((s) => '${hhmm(s['start'] as num)}–${hhmm(s['end'] as num)}').join(', ')}',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted,
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Policy Indicators (Location / Face requirement badges set by HR)
            Wrap(
              spacing: 8,
              runSpacing: 6,
              alignment: WrapAlignment.center,
              children: [
                _policyChip(
                  icon: Icons.location_on_rounded,
                  label: me.requireLocation
                      ? 'GPS Required'
                      : (_mode == 'REMOTE' ? 'GPS Required (Remote)' : 'GPS Optional (Office)'),
                  active: me.requireLocation || _mode == 'REMOTE',
                  dark: dark,
                ),
                _policyChip(
                  icon: Icons.face_rounded,
                  label: me.requireFace ? 'Face Verification On' : 'Face Check Off',
                  active: me.requireFace,
                  dark: dark,
                ),
              ],
            ),
            const SizedBox(height: 18),

            // Mode Selector (if not marked in and remote allowed)
            if (!isIn && me.allowRemote)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Container(
                  padding: const EdgeInsets.all(4),
                  decoration: BoxDecoration(
                    color: dark ? const Color(0xFF0F172A) : const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: GestureDetector(
                          onTap: () => setState(() => _mode = 'OFFICE'),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            decoration: BoxDecoration(
                              color: _mode == 'OFFICE' ? Colors.white : Colors.transparent,
                              borderRadius: BorderRadius.circular(12),
                              boxShadow: _mode == 'OFFICE'
                                  ? [
                                      BoxShadow(
                                        color: Colors.black.withValues(alpha: 0.08),
                                        blurRadius: 8,
                                        offset: const Offset(0, 2),
                                      ),
                                    ]
                                  : null,
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.apartment_rounded, size: 18, color: _mode == 'OFFICE' ? Brand.blue : Brand.inkMuted),
                                const SizedBox(width: 6),
                                Text(
                                  'Office',
                                  style: TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 13.5,
                                    color: _mode == 'OFFICE' ? Brand.navy : Brand.inkMuted,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      Expanded(
                        child: GestureDetector(
                          onTap: () => setState(() => _mode = 'REMOTE'),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            decoration: BoxDecoration(
                              color: _mode == 'REMOTE' ? Colors.white : Colors.transparent,
                              borderRadius: BorderRadius.circular(12),
                              boxShadow: _mode == 'REMOTE'
                                  ? [
                                      BoxShadow(
                                        color: Colors.black.withValues(alpha: 0.08),
                                        blurRadius: 8,
                                        offset: const Offset(0, 2),
                                      ),
                                    ]
                                  : null,
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.home_work_rounded, size: 18, color: _mode == 'REMOTE' ? Brand.magenta : Brand.inkMuted),
                                const SizedBox(width: 6),
                                Text(
                                  'Remote',
                                  style: TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 13.5,
                                    color: _mode == 'REMOTE' ? Brand.magenta : Brand.inkMuted,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

            // ── The Big Punch Action Button ──
            SizedBox(
              width: double.infinity,
              height: 58,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: isIn ? Brand.coralGradient : Brand.gradient,
                  borderRadius: BorderRadius.circular(18),
                  boxShadow: [
                    BoxShadow(
                      color: (isIn ? Brand.coral : Brand.magenta).withValues(alpha: 0.4),
                      blurRadius: 20,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.transparent,
                    shadowColor: Colors.transparent,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                  ),
                  onPressed: _busy ? null : () => _requestPunch(isIn ? 'OUT' : 'IN', me),
                  icon: _busy
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                        )
                      : Icon(isIn ? Icons.logout_rounded : Icons.login_rounded, color: Colors.white, size: 22),
                  label: Text(
                    isIn ? 'Mark out' : 'Mark in',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Colors.white, letterSpacing: -.01),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'Confirms location & face policy before marking attendance.',
              style: TextStyle(fontSize: 11.5, color: dark ? const Color(0xFF64748B) : Brand.inkLight),
            ),
          ],
        ),
      ),

      const SizedBox(height: 16),

      // ── Quick Stat Bento Cards ──
      Row(
        children: [
          Expanded(child: _stat(context, 'Worked', dur(totals['workedMinutes'] as num?), Icons.access_time_filled_rounded, Brand.blue)),
          const SizedBox(width: 12),
          Expanded(child: _stat(context, 'Paid', dur(paid), Icons.payments_rounded, Brand.ok)),
          const SizedBox(width: 12),
          Expanded(child: _stat(context, 'Meal', dur(totals['mealMinutes'] as num?), Icons.restaurant_rounded, Brand.warn)),
        ],
      ),

      const SizedBox(height: 20),
      const SectionTitle('Today\'s sessions'),
      const SizedBox(height: 8),

      if (sessions.isEmpty)
        Tile(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'No sessions recorded today yet.',
                style: TextStyle(color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted, fontSize: 13.5),
              ),
            ),
          ),
        )
      else
        Tile(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              for (int idx = 0; idx < sessions.length; idx++) ...[
                if (idx > 0) const Divider(height: 1, indent: 64),
                ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  leading: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: (sessions[idx]['mode'] == 'REMOTE' ? Brand.magenta : Brand.blue).withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(
                      sessions[idx]['mode'] == 'REMOTE' ? Icons.home_work_rounded : Icons.apartment_rounded,
                      color: sessions[idx]['mode'] == 'REMOTE' ? Brand.magenta : Brand.blue,
                      size: 20,
                    ),
                  ),
                  title: Text(
                    '${time(sessions[idx]['startAt'])} – ${sessions[idx]['endAt'] == null ? 'Now' : time(sessions[idx]['endAt'])}',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5),
                  ),
                  subtitle: Text(
                    [
                      sessions[idx]['mode'] == 'REMOTE' ? 'Remote' : 'Office',
                      if (sessions[idx]['branch'] is Map) '${(sessions[idx]['branch'] as Map)['name']}',
                    ].join(' • '),
                    style: TextStyle(fontSize: 12, color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted),
                  ),
                  trailing: sessions[idx]['endAt'] == null
                      ? const StatusPill('IN', text: 'Active')
                      : Text(
                          dur(sessions[idx]['minutes'] as num?),
                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5),
                        ),
                ),
              ],
            ],
          ),
        ),
    ];
  }

  Widget _policyChip({required IconData icon, required String label, required bool active, required bool dark}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: active
            ? (dark ? Brand.blue.withValues(alpha: 0.15) : const Color(0xFFEBF5FF))
            : (dark ? Colors.white.withValues(alpha: 0.04) : const Color(0xFFF1F5F9)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: active ? Brand.blue : (dark ? const Color(0xFF64748B) : Brand.inkLight)),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: active ? Brand.blue : (dark ? const Color(0xFF94A3B8) : Brand.inkMuted),
            ),
          ),
        ],
      ),
    );
  }

  Widget _banner(BuildContext context, IconData icon, String text, Color color, {VoidCallback? onTap}) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Tile(
          onTap: onTap,
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: color, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(text, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
              ),
              if (onTap != null) const Icon(Icons.chevron_right_rounded, size: 20),
            ],
          ),
        ),
      );

  Widget _stat(BuildContext context, String l, String v, IconData icon, Color color) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Tile(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 15, color: color),
              const SizedBox(width: 5),
              Text(
                l,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(v, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, letterSpacing: -.02)),
        ],
      ),
    );
  }
}

/// Paid time today against a normal day gauge dial.
class _Dial extends StatelessWidget {
  final double paid;
  final double normal;
  const _Dial({required this.paid, required this.normal});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final pct = normal <= 0 ? 0.0 : (paid / normal).clamp(0.0, 1.0);

    return SizedBox(
      width: 196,
      height: 196,
      child: CustomPaint(
        painter: _DialPainter(pct, dark ? const Color(0xFF1E293B) : const Color(0xFFF1F5F9)),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                dur(paid),
                style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, letterSpacing: -.03),
              ),
              const SizedBox(height: 2),
              Text(
                'of ${dur(normal)} paid',
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DialPainter extends CustomPainter {
  final double pct;
  final Color track;
  _DialPainter(this.pct, this.track);

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final r = rect.deflate(12);
    final base = Paint()
      ..color = track
      ..style = PaintingStyle.stroke
      ..strokeWidth = 14;
    canvas.drawArc(r, 0, math.pi * 2, false, base);

    if (pct <= 0) return;

    final fg = Paint()
      ..shader = const SweepGradient(
        colors: [Brand.pink, Brand.magenta, Brand.blue, Brand.pink],
        startAngle: 0,
        endAngle: math.pi * 2,
      ).createShader(r)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 14
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(r, -math.pi / 2, math.pi * 2 * pct, false, fg);
  }

  @override
  bool shouldRepaint(_DialPainter old) => old.pct != pct || old.track != track;
}
