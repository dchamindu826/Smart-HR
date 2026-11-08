import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../widgets/common.dart';

/// My overtime claims. Unrostered overtime needs a reason before the manager can approve it.
class OvertimeScreen extends StatefulWidget {
  const OvertimeScreen({super.key});
  @override
  State<OvertimeScreen> createState() => _OvertimeScreenState();
}

class _OvertimeScreenState extends State<OvertimeScreen> {
  final _key = GlobalKey<LoaderState<List<Map<String, dynamic>>>>();

  Future<void> _reason(Map<String, dynamic> c) async {
    final text = await askText(context, title: 'Why did you work overtime?', label: 'Reason', minLength: 10);
    if (text == null) return;
    try {
      await Api.instance.post('/overtime/${c['id']}/reason', {'reason': text});
      if (mounted) toast(context, 'Sent to your manager.');
      _key.currentState?.reload();
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('My overtime')),
      body: Loader<List<Map<String, dynamic>>>(
        key: _key,
        load: () async => asList(asMap(await Api.instance.get('/overtime', {'mine': '1', 'pageSize': 60}))['rows']),
        builder: (context, rows, reload) {
          if (rows.isEmpty) return ListView(children: const [EmptyState(icon: Icons.more_time, title: 'No overtime yet')]);
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: rows.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, i) {
              final r = rows[i];
              final needs = r['status'] == 'NEEDS_REASON';
              return Tile(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text('${day(r['date'] as String?)} · ${dur(r['minutes'] as num?)}', style: const TextStyle(fontWeight: FontWeight.w700))),
                    StatusPill('${r['status']}'),
                  ]),
                  const SizedBox(height: 4),
                  Text(r['kind'] == 'PLANNED' ? 'Planned in the roster' : 'Not in the roster', style: TextStyle(color: c.onSurfaceVariant, fontSize: 13)),
                  if (r['reason'] != null) Text('Reason: ${r['reason']}', style: TextStyle(fontSize: 13, color: c.onSurfaceVariant)),
                  if (r['decisionNote'] != null) Text('Manager: ${r['decisionNote']}', style: TextStyle(fontSize: 13, color: c.onSurfaceVariant)),
                  if (needs) Align(alignment: Alignment.centerRight, child: FilledButton.tonal(onPressed: () => _reason(r), child: const Text('Add reason'))),
                ]),
              );
            },
          );
        },
      ),
    );
  }
}
