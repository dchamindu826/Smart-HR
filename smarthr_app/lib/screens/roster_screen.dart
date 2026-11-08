import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// The employee's published roster, this week and next.
class RosterScreen extends StatelessWidget {
  const RosterScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('My roster')),
      body: Loader<List<Map<String, dynamic>>>(
        load: () async => asList(asMap(await Api.instance.get('/roster/mine'))['days']),
        builder: (context, days, reload) {
          final today = todayStr();
          if (days.every((d) => d['rostered'] != true)) {
            return ListView(children: const [
              EmptyState(icon: Icons.calendar_view_week_outlined, title: 'No roster published yet', text: 'Your roster shows here when your manager publishes it.'),
            ]);
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 115),
            itemCount: days.length,
            separatorBuilder: (_, i) => SizedBox(height: i == 6 ? 22 : 8),
            itemBuilder: (context, i) {
              final d = days[i];
              final segs = asList(d['segments']);
              final off = d['rostered'] == true && (d['isOff'] == true || segs.isEmpty);
              final hol = d['holiday'] == null ? null : asMap(d['holiday']);
              final shift = d['shift'] == null ? null : asMap(d['shift']);
              final isToday = d['date'] == today;
              final ot = (d['plannedOtMinutes'] as num?) ?? 0;
              return Tile(
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SizedBox(
                    width: 64,
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(day(d['date'] as String?).split(' ').first, style: TextStyle(fontWeight: FontWeight.w700, color: isToday ? c.primary : null)),
                      Text(day(d['date'] as String?).split(' ').skip(1).join(' '), style: TextStyle(fontSize: 12, color: c.onSurfaceVariant)),
                    ]),
                  ),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      if (d['rostered'] != true)
                        Text('Not rostered', style: TextStyle(color: c.onSurfaceVariant))
                      else if (off)
                        const Text('Rest day', style: TextStyle(fontWeight: FontWeight.w600))
                      else ...[
                        Text(segs.map((s) => '${hhmm(s['start'] as num)}–${hhmm(s['end'] as num)}${s['mode'] == 'REMOTE' ? ' (remote)' : ''}').join('  ·  '), style: const TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 2),
                        Text('${shift != null ? '${shift['name']} · ' : ''}${dur(d['paidMinutes'] as num?)} paid${ot > 0 ? ' · ${dur(ot)} OT' : ''}', style: TextStyle(fontSize: 13, color: c.onSurfaceVariant)),
                      ],
                      if (hol != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${hol['name']} · ${hol['multiplier']}× pay', style: const TextStyle(color: Brand.magenta, fontSize: 13, fontWeight: FontWeight.w600))),
                    ]),
                  ),
                  if (isToday) const StatusPill('IN', text: 'Today'),
                ]),
              );
            },
          );
        },
      ),
    );
  }
}
