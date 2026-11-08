import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/creative_background.dart';

class LeaveScreen extends StatefulWidget {
  const LeaveScreen({super.key});
  @override
  State<LeaveScreen> createState() => _LeaveScreenState();
}

class _LeaveScreenState extends State<LeaveScreen> {
  final _key = GlobalKey<LoaderState<_LeaveData>>();

  Future<_LeaveData> _load() async {
    final r = await Future.wait([
      Api.instance.get('/leave/balances/mine'),
      Api.instance.get('/leave/requests', {'mine': '1', 'pageSize': 50}),
    ]);
    return _LeaveData(asList(r[0]), asList(asMap(r[1])['rows']));
  }

  Future<void> _openApply() async {
    final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const ApplyLeaveScreen()));
    if (ok == true) _key.currentState?.reload();
  }

  Future<void> _cancel(Map<String, dynamic> req) async {
    if (!await confirm(context, title: 'Cancel this leave?', ok: 'Cancel leave', danger: true)) return;
    try {
      await Api.instance.post('/leave/requests/${req['id']}/cancel');
      if (mounted) toast(context, 'Leave cancelled.');
      _key.currentState?.reload();
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  IconData _iconForType(String code) {
    switch (code) {
      case 'ANNUAL':
        return Icons.beach_access_rounded;
      case 'CASUAL':
        return Icons.weekend_rounded;
      case 'MEDICAL':
        return Icons.medical_services_rounded;
      case 'MATERNITY':
        return Icons.child_friendly_rounded;
      default:
        return Icons.event_busy_rounded;
    }
  }

  Color _colorForType(String code) {
    switch (code) {
      case 'ANNUAL':
        return Brand.blue;
      case 'CASUAL':
        return Brand.ok;
      case 'MEDICAL':
        return Brand.warn;
      case 'MATERNITY':
        return Brand.magenta;
      default:
        return Brand.coral;
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        title: const Text('Leave'),
        backgroundColor: Colors.transparent,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Container(
              height: 38,
              decoration: BoxDecoration(
                gradient: Brand.gradient,
                borderRadius: BorderRadius.circular(19),
                boxShadow: [
                  BoxShadow(
                    color: Brand.magenta.withValues(alpha: .35),
                    blurRadius: 10,
                    offset: const Offset(0, 3),
                  ),
                ],
              ),
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: Colors.transparent,
                  shadowColor: Colors.transparent,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  minimumSize: Size.zero,
                ),
                onPressed: _openApply,
                icon: const Icon(Icons.add_rounded, size: 18, color: Colors.white),
                label: const Text(
                  'Apply',
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13.5),
                ),
              ),
            ),
          ),
        ],
      ),
      body: CreativeBackground(
        theme: BackgroundTheme.leave,
        child: SafeArea(
          bottom: false,
          child: Loader<_LeaveData>(
            key: _key,
            load: _load,
            builder: (context, d, reload) => ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 115),
              children: [
                const SectionTitle('Balance this year'),
                const SizedBox(height: 10),
                if (d.balances.isEmpty)
                  Tile(
                    child: Text(
                      'No leave balances allocated yet.',
                      style: TextStyle(color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted),
                    ),
                  )
                else
                  GridView.count(
                    crossAxisCount: 2,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 12,
                    childAspectRatio: 1.22, // Plenty of height: zero overflow!
                    children: [
                      for (final b in d.balances) ...[
                        Builder(builder: (context) {
                          final lt = asMap(b['leaveType']);
                          final code = '${lt['code']}';
                          final col = _colorForType(code);
                          final total = (b['entitled'] as num) + (b['carried'] as num) + (b['adjusted'] as num);
                          final taken = b['taken'];
                          final pending = (b['pending'] as num?) ?? 0;

                          return Tile(
                            padding: const EdgeInsets.all(14),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Expanded(
                                      child: Text(
                                        '${lt['name']}',
                                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                    Container(
                                      width: 28,
                                      height: 28,
                                      decoration: BoxDecoration(
                                        color: col.withValues(alpha: .14),
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                      child: Icon(_iconForType(code), size: 16, color: col),
                                    ),
                                  ],
                                ),
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.baseline,
                                  textBaseline: TextBaseline.alphabetic,
                                  children: [
                                    Text(
                                      '${b['available']}',
                                      style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: col, letterSpacing: -.02),
                                    ),
                                    const SizedBox(width: 4),
                                    Text(
                                      'days left',
                                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted),
                                    ),
                                  ],
                                ),
                                Text(
                                  'of $total · $taken taken${pending > 0 ? ' · $pending pend' : ''}',
                                  style: TextStyle(fontSize: 11, color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          );
                        }),
                      ],
                    ],
                  ),
                const SizedBox(height: 24),
                const SectionTitle('My requests'),
                const SizedBox(height: 10),
                if (d.requests.isEmpty)
                  Tile(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 20),
                      child: Column(
                        children: [
                          Icon(Icons.beach_access_rounded, size: 36, color: dark ? Colors.white30 : Brand.inkLight),
                          const SizedBox(height: 8),
                          const Text('No leave requests yet', style: TextStyle(fontWeight: FontWeight.w700)),
                          const SizedBox(height: 4),
                          Text(
                            'Tap the "+ Apply" button above to submit a leave request.',
                            style: TextStyle(fontSize: 12, color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted),
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ),
                    ),
                  ),
                for (final r in d.requests)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Tile(
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${asMap(r['leaveType'])['name']} · ${r['days']} day${r['days'] == 1 ? '' : 's'}',
                                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  r['fromDate'] == r['toDate']
                                      ? '${day(r['fromDate'] as String?)}${r['halfDay'] != null ? ' (${r['halfDay']})' : ''}'
                                      : '${day(r['fromDate'] as String?)} → ${day(r['toDate'] as String?)}',
                                  style: TextStyle(color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted, fontSize: 13),
                                ),
                                if (r['decisionNote'] != null) ...[
                                  const SizedBox(height: 4),
                                  Text(
                                    '${r['decisionNote']}',
                                    style: TextStyle(fontSize: 12, color: dark ? const Color(0xFF64748B) : Brand.inkLight),
                                  ),
                                ],
                              ],
                            ),
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              StatusPill('${r['status']}'),
                              if (r['status'] == 'PENDING' ||
                                  (r['status'] == 'APPROVED' && '${r['fromDate']}'.compareTo(todayStr()) > 0)) ...[
                                const SizedBox(height: 4),
                                TextButton(
                                  onPressed: () => _cancel(r),
                                  style: TextButton.styleFrom(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                    minimumSize: Size.zero,
                                    foregroundColor: Brand.bad,
                                  ),
                                  child: const Text('Cancel', style: TextStyle(fontSize: 12)),
                                ),
                              ],
                            ],
                          ),
                        ],
                      ),
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

