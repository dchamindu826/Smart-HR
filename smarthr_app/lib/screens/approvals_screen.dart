import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/session.dart';
import '../widgets/common.dart';

/// Managers: approve leave, overtime and attendance corrections for their team.
class ApprovalsScreen extends StatefulWidget {
  const ApprovalsScreen({super.key});
  @override
  State<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

class _Item {
  final String kind; // leave | overtime | correction
  final Map<String, dynamic> row;
  _Item(this.kind, this.row);
}

class _ApprovalsScreenState extends State<ApprovalsScreen> {
  final _key = GlobalKey<LoaderState<List<_Item>>>();

  Future<List<_Item>> _load(Me me) async {
    final api = Api.instance;
    final out = <_Item>[];
    final jobs = <Future<void>>[];
    if (me.can('leave.approve')) {
      jobs.add(api.get('/leave/requests', {'status': 'PENDING', 'pageSize': 100}).then((v) => out.addAll(asList(asMap(v)['rows']).map((r) => _Item('leave', r)))));
    }
    if (me.can('overtime.approve')) {
      jobs.add(api.get('/overtime', {'status': 'PENDING', 'pageSize': 100}).then((v) => out.addAll(asList(asMap(v)['rows']).map((r) => _Item('overtime', r)))));
    }
    if (me.can('attendance.correct')) {
      jobs.add(api.get('/attendance/corrections', {'status': 'PENDING'}).then((v) => out.addAll(asList(v).map((r) => _Item('correction', r)))));
    }
    await Future.wait(jobs);
    return out;
  }

  Future<void> _decide(_Item it, bool approve) async {
    String? note;
    if (!approve) {
      note = await askText(context, title: 'Reason for rejecting', label: 'Note to the employee', ok: 'Reject');
      if (note == null) return;
    }
    final id = it.row['id'];
    final path = switch (it.kind) {
      'leave' => '/leave/requests/$id/decide',
      'overtime' => '/overtime/$id/decide',
      _ => '/attendance/corrections/$id/decide',
    };
    try {
      await Api.instance.post(path, {'approve': approve, if (note != null && note.isNotEmpty) 'note': note});
      if (mounted) toast(context, approve ? 'Approved.' : 'Rejected.');
      _key.currentState?.reload();
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = context.read<Session>().me!;
    final c = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Approvals')),
      body: Loader<List<_Item>>(
        key: _key,
        load: () => _load(me),
        builder: (context, items, reload) {
          if (items.isEmpty) return ListView(children: const [EmptyState(icon: Icons.fact_check_outlined, title: 'All caught up', text: 'Nothing is waiting for you.')]);
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, i) {
              final it = items[i];
              final r = it.row;
              final e = asMap(r['employee']);
              final who = '${e['firstName'] ?? ''} ${e['lastName'] ?? ''}'.trim();
              final (String title, String sub) = switch (it.kind) {
                'leave' => (
                    '${asMap(r['leaveType'])['name']} · ${r['days']} day${r['days'] == 1 ? '' : 's'}',
                    r['fromDate'] == r['toDate'] ? day(r['fromDate'] as String?) : '${day(r['fromDate'] as String?)} → ${day(r['toDate'] as String?)}',
                  ),
                'overtime' => (
                    'Overtime · ${dur(r['minutes'] as num?)}',
                    '${day(r['date'] as String?)} · week ${dur(r['weekApprovedMinutes'] as num?)} of ${dur(r['capMinutes'] as num?)}',
                  ),
                _ => (
                    'Attendance correction',
                    '${day('${r['date']}'.substring(0, 10))} · ${time(r['startAt'])}–${time(r['endAt'])}',
                  ),
              };
              return Tile(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(who.isEmpty ? '—' : who, style: TextStyle(color: c.onSurfaceVariant, fontSize: 13)),
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text(sub, style: TextStyle(color: c.onSurfaceVariant, fontSize: 13)),
                  if (r['reason'] != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('“${r['reason']}”', style: const TextStyle(fontSize: 13))),
                  const SizedBox(height: 8),
                  Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                    TextButton(onPressed: () => _decide(it, false), child: const Text('Reject')),
                    const SizedBox(width: 6),
                    FilledButton(onPressed: () => _decide(it, true), child: const Text('Approve')),
                  ]),
                ]),
              );
            },
          );
        },
      ),
    );
  }
}
