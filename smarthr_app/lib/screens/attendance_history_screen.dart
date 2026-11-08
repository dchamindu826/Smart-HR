import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../widgets/common.dart';

/// Month view of my attendance, with "request a correction" for a missed punch.
class AttendanceHistoryScreen extends StatefulWidget {
  const AttendanceHistoryScreen({super.key});
  @override
  State<AttendanceHistoryScreen> createState() => _AttendanceHistoryScreenState();
}

class _AttendanceHistoryScreenState extends State<AttendanceHistoryScreen> {
  late String _period = todayStr().substring(0, 7);
  final _key = GlobalKey<LoaderState<Map<String, dynamic>>>();

  void _shift(int months) {
    final d = DateTime.parse('$_period-01');
    final n = DateTime(d.year, d.month + months);
    final p = '${n.year}-${n.month.toString().padLeft(2, '0')}';
    if (p.compareTo(todayStr().substring(0, 7)) > 0) return;
    setState(() => _period = p);
    _key.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Attendance history'), actions: [
        IconButton(
          tooltip: 'My correction requests',
          icon: const Icon(Icons.edit_calendar_outlined),
          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CorrectionsScreen())),
        ),
      ]),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
          child: Row(children: [
            IconButton(onPressed: () => _shift(-1), icon: const Icon(Icons.chevron_left)),
            Expanded(child: Text(periodLabel(_period), textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
            IconButton(onPressed: () => _shift(1), icon: const Icon(Icons.chevron_right)),
          ]),
        ),
        Expanded(
          child: Loader<Map<String, dynamic>>(
            key: _key,
            load: () async => asMap(await Api.instance.get('/attendance/month', {'period': _period})),
            builder: (context, m, reload) {
              final t = asMap(m['totals']);
              final today = todayStr();
              final rows = asList(m['rows']).where((r) => '${r['date']}'.compareTo(today) <= 0).toList().reversed.toList();
              Widget stat(String label, String v) => Expanded(
                    child: Tile(
                      padding: const EdgeInsets.all(12),
                      child: Column(children: [
                        Text(v, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                        Text(label, style: TextStyle(fontSize: 12, color: c.onSurfaceVariant)),
                      ]),
                    ),
                  );
              return ListView(padding: const EdgeInsets.all(16), children: [
                Row(children: [
                  stat('Present', '${t['present'] ?? 0}'),
                  const SizedBox(width: 8),
                  stat('Absent', '${t['absent'] ?? 0}'),
                  const SizedBox(width: 8),
                  stat('Late days', '${t['lateDays'] ?? 0}'),
                ]),
                const SizedBox(height: 8),
                Row(children: [
                  stat('Worked', dur(t['workedMinutes'] as num?)),
                  const SizedBox(width: 8),
                  stat('Overtime', dur(t['otMinutes'] as num?)),
                ]),
                const SectionTitle('Days'),
                for (final r in rows) Padding(padding: const EdgeInsets.only(bottom: 8), child: _DayTile(r: r, onChanged: reload)),
              ]);
            },
          ),
        ),
      ]),
    );
  }
}

class _DayTile extends StatelessWidget {
  final Map<String, dynamic> r;
  final Future<void> Function() onChanged;
  const _DayTile({required this.r, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    final sessions = asList(r['sessions']);
    final leave = r['leave'] == null ? null : asMap(r['leave']);
    final hol = r['holiday'] == null ? null : asMap(r['holiday']);
    final status = r['status'] as String?;
    return Tile(
      onTap: () async {
        final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => CorrectionFormScreen(date: '${r['date']}', sessions: sessions)));
        if (ok == true) onChanged();
      },
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(day('${r['date']}'), style: const TextStyle(fontWeight: FontWeight.w700)),
            if (sessions.isNotEmpty)
              Text(sessions.map((s) => '${time(s['startAt'])}–${s['endAt'] == null ? '…' : time(s['endAt'])}${s['mode'] == 'REMOTE' ? ' (remote)' : ''}').join('  ·  '), style: TextStyle(color: c.onSurfaceVariant, fontSize: 13)),
            if (leave != null) Text('${leave['type']}${leave['halfDay'] != null ? ' (${leave['halfDay']})' : ''}', style: TextStyle(color: c.onSurfaceVariant, fontSize: 13)),
            if (hol != null) Text('${hol['name']}', style: TextStyle(color: c.onSurfaceVariant, fontSize: 13)),
            if ((r['lateMinutes'] as num? ?? 0) > 0) Text('Late ${dur(r['lateMinutes'] as num)}', style: TextStyle(color: c.error, fontSize: 12)),
          ]),
        ),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          if (status != null) StatusPill(status),
          if ((r['workedMinutes'] as num? ?? 0) > 0) Padding(padding: const EdgeInsets.only(top: 4), child: Text(dur(r['workedMinutes'] as num), style: const TextStyle(fontSize: 12))),
        ]),
      ]),
    );
  }
}

