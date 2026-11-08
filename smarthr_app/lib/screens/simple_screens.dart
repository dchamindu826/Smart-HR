import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../widgets/common.dart';

// ─── Announcements ───────────────────────────────────────────

class AnnouncementsScreen extends StatelessWidget {
  const AnnouncementsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Announcements')),
      body: Loader<List<Map<String, dynamic>>>(
        load: () async => asList(await Api.instance.get('/announcements')),
        builder: (context, rows, reload) {
          if (rows.isEmpty) return ListView(children: const [EmptyState(icon: Icons.campaign_outlined, title: 'No announcements')]);
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: rows.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, i) => _AnnouncementTile(a: rows[i], onChanged: reload),
          );
        },
      ),
    );
  }
}

class _AnnouncementTile extends StatefulWidget {
  final Map<String, dynamic> a;
  final Future<void> Function() onChanged;
  const _AnnouncementTile({required this.a, required this.onChanged});
  @override
  State<_AnnouncementTile> createState() => _AnnouncementTileState();
}

class _AnnouncementTileState extends State<_AnnouncementTile> {
  bool _open = false;

  Future<void> _mark({bool ack = false}) async {
    try {
      await Api.instance.post('/announcements/${widget.a['id']}/read', {'acknowledge': ack});
      if (ack) {
        if (mounted) toast(context, 'Acknowledged.');
        await widget.onChanged();
      }
    } on ApiError catch (e) {
      if (ack && mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.a;
    final c = Theme.of(context).colorScheme;
    final unread = a['read'] != true;
    return Tile(
      onTap: () {
        setState(() => _open = !_open);
        if (unread) _mark();
      },
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          if (a['pinned'] == true) Padding(padding: const EdgeInsets.only(right: 6), child: Icon(Icons.push_pin, size: 16, color: c.primary)),
          Expanded(child: Text('${a['title']}', style: TextStyle(fontWeight: unread ? FontWeight.w800 : FontWeight.w600))),
          if (unread) Container(width: 8, height: 8, decoration: BoxDecoration(color: c.primary, shape: BoxShape.circle)),
        ]),
        Text('${a['author']} · ${day(('${a['publishedAt']}').substring(0, 10))}', style: TextStyle(fontSize: 12, color: c.onSurfaceVariant)),
        const SizedBox(height: 6),
        Text('${a['body']}', maxLines: _open ? null : 3, overflow: _open ? null : TextOverflow.ellipsis),
        if (a['requireAck'] == true) ...[
          const SizedBox(height: 8),
          a['acknowledged'] == true
              ? const StatusPill('APPROVED', text: 'Acknowledged')
              : Align(alignment: Alignment.centerRight, child: FilledButton.tonal(onPressed: () => _mark(ack: true), child: const Text('I have read this'))),
        ],
      ]),
    );
  }
}

// ─── Notifications ───────────────────────────────────────────

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  final _key = GlobalKey<LoaderState<List<Map<String, dynamic>>>>();

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    final fmt = DateFormat('d MMM, HH:mm');
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications'), actions: [
        TextButton(
          onPressed: () async {
            try {
              await Api.instance.post('/notifications/read-all');
              _key.currentState?.reload();
            } on ApiError catch (e) {
              if (context.mounted) toast(context, e.message, error: true);
            }
          },
          child: const Text('Mark all read'),
        ),
      ]),
      body: Loader<List<Map<String, dynamic>>>(
        key: _key,
        load: () async => asList(asMap(await Api.instance.get('/notifications'))['rows']),
        builder: (context, rows, reload) {
          if (rows.isEmpty) return ListView(children: const [EmptyState(icon: Icons.notifications_none, title: 'Nothing new')]);
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: rows.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, i) {
              final n = rows[i];
              final unread = n['readAt'] == null;
              final at = DateTime.tryParse('${n['createdAt']}');
              return Tile(
                onTap: unread
                    ? () async {
                        await Api.instance.post('/notifications/${n['id']}/read').catchError((_) => null);
                        reload();
                      }
                    : null,
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 6, right: 10),
                    child: Container(width: 8, height: 8, decoration: BoxDecoration(color: unread ? c.primary : Colors.transparent, shape: BoxShape.circle)),
                  ),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${n['title']}', style: TextStyle(fontWeight: unread ? FontWeight.w700 : FontWeight.w500)),
                      if (n['body'] != null) Text('${n['body']}', style: TextStyle(color: c.onSurfaceVariant, fontSize: 13)),
                      if (at != null) Text(fmt.format(toColombo(at)), style: TextStyle(color: c.onSurfaceVariant, fontSize: 11)),
                    ]),
                  ),
                ]),
              );
            },
          );
        },
      ),
    );
  }
}

// ─── Assets ──────────────────────────────────────────────────

class AssetsScreen extends StatefulWidget {
  const AssetsScreen({super.key});
  @override
  State<AssetsScreen> createState() => _AssetsScreenState();
}

