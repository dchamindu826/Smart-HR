import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import '../core/api.dart';
import '../core/live.dart';
import '../core/format.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/creative_background.dart';

enum _RosterViewMode { calendar, weekly, list }

class RosterScreen extends StatefulWidget {
  const RosterScreen({super.key});

  @override
  State<RosterScreen> createState() => _RosterScreenState();
}

class _RosterScreenState extends State<RosterScreen> {
  _RosterViewMode _viewMode = _RosterViewMode.calendar;
  late DateTime _selectedMonth;
  late String _selectedDate;
  late DateTime _selectedWeekStart;

  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _days = [];
  Map<String, dynamic>? _defaultShift;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _selectedMonth = DateTime(now.year, now.month, 1);
    _selectedDate = todayStr();
    _selectedWeekStart = _findMonday(now);
    _fetchRoster();
    // HR may publish or change the roster at any time: reload when the tab is opened or the app returns.
    Live.tab.addListener(_onLive);
    Live.resumed.addListener(_onLive);
  }

  void _onLive() {
    if (mounted && Live.tab.value == 'Roster') _fetchRoster();
  }

  @override
  void dispose() {
    Live.tab.removeListener(_onLive);
    Live.resumed.removeListener(_onLive);
    super.dispose();
  }

  DateTime _findMonday(DateTime d) {
    return DateTime(d.year, d.month, d.day).subtract(Duration(days: d.weekday - 1));
  }

  Future<void> _fetchRoster() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    // Load whole weeks around the month, so the week view is complete when a
    // week crosses into the previous or next month.
    final fmt = DateFormat('yyyy-MM-dd');
    final monthStart = DateTime(_selectedMonth.year, _selectedMonth.month, 1);
    final monthEnd = DateTime(_selectedMonth.year, _selectedMonth.month + 1, 0);
    var fromDay = _findMonday(monthStart);
    var toDay = _findMonday(monthEnd).add(const Duration(days: 6));
    final weekEnd = _selectedWeekStart.add(const Duration(days: 6));
    if (_selectedWeekStart.isBefore(fromDay)) fromDay = _selectedWeekStart;
    if (weekEnd.isAfter(toDay)) toDay = weekEnd;
    final from = fmt.format(fromDay);
    final to = fmt.format(toDay);

    try {
      final res = asMap(await Api.instance.get('/roster/mine?from=$from&to=$to'));
      if (!mounted) return;
      setState(() {
        _days = asList(res['days']);
        _defaultShift = res['defaultShift'] == null ? null : asMap(res['defaultShift']);
        _loading = false;
      });
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load roster.';
        _loading = false;
      });
    }
  }

  void _prevMonth() {
    setState(() {
      _selectedMonth = DateTime(_selectedMonth.year, _selectedMonth.month - 1, 1);
      final daysInNew = DateTime(_selectedMonth.year, _selectedMonth.month + 1, 0).day;
      final currentD = DateTime.tryParse(_selectedDate)?.day ?? 1;
      final newD = currentD > daysInNew ? daysInNew : currentD;
      _selectedDate = '${_selectedMonth.year}-${_selectedMonth.month.toString().padLeft(2, '0')}-${newD.toString().padLeft(2, '0')}';
      _selectedWeekStart = _findMonday(DateTime.parse(_selectedDate));
    });
    _fetchRoster();
  }

  void _nextMonth() {
    setState(() {
      _selectedMonth = DateTime(_selectedMonth.year, _selectedMonth.month + 1, 1);
      final daysInNew = DateTime(_selectedMonth.year, _selectedMonth.month + 1, 0).day;
      final currentD = DateTime.tryParse(_selectedDate)?.day ?? 1;
      final newD = currentD > daysInNew ? daysInNew : currentD;
      _selectedDate = '${_selectedMonth.year}-${_selectedMonth.month.toString().padLeft(2, '0')}-${newD.toString().padLeft(2, '0')}';
      _selectedWeekStart = _findMonday(DateTime.parse(_selectedDate));
    });
    _fetchRoster();
  }

  void _jumpToToday() {
    final now = DateTime.now();
    final thisMonth = DateTime(now.year, now.month, 1);
    final needReload = thisMonth.year != _selectedMonth.year || thisMonth.month != _selectedMonth.month;

    setState(() {
      _selectedMonth = thisMonth;
      _selectedDate = todayStr();
      _selectedWeekStart = _findMonday(now);
    });

    if (needReload) {
      _fetchRoster();
    }
  }

  void _prevWeek() {
    var reload = false;
    setState(() {
      _selectedWeekStart = _selectedWeekStart.subtract(const Duration(days: 7));
      _selectedDate = DateFormat('yyyy-MM-dd').format(_selectedWeekStart);
      if (_selectedWeekStart.month != _selectedMonth.month || _selectedWeekStart.year != _selectedMonth.year) {
        _selectedMonth = DateTime(_selectedWeekStart.year, _selectedWeekStart.month, 1);
        reload = true;
      }
    });
    if (reload) _fetchRoster();
  }

  void _nextWeek() {
    var reload = false;
    setState(() {
      _selectedWeekStart = _selectedWeekStart.add(const Duration(days: 7));
      _selectedDate = DateFormat('yyyy-MM-dd').format(_selectedWeekStart);
      if (_selectedWeekStart.month != _selectedMonth.month || _selectedWeekStart.year != _selectedMonth.year) {
        _selectedMonth = DateTime(_selectedWeekStart.year, _selectedWeekStart.month, 1);
        reload = true;
      }
    });
    if (reload) _fetchRoster();
  }

  Map<String, dynamic>? _dayData(String dateStr) {
    for (final d in _days) {
      if (d['date'] == dateStr) return d;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        title: const Text('My roster'),
        backgroundColor: Colors.transparent,
        systemOverlayStyle: dark
            ? SystemUiOverlayStyle.light
            : const SystemUiOverlayStyle(
                statusBarColor: Colors.transparent,
                statusBarBrightness: Brightness.light,
                statusBarIconBrightness: Brightness.dark,
              ),
        actions: [
          TextButton.icon(
            onPressed: _jumpToToday,
            icon: const Icon(Icons.today_rounded, size: 18),
            label: const Text('Today'),
            style: TextButton.styleFrom(
              foregroundColor: dark ? Colors.white : Brand.blue,
              textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
            ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: CreativeBackground(
        theme: BackgroundTheme.roster,
        child: SafeArea(
          bottom: false,
          child: RefreshIndicator(
            onRefresh: _fetchRoster,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 120),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // 1. Navigation & Period Selector
                  _buildPeriodHeader(dark),
                  const SizedBox(height: 12),

                  // 2. View Mode Tabs (Calendar | Weekly | List)
                  _buildModeTabs(dark),
                  const SizedBox(height: 14),

                  // 3. Body View based on Mode
                  if (_loading)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 60),
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else if (_error != null)
                    ErrorState(message: _error!, onRetry: _fetchRoster)
                  else ...[
                    // Monthly stats chips
                    _buildMonthStats(dark),
                    const SizedBox(height: 14),

                    if (_viewMode == _RosterViewMode.calendar) ...[
                      _buildCalendarGrid(dark),
                      const SizedBox(height: 16),
                      _buildSelectedDayDetailCard(dark),
                    ] else if (_viewMode == _RosterViewMode.weekly) ...[
                      _buildWeeklyView(dark),
                    ] else ...[
                      _buildListView(dark),
                    ],
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ─── Period Header (Month or Week) ──────────────────────────────────
  Widget _buildPeriodHeader(bool dark) {
    final title = _viewMode == _RosterViewMode.weekly
        ? '${DateFormat('d MMM').format(_selectedWeekStart)} – ${DateFormat('d MMM yyyy').format(_selectedWeekStart.add(const Duration(days: 6)))}'
        : DateFormat('MMMM yyyy').format(_selectedMonth);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: dark ? const Color(0xFF162032) : Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: dark ? const Color(0xFF1E293B) : const Color(0x0C000000)),
        boxShadow: [
          BoxShadow(
            color: dark ? Colors.black.withValues(alpha: 0.25) : const Color(0x080F172A),
            blurRadius: 14,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          IconButton(
            onPressed: _viewMode == _RosterViewMode.weekly ? _prevWeek : _prevMonth,
            icon: const Icon(Icons.chevron_left_rounded, size: 28),
            color: dark ? Colors.white70 : Brand.ink,
            tooltip: 'Previous',
          ),
          Text(
            title,
            style: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.w800, letterSpacing: -.02),
          ),
          IconButton(
            onPressed: _viewMode == _RosterViewMode.weekly ? _nextWeek : _nextMonth,
            icon: const Icon(Icons.chevron_right_rounded, size: 28),
            color: dark ? Colors.white70 : Brand.ink,
            tooltip: 'Next',
          ),
        ],
      ),
    );
  }

  // ─── Mode Tabs (Calendar, Weekly, List) ──────────────────────────────
  Widget _buildModeTabs(bool dark) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: dark ? const Color(0xFF162032) : const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          _tabPill('Calendar', Icons.calendar_month_rounded, _RosterViewMode.calendar, dark),
          _tabPill('Weekly', Icons.view_week_rounded, _RosterViewMode.weekly, dark),
          _tabPill('List', Icons.format_list_bulleted_rounded, _RosterViewMode.list, dark),
        ],
      ),
    );
  }

  Widget _tabPill(String title, IconData icon, _RosterViewMode mode, bool dark) {
    final active = _viewMode == mode;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _viewMode = mode),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(vertical: 9),
          decoration: BoxDecoration(
            gradient: active ? Brand.gradient : null,
            color: active ? null : Colors.transparent,
            borderRadius: BorderRadius.circular(12),
            boxShadow: active
                ? [
                    BoxShadow(
                      color: Brand.magenta.withValues(alpha: 0.3),
                      blurRadius: 10,
                      offset: const Offset(0, 3),
                    ),
                  ]
                : null,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 16, color: active ? Colors.white : (dark ? Colors.white60 : Brand.inkMuted)),
              const SizedBox(width: 6),
              Text(
                title,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                  color: active ? Colors.white : (dark ? Colors.white70 : Brand.inkMuted),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ─── Month Quick Stats ──────────────────────────────────────────────
  Widget _buildMonthStats(bool dark) {
    int rosteredDays = 0;
    int restDays = 0;
    int totalPaidMinutes = 0;

    for (final d in _days) {
      final segs = asList(d['segments']);
      final isRostered = d['rostered'] == true || (d['status'] != null && d['status'] != 'PUBLISHED');
      final isOff = d['isOff'] == true || (isRostered && segs.isEmpty);

      if (isRostered) {
        if (isOff) {
          restDays++;
        } else {
          rosteredDays++;
          totalPaidMinutes += ((d['paidMinutes'] as num?) ?? 0).toInt();
        }
      }
    }

    final hours = (totalPaidMinutes / 60).toStringAsFixed(totalPaidMinutes % 60 == 0 ? 0 : 1);

    return Row(
      children: [
        _statChip('Rostered', '$rosteredDays d', Icons.work_outline_rounded, Brand.blue, dark),
        const SizedBox(width: 8),
        _statChip('Rest Days', '$restDays d', Icons.weekend_outlined, Brand.inkMuted, dark),
        const SizedBox(width: 8),
        _statChip('Total Paid', '${hours}h', Icons.timer_outlined, Brand.ok, dark),
      ],
    );
  }

  Widget _statChip(String label, String value, IconData icon, Color color, bool dark) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        decoration: BoxDecoration(
          color: dark ? const Color(0xFF162032) : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: dark ? const Color(0xFF1E293B) : const Color(0x0C000000)),
        ),
        child: Row(
          children: [
            Icon(icon, size: 16, color: color),
            const SizedBox(width: 6),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: TextStyle(fontSize: 10.5, color: dark ? Colors.white60 : Brand.inkMuted)),
                  Text(value, style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: color)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ─── 1. Monthly Calendar Grid ───────────────────────────────────────
  Widget _buildCalendarGrid(bool dark) {
    final weekdays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    final year = _selectedMonth.year;
    final month = _selectedMonth.month;

    final firstDay = DateTime(year, month, 1);
    final leadingBlanks = firstDay.weekday - 1; // Mon = 1 => 0 blanks
    final totalDaysInMonth = DateTime(year, month + 1, 0).day;
    final totalCells = leadingBlanks + totalDaysInMonth;
    final totalRows = (totalCells / 7).ceil();

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: dark ? const Color(0xFF162032) : Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: dark ? const Color(0xFF1E293B) : const Color(0x0C000000)),
        boxShadow: [
          BoxShadow(
            color: dark ? Colors.black.withValues(alpha: 0.3) : const Color(0x0A0F172A),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        children: [
          // Weekday header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: weekdays
                .map((w) => SizedBox(
                      width: 36,
                      child: Text(
                        w,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                          color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted,
                        ),
                      ),
                    ))
                .toList(),
          ),
          const SizedBox(height: 10),
          const Divider(height: 1),
          const SizedBox(height: 10),

          // Days Grid
          for (int r = 0; r < totalRows; r++) ...[
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                for (int c = 0; c < 7; c++) ...[
                  Builder(builder: (ctx) {
                    final index = r * 7 + c;
                    final dayNum = index - leadingBlanks + 1;
                    if (dayNum < 1 || dayNum > totalDaysInMonth) {
                      return const SizedBox(width: 42, height: 50);
                    }
                    final dateStr = '$year-${month.toString().padLeft(2, '0')}-${dayNum.toString().padLeft(2, '0')}';
                    return _buildCalendarDayCell(dayNum, dateStr, dark);
                  }),
                ],
              ],
            ),
            if (r < totalRows - 1) const SizedBox(height: 6),
          ],
        ],
      ),
    );
  }

  Widget _buildCalendarDayCell(int dayNum, String dateStr, bool dark) {
    final d = _dayData(dateStr);
    final isToday = dateStr == todayStr();
    final isSelected = dateStr == _selectedDate;

    final segs = asList(d?['segments']);
    final isRostered = d?['rostered'] == true;
    final isDraft = !isRostered && d?['status'] != null;
    final isOff = (isRostered || isDraft) && (d?['isOff'] == true || segs.isEmpty);
    final shift = d?['shift'] == null ? null : asMap(d?['shift']);
    final holiday = d?['holiday'] == null ? null : asMap(d?['holiday']);
    final leave = d?['leave'] == null ? null : asMap(d?['leave']);

    Color? shiftColor;
    if (shift?['color'] != null) {
      try {
        final cStr = shift!['color'].toString().replaceAll('#', '');
        shiftColor = Color(int.parse('FF$cStr', radix: 16));
      } catch (_) {}
    }
    shiftColor ??= Brand.blue;

    return GestureDetector(
      onTap: () {
        setState(() {
          _selectedDate = dateStr;
          _selectedWeekStart = _findMonday(DateTime.parse(dateStr));
        });
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        width: 42,
        height: 52,
        decoration: BoxDecoration(
          color: isSelected
              ? (dark ? Brand.blue.withValues(alpha: 0.25) : Brand.blue.withValues(alpha: 0.12))
              : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected
                ? Brand.blue
                : (isToday ? Brand.magenta : Colors.transparent),
            width: isSelected || isToday ? 1.5 : 1,
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              '$dayNum',
              style: TextStyle(
                fontSize: 14,
                fontWeight: isToday || isSelected ? FontWeight.w800 : FontWeight.w600,
                color: isSelected
                    ? (dark ? Colors.white : Brand.blue)
                    : (isToday ? Brand.magenta : (dark ? Colors.white : Brand.ink)),
              ),
            ),
            const SizedBox(height: 3),
            // Indicator pill / dot
            if (leave != null)
              Container(
                width: 6,
                height: 6,
                decoration: const BoxDecoration(color: Brand.ok, shape: BoxShape.circle),
              )
            else if (holiday != null)
              Container(
                width: 6,
                height: 6,
                decoration: const BoxDecoration(color: Brand.magenta, shape: BoxShape.circle),
              )
            else if (isOff)
              const Text('OFF', style: TextStyle(fontSize: 8, fontWeight: FontWeight.w700, color: Brand.inkMuted))
            else if (isRostered || isDraft)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                decoration: BoxDecoration(
                  color: isDraft ? Brand.warn.withValues(alpha: 0.2) : shiftColor.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(4),
                  border: isDraft ? Border.all(color: Brand.warn, width: 0.8) : null,
                ),
                child: Text(
                  shift?['name'] != null ? '${shift!['name']}'.split(' ').first : 'WORK',
                  maxLines: 1,
                  style: TextStyle(
                    fontSize: 7.5,
                    fontWeight: FontWeight.w800,
                    color: isDraft ? Brand.warn : shiftColor,
                  ),
                ),
              )
            else
              const SizedBox(height: 6),
          ],
        ),
      ),
    );
  }

  // ─── Selected Day Detail Card ───────────────────────────────────────
  Widget _buildSelectedDayDetailCard(bool dark) {
    final d = _dayData(_selectedDate);
    final dateObj = DateTime.tryParse(_selectedDate);
    final formattedDate = dateObj != null ? DateFormat('EEEE, d MMMM yyyy').format(dateObj) : _selectedDate;
    final isToday = _selectedDate == todayStr();

    final segs = asList(d?['segments']);
    final isRostered = d?['rostered'] == true;
    final status = d?['status'] as String?;
    final isDraft = !isRostered && status != null && status != 'PUBLISHED';
    final isOff = (isRostered || isDraft) && (d?['isOff'] == true || segs.isEmpty);
    final shift = d?['shift'] == null ? null : asMap(d?['shift']);
    final holiday = d?['holiday'] == null ? null : asMap(d?['holiday']);
    final leave = d?['leave'] == null ? null : asMap(d?['leave']);
    final paidMinutes = (d?['paidMinutes'] as num?) ?? 0;
    final otMinutes = (d?['plannedOtMinutes'] as num?) ?? 0;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: dark ? const Color(0xFF162032) : Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: dark ? const Color(0xFF1E293B) : const Color(0x0C000000)),
        boxShadow: [
          BoxShadow(
            color: dark ? Colors.black.withValues(alpha: 0.3) : const Color(0x0C0F172A),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Row
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      formattedDate,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, letterSpacing: -.02),
                    ),
                    if (isToday)
                      const Text(
                        'TODAY',
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Brand.magenta, letterSpacing: .04),
                      ),
                  ],
                ),
              ),
              // Status Badge
              if (isRostered && !isOff)
                const StatusPill('APPROVED', text: 'Published')
              else if (isDraft)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: Brand.warn.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: Brand.warn.withValues(alpha: 0.4)),
                  ),
                  child: const Text('Draft', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Brand.warn)),
                )
              else if (isOff)
                const StatusPill('REST', text: 'Rest day')
              else
                const StatusPill('PENDING', text: 'Not rostered'),
            ],
          ),
          const SizedBox(height: 14),
          const Divider(height: 1),
          const SizedBox(height: 14),

          // Leave Notice
          if (leave != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Brand.ok.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Brand.ok.withValues(alpha: 0.3)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.beach_access_rounded, color: Brand.ok, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Approved Leave: ${leave['name']}',
                      style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.ok, fontSize: 13.5),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],

          // Holiday Notice
          if (holiday != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Brand.magenta.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Brand.magenta.withValues(alpha: 0.3)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.celebration_rounded, color: Brand.magenta, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      '${holiday['name']} (${holiday['multiplier']}× pay multiplier)',
                      style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.magenta, fontSize: 13.5),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],

          // Draft Notice Banner
          if (isDraft) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Brand.warn.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Brand.warn.withValues(alpha: 0.3)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.edit_note_rounded, color: Brand.warn, size: 20),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'This shift is drafted by your manager and awaiting publication.',
                      style: TextStyle(fontWeight: FontWeight.w600, color: Brand.warn, fontSize: 12.5),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],

          // Shift details
          if ((isRostered || isDraft) && !isOff && segs.isNotEmpty) ...[
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: dark ? const Color(0xFF0F172A) : const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: dark ? const Color(0xFF1E293B) : const Color(0x0C000000)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          gradient: Brand.gradient,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          shift?['name'] ?? 'SHIFT',
                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12, color: Colors.white),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Text(
                        dur(paidMinutes),
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
                      ),
                      if (otMinutes > 0) ...[
                        const SizedBox(width: 8),
                        Text(
                          '+ ${dur(otMinutes)} OT',
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5, color: Brand.warn),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 12),
                  // Segments
                  for (final s in segs) ...[
                    Row(
                      children: [
                        Icon(
                          s['mode'] == 'REMOTE' ? Icons.home_work_rounded : Icons.apartment_rounded,
                          size: 16,
                          color: s['mode'] == 'REMOTE' ? Brand.magenta : Brand.blue,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          '${hhmm(s['start'] as num)} – ${hhmm(s['end'] as num)}',
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          '(${s['mode'] == 'REMOTE' ? 'Remote' : 'Office'})',
                          style: TextStyle(fontSize: 12, color: dark ? Colors.white60 : Brand.inkMuted),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ] else if (isOff) ...[
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: dark ? const Color(0xFF0F172A) : const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Row(
                children: [
                  const Icon(Icons.weekend_rounded, color: Brand.inkMuted, size: 22),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Rest Day (Off)', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                      Text('No work scheduled for this day.', style: TextStyle(fontSize: 12, color: dark ? Colors.white60 : Brand.inkMuted)),
                    ],
                  ),
                ],
              ),
            ),
          ] else ...[
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: dark ? const Color(0xFF0F172A) : const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('No Roster Assigned', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                  const SizedBox(height: 4),
                  Text(
                    _defaultShift != null
                        ? 'Company Default Shift: ${_defaultShift!['name']} (${dur(_defaultShift!['totalMinutes'] as num?)} paid)'
                        : 'No shifts scheduled yet for this date.',
                    style: TextStyle(fontSize: 12.5, color: dark ? Colors.white60 : Brand.inkMuted),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  // ─── 2. Weekly View ─────────────────────────────────────────────────
  Widget _buildWeeklyView(bool dark) {
    final daysOfWeek = <DateTime>[];
    for (int i = 0; i < 7; i++) {
      daysOfWeek.add(_selectedWeekStart.add(Duration(days: i)));
    }

    return Column(
      children: daysOfWeek.map((dt) {
        final dateStr = DateFormat('yyyy-MM-dd').format(dt);
        final d = _dayData(dateStr);
        final isToday = dateStr == todayStr();
        final segs = asList(d?['segments']);
        final isRostered = d?['rostered'] == true;
        final status = d?['status'] as String?;
        final isDraft = !isRostered && status != null && status != 'PUBLISHED';
        final isOff = (isRostered || isDraft) && (d?['isOff'] == true || segs.isEmpty);
        final shift = d?['shift'] == null ? null : asMap(d?['shift']);
        final holiday = d?['holiday'] == null ? null : asMap(d?['holiday']);
        final leave = d?['leave'] == null ? null : asMap(d?['leave']);

        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Tile(
            onTap: () {
              setState(() {
                _selectedDate = dateStr;
                _viewMode = _RosterViewMode.calendar;
              });
            },
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 68,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        DateFormat('EEE').format(dt),
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w800,
                          color: isToday ? Brand.magenta : (dark ? Colors.white : Brand.ink),
                        ),
                      ),
                      Text(
                        DateFormat('d MMM').format(dt),
                        style: TextStyle(fontSize: 12, color: dark ? Colors.white60 : Brand.inkMuted),
                      ),
                      if (isToday)
                        Container(
                          margin: const EdgeInsets.only(top: 4),
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                          decoration: BoxDecoration(
                            color: Brand.magenta.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: const Text('Today', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: Brand.magenta)),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (leave != null)
                        Text('🌴 Leave: ${leave['name']}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.ok, fontSize: 13.5))
                      else if (isOff)
                        const Text('Rest day', style: TextStyle(fontWeight: FontWeight.w700, color: Brand.inkMuted))
                      else if ((isRostered || isDraft) && segs.isNotEmpty) ...[
                        Row(
                          children: [
                            Text(
                              segs.map((s) => '${hhmm(s['start'] as num)}–${hhmm(s['end'] as num)}').join(' · '),
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
                            ),
                            if (isDraft) ...[
                              const SizedBox(width: 6),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                                decoration: BoxDecoration(
                                  color: Brand.warn.withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: const Text('Draft', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: Brand.warn)),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${shift?['name'] != null ? '${shift!['name']} · ' : ''}${dur(d?['paidMinutes'] as num?)} paid',
                          style: TextStyle(fontSize: 12.5, color: dark ? Colors.white70 : Brand.inkMuted),
                        ),
                      ] else ...[
                        Text('Not rostered', style: TextStyle(fontSize: 13, color: dark ? Colors.white54 : Brand.inkMuted)),
                      ],
                      if (holiday != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text('🎉 ${holiday['name']}', style: const TextStyle(color: Brand.magenta, fontSize: 12, fontWeight: FontWeight.w600)),
                        ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right_rounded, size: 20, color: Brand.inkMuted),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  // ─── 3. List View ───────────────────────────────────────────────────
  Widget _buildListView(bool dark) {
    if (_days.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 40),
        child: EmptyState(
          icon: Icons.calendar_view_day_rounded,
          title: 'No shifts for this month',
          text: 'No rostered shifts found for the selected month.',
        ),
      );
    }

    return ListView.separated(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: _days.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, i) {
        final d = _days[i];
        final dateStr = '${d['date']}';
        final dateObj = DateTime.tryParse(dateStr);
        final isToday = dateStr == todayStr();
        final segs = asList(d['segments']);
        final isRostered = d['rostered'] == true;
        final status = d['status'] as String?;
        final isDraft = !isRostered && status != null && status != 'PUBLISHED';
        final isOff = (isRostered || isDraft) && (d['isOff'] == true || segs.isEmpty);
        final shift = d['shift'] == null ? null : asMap(d['shift']);
        final holiday = d['holiday'] == null ? null : asMap(d['holiday']);
        final leave = d['leave'] == null ? null : asMap(d['leave']);

        return Tile(
          onTap: () {
            setState(() {
              _selectedDate = dateStr;
              _viewMode = _RosterViewMode.calendar;
            });
          },
          child: Row(
            children: [
              SizedBox(
                width: 60,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      dateObj != null ? DateFormat('EEE').format(dateObj) : '—',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: isToday ? Brand.magenta : (dark ? Colors.white70 : Brand.inkMuted),
                      ),
                    ),
                    Text(
                      dateObj != null ? DateFormat('d MMM').format(dateObj) : dateStr,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: isToday ? Brand.magenta : null,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (leave != null)
                      Text('🌴 ${leave['name']}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.ok, fontSize: 13.5))
                    else if (isOff)
                      const Text('Rest day', style: TextStyle(fontWeight: FontWeight.w600, color: Brand.inkMuted))
                    else if ((isRostered || isDraft) && segs.isNotEmpty) ...[
                      Text(
                        segs.map((s) => '${hhmm(s['start'] as num)}–${hhmm(s['end'] as num)}').join(' · '),
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
                      ),
                      Text(
                        '${shift?['name'] != null ? '${shift!['name']} · ' : ''}${dur(d['paidMinutes'] as num?)} paid',
                        style: TextStyle(fontSize: 12, color: dark ? Colors.white60 : Brand.inkMuted),
                      ),
                    ] else ...[
                      Text('Not rostered', style: TextStyle(fontSize: 12.5, color: dark ? Colors.white54 : Brand.inkMuted)),
                    ],
                    if (holiday != null)
                      Text('🎉 ${holiday['name']}', style: const TextStyle(color: Brand.magenta, fontSize: 11.5, fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
              if (isDraft)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: Brand.warn.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text('Draft', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Brand.warn)),
                )
              else if (isToday)
                const StatusPill('IN', text: 'Today'),
            ],
          ),
        );
      },
    );
  }
}