class _LeaveData {
  final List<Map<String, dynamic>> balances;
  final List<Map<String, dynamic>> requests;
  _LeaveData(this.balances, this.requests);
}

class ApplyLeaveScreen extends StatefulWidget {
  const ApplyLeaveScreen({super.key});
  @override
  State<ApplyLeaveScreen> createState() => _ApplyLeaveScreenState();
}

class _ApplyLeaveScreenState extends State<ApplyLeaveScreen> {
  List<Map<String, dynamic>> _types = [];
  String? _type;
  DateTime _from = DateTime.now();
  DateTime _to = DateTime.now();
  String? _half;
  final _reason = TextEditingController();
  String? _error;
  bool _busy = false;
  final _fmt = DateFormat('yyyy-MM-dd');

  @override
  void initState() {
    super.initState();
    Api.instance.get('/leave/types').then((v) {
      if (!mounted) return;
      setState(() {
        _types = asList(v);
        if (_types.isNotEmpty) _type = '${_types.first['id']}';
      });
    }).catchError((Object e) {
      if (mounted) setState(() => _error = ApiError.from(e).message);
    });
  }

  Map<String, dynamic>? get _selected => _types.where((t) => '${t['id']}' == _type).firstOrNull;

  Future<void> _pick(bool from) async {
    final d = await showDatePicker(
      context: context,
      initialDate: from ? _from : _to,
      firstDate: DateTime.now().subtract(const Duration(days: 60)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (d == null) return;
    setState(() {
      if (from) {
        _from = d;
        if (_to.isBefore(d)) _to = d;
      } else {
        _to = d.isBefore(_from) ? _from : d;
      }
      if (_fmt.format(_from) != _fmt.format(_to)) _half = null;
    });
  }

  Future<void> _submit() async {
    if (_type == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Api.instance.post('/leave/requests', {
        'leaveTypeId': _type,
        'fromDate': _fmt.format(_from),
        'toDate': _fmt.format(_to),
        if (_half != null) 'halfDay': _half,
        if (_reason.text.trim().isNotEmpty) 'reason': _reason.text.trim(),
      });
      if (!mounted) return;
      toast(context, 'Leave request sent to your manager.');
      Navigator.pop(context, true);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final single = _fmt.format(_from) == _fmt.format(_to);
    final halfOk = _selected?['allowHalfDay'] == true && single;

    return Scaffold(
      appBar: AppBar(title: const Text('Apply for leave')),
      body: CreativeBackground(
        theme: BackgroundTheme.leave,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            DropdownButtonFormField<String>(
              initialValue: _type,
              decoration: const InputDecoration(labelText: 'Leave type'),
              items: _types.map((t) => DropdownMenuItem(value: '${t['id']}', child: Text('${t['name']}'))).toList(),
              onChanged: (v) => setState(() {
                _type = v;
                _half = null;
              }),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _pick(true),
                    icon: const Icon(Icons.event_rounded),
                    label: Text('From ${day(_fmt.format(_from))}'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _pick(false),
                    icon: const Icon(Icons.event_rounded),
                    label: Text('To ${day(_fmt.format(_to))}'),
                  ),
                ),
              ],
            ),
            if (halfOk) ...[
              const SizedBox(height: 14),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'FULL', label: Text('Full day')),
                  ButtonSegment(value: 'AM', label: Text('Morning')),
                  ButtonSegment(value: 'PM', label: Text('Afternoon')),
                ],
                selected: {_half ?? 'FULL'},
                onSelectionChanged: (v) => setState(() => _half = v.first == 'FULL' ? null : v.first),
              ),
            ],
            const SizedBox(height: 14),
            TextField(
              controller: _reason,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Reason (optional)'),
            ),
            const SizedBox(height: 8),
            Text(
              'Rest days and holidays in the dates are not counted.',
              style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 14),
                child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ),
            const SizedBox(height: 24),
            SizedBox(
              height: 54,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: Brand.gradient,
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [
                    BoxShadow(
                      color: Brand.magenta.withValues(alpha: .35),
                      blurRadius: 16,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.transparent,
                    shadowColor: Colors.transparent,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  onPressed: _busy || _type == null ? null : _submit,
                  child: Text(
                    _busy ? 'Sending request…' : 'Submit leave request',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white),
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