/// Ask the manager to fix or add a session for a day.
class CorrectionFormScreen extends StatefulWidget {
  final String date;
  final List<Map<String, dynamic>> sessions;
  const CorrectionFormScreen({super.key, required this.date, required this.sessions});
  @override
  State<CorrectionFormScreen> createState() => _CorrectionFormScreenState();
}

class _CorrectionFormScreenState extends State<CorrectionFormScreen> {
  String? _sessionId;
  TimeOfDay _start = const TimeOfDay(hour: 8, minute: 30);
  TimeOfDay _end = const TimeOfDay(hour: 17, minute: 30);
  String _mode = 'OFFICE';
  final _reason = TextEditingController();
  bool _busy = false;
  String? _error;

  String _hm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  TimeOfDay _fromIso(dynamic iso, TimeOfDay fallback) {
    if (iso == null) return fallback;
    final p = time(iso).split(':');
    return p.length == 2 ? TimeOfDay(hour: int.parse(p[0]), minute: int.parse(p[1])) : fallback;
  }

  void _pickSession(String? id) {
    setState(() {
      _sessionId = id;
      final s = widget.sessions.where((x) => '${x['id']}' == id).firstOrNull;
      if (s != null) {
        _start = _fromIso(s['startAt'], _start);
        _end = _fromIso(s['endAt'], _end);
        _mode = '${s['mode']}';
      }
    });
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final startIso = colomboIso(widget.date, _hm(_start));
      var endIso = colomboIso(widget.date, _hm(_end));
      // ends after midnight → next day
      if (_end.hour * 60 + _end.minute <= _start.hour * 60 + _start.minute) {
        endIso = DateTime.parse(endIso).add(const Duration(days: 1)).toIso8601String();
      }
      await Api.instance.post('/attendance/corrections', {
        'date': widget.date,
        'start': startIso,
        'end': endIso,
        'mode': _mode,
        'reason': _reason.text.trim(),
        'sessionId': _sessionId,
      });
      if (!mounted) return;
      toast(context, 'Correction sent to your manager.');
      Navigator.pop(context, true);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Correct ${day(widget.date)}')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Text('Forgot to mark in or out? Ask your manager to fix the time.', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
        const SizedBox(height: 16),
        DropdownButtonFormField<String?>(
          initialValue: _sessionId,
          decoration: const InputDecoration(labelText: 'Session'),
          items: [
            const DropdownMenuItem(value: null, child: Text('Add a missing session')),
            for (final s in widget.sessions) DropdownMenuItem(value: '${s['id']}', child: Text('Fix ${time(s['startAt'])}–${s['endAt'] == null ? '…' : time(s['endAt'])}')),
          ],
          onChanged: _pickSession,
        ),
        const SizedBox(height: 14),
        Row(children: [
          Expanded(
            child: OutlinedButton(
              onPressed: () async {
                final t = await showTimePicker(context: context, initialTime: _start);
                if (t != null) setState(() => _start = t);
              },
              child: Text('Start ${_hm(_start)}'),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: OutlinedButton(
              onPressed: () async {
                final t = await showTimePicker(context: context, initialTime: _end);
                if (t != null) setState(() => _end = t);
              },
              child: Text('End ${_hm(_end)}'),
            ),
          ),
        ]),
        const SizedBox(height: 14),
        SegmentedButton<String>(
          segments: const [ButtonSegment(value: 'OFFICE', label: Text('Office')), ButtonSegment(value: 'REMOTE', label: Text('Remote'))],
          selected: {_mode},
          onSelectionChanged: (v) => setState(() => _mode = v.first),
        ),
        const SizedBox(height: 14),
        TextField(controller: _reason, maxLines: 3, onChanged: (_) => setState(() {}), decoration: const InputDecoration(labelText: 'Reason', helperText: 'At least 10 characters')),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        const SizedBox(height: 20),
        FilledButton(onPressed: _busy || _reason.text.trim().length < 10 ? null : _submit, child: Text(_busy ? 'Sending…' : 'Send to manager')),
      ]),
    );
  }
}

class CorrectionsScreen extends StatelessWidget {
  const CorrectionsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('My corrections')),
      body: Loader<List<Map<String, dynamic>>>(
        load: () async => asList(await Api.instance.get('/attendance/corrections', {'mine': '1'})),
        builder: (context, rows, reload) {
          if (rows.isEmpty) return ListView(children: const [EmptyState(icon: Icons.edit_calendar_outlined, title: 'No correction requests')]);
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: rows.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, i) {
              final r = rows[i];
              return Tile(
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${day('${r['date']}'.substring(0, 10))} · ${time(r['startAt'] ?? r['start'])}–${time(r['endAt'] ?? r['end'])}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text('${r['reason']}', style: TextStyle(color: c.onSurfaceVariant, fontSize: 13)),
                      if (r['decisionNote'] != null) Text('Manager: ${r['decisionNote']}', style: TextStyle(color: c.onSurfaceVariant, fontSize: 12)),
                    ]),
                  ),
                  StatusPill('${r['status']}'),
                ]),
              );
            },
          );
        },
      ),
    );
  }
}