class _AssetsScreenState extends State<AssetsScreen> {
  final _key = GlobalKey<LoaderState<Map<String, dynamic>>>();

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('My assets')),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.add),
        label: const Text('Request'),
        onPressed: () async {
          final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const AssetRequestScreen()));
          if (ok == true) _key.currentState?.reload();
        },
      ),
      body: Loader<Map<String, dynamic>>(
        key: _key,
        load: () async => asMap(await Api.instance.get('/assets/mine')),
        builder: (context, d, reload) {
          final assets = asList(d['assets']);
          final reqs = asList(d['requests']);
          return ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 96), children: [
            const SectionTitle('Issued to me'),
            if (assets.isEmpty) Tile(child: Text('No company assets issued to you.', style: TextStyle(color: c.onSurfaceVariant))),
            for (final a in assets)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Tile(
                  child: Row(children: [
                    Icon(_icon('${a['category']}'), color: c.primary),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${a['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        Text([a['tag'], a['brand'], a['model'], if (a['serialNo'] != null) 'S/N ${a['serialNo']}'].whereType<String>().join(' · '), style: TextStyle(color: c.onSurfaceVariant, fontSize: 13)),
                      ]),
                    ),
                  ]),
                ),
              ),
            const SectionTitle('My requests'),
            if (reqs.isEmpty) Tile(child: Text('No requests yet.', style: TextStyle(color: c.onSurfaceVariant))),
            for (final r in reqs)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Tile(
                  child: Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${r['item']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        Text('${label('${r['category']}')}${r['neededBy'] != null ? ' · needed by ${day(r['neededBy'] as String?)}' : ''}', style: TextStyle(color: c.onSurfaceVariant, fontSize: 13)),
                        if (r['decisionNote'] != null) Text('${r['decisionNote']}', style: TextStyle(color: c.onSurfaceVariant, fontSize: 12)),
                      ]),
                    ),
                    StatusPill('${r['status']}'),
                  ]),
                ),
              ),
          ]);
        },
      ),
    );
  }

  static IconData _icon(String cat) {
    switch (cat) {
      case 'LAPTOP':
        return Icons.laptop;
      case 'DESKTOP':
        return Icons.desktop_windows_outlined;
      case 'PHONE':
        return Icons.smartphone;
      case 'SIM':
        return Icons.sim_card_outlined;
      case 'TABLET':
        return Icons.tablet_android;
      case 'VEHICLE':
        return Icons.directions_car_outlined;
      case 'ACCESS_CARD':
        return Icons.badge_outlined;
      default:
        return Icons.inventory_2_outlined;
    }
  }
}

class AssetRequestScreen extends StatefulWidget {
  const AssetRequestScreen({super.key});
  @override
  State<AssetRequestScreen> createState() => _AssetRequestScreenState();
}

class _AssetRequestScreenState extends State<AssetRequestScreen> {
  static const _cats = ['LAPTOP', 'DESKTOP', 'PHONE', 'SIM', 'TABLET', 'VEHICLE', 'UNIFORM', 'TOOL', 'FURNITURE', 'ACCESS_CARD', 'OTHER'];
  String _cat = 'LAPTOP';
  final _item = TextEditingController();
  final _reason = TextEditingController();
  DateTime? _needed;
  bool _busy = false;
  String? _error;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Api.instance.post('/assets/requests', {
        'category': _cat,
        'item': _item.text.trim(),
        'reason': _reason.text.trim(),
        if (_needed != null) 'neededBy': DateFormat('yyyy-MM-dd').format(_needed!),
      });
      if (!mounted) return;
      toast(context, 'Request sent.');
      Navigator.pop(context, true);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final valid = _item.text.trim().length >= 2 && _reason.text.trim().length >= 5;
    return Scaffold(
      appBar: AppBar(title: const Text('Request an asset')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        DropdownButtonFormField<String>(
          initialValue: _cat,
          decoration: const InputDecoration(labelText: 'Category'),
          items: _cats.map((c) => DropdownMenuItem(value: c, child: Text(label(c)))).toList(),
          onChanged: (v) => setState(() => _cat = v ?? _cat),
        ),
        const SizedBox(height: 14),
        TextField(controller: _item, onChanged: (_) => setState(() {}), decoration: const InputDecoration(labelText: 'What do you need?', hintText: 'e.g. Laptop for site visits')),
        const SizedBox(height: 14),
        TextField(controller: _reason, maxLines: 3, onChanged: (_) => setState(() {}), decoration: const InputDecoration(labelText: 'Why?')),
        const SizedBox(height: 14),
        OutlinedButton.icon(
          icon: const Icon(Icons.event),
          label: Text(_needed == null ? 'Needed by (optional)' : 'Needed by ${DateFormat('EEE d MMM').format(_needed!)}'),
          onPressed: () async {
            final d = await showDatePicker(context: context, initialDate: DateTime.now().add(const Duration(days: 7)), firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 365)));
            if (d != null) setState(() => _needed = d);
          },
        ),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        const SizedBox(height: 20),
        FilledButton(onPressed: _busy || !valid ? null : _submit, child: Text(_busy ? 'Sending…' : 'Send request')),
      ]),
    );
  }
}
