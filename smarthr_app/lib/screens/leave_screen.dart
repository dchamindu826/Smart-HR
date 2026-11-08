import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../widgets/common.dart';

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

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Leave')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const ApplyLeaveScreen()));
          if (ok == true) _key.currentState?.reload();
        },
        icon: const Icon(Icons.add),
        label: const Text('Apply'),
      ),
      body: Loader<_LeaveData>(
        key: _key,
        load: _load,
        builder: (context, d, reload) => ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 115), children: [
          const SectionTitle('Balance this year'),
          if (d.balances.isEmpty) Tile(child: Text('No leave balances yet.', style: TextStyle(color: c.onSurfaceVariant))),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 1.6,
            children: [
              for (final b in d.balances)
                Tile(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    Text('${asMap(b['leaveType'])['name']}', style: TextStyle(color: c.onSurfaceVariant, fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis),
                    Text('${b['available']}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
                    Text('of ${(b['entitled'] as num) + (b['carried'] as num) + (b['adjusted'] as num)} · ${b['taken']} taken${(b['pending'] as num) > 0 ? ' · ${b['pending']} pending' : ''}', style: TextStyle(fontSize: 12, color: c.onSurfaceVariant)),
                  ]),
                ),
            ],
          ),
          const SectionTitle('My requests'),
          if (d.requests.isEmpty) const EmptyState(icon: Icons.beach_access_outlined, title: 'No leave requests yet'),
          for (final r in d.requests)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Tile(
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${asMap(r['leaveType'])['name']} · ${r['days']} day${r['days'] == 1 ? '' : 's'}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text(r['fromDate'] == r['toDate'] ? '${day(r['fromDate'] as String?)}${r['halfDay'] != null ? ' (${r['halfDay']})' : ''}' : '${day(r['fromDate'] as String?)} → ${day(r['toDate'] as String?)}', style: TextStyle(color: c.onSurfaceVariant)),
                      if (r['decisionNote'] != null) Text('${r['decisionNote']}', style: TextStyle(fontSize: 12, color: c.onSurfaceVariant)),
                    ]),
                  ),
                  Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    StatusPill('${r['status']}'),
                    if (r['status'] == 'PENDING' || (r['status'] == 'APPROVED' && '${r['fromDate']}'.compareTo(todayStr()) > 0))
                      TextButton(onPressed: () => _cancel(r), child: const Text('Cancel')),
                  ]),
                ]),
              ),
            ),
        ]),
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
    final d = await showDatePicker(context: context, initialDate: from ? _from : _to, firstDate: DateTime.now().subtract(const Duration(days: 60)), lastDate: DateTime.now().add(const Duration(days: 365)));
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
      body: ListView(padding: const EdgeInsets.all(20), children: [
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
        Row(children: [
          Expanded(child: OutlinedButton.icon(onPressed: () => _pick(true), icon: const Icon(Icons.event), label: Text('From ${day(_fmt.format(_from))}'))),
          const SizedBox(width: 10),
          Expanded(child: OutlinedButton.icon(onPressed: () => _pick(false), icon: const Icon(Icons.event), label: Text('To ${day(_fmt.format(_to))}'))),
        ]),
        if (halfOk) ...[
          const SizedBox(height: 14),
          SegmentedButton<String>(
            segments: const [ButtonSegment(value: 'FULL', label: Text('Full day')), ButtonSegment(value: 'AM', label: Text('Morning')), ButtonSegment(value: 'PM', label: Text('Afternoon'))],
            selected: {_half ?? 'FULL'},
            onSelectionChanged: (v) => setState(() => _half = v.first == 'FULL' ? null : v.first),
          ),
        ],
        const SizedBox(height: 14),
        TextField(controller: _reason, maxLines: 3, decoration: const InputDecoration(labelText: 'Reason (optional)')),
        const SizedBox(height: 8),
        Text('Rest days and holidays in the dates are not counted.', style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 14), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        const SizedBox(height: 20),
        FilledButton(onPressed: _busy || _type == null ? null : _submit, child: Text(_busy ? 'Sending…' : 'Send request')),
      ]),
    );
  }
}
