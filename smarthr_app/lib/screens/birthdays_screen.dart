import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/api.dart';
import '../theme.dart';
import '../widgets/avatar.dart';
import '../widgets/common.dart';

class BirthdaysScreen extends StatelessWidget {
  const BirthdaysScreen({super.key});

  String _pillText(int inDays) {
    if (inDays == 0) return 'Today 🎉';
    if (inDays == 1) return 'Tomorrow';
    final target = DateTime.now().add(Duration(days: inDays));
    return DateFormat('EEEE, d MMM').format(target);
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Birthdays this week')),
      body: Loader<List<Map<String, dynamic>>>(
        load: () async => asList(await Api.instance.get('/me/birthdays')),
        builder: (context, rows, reload) {
          if (rows.isEmpty) {
            return ListView(
              children: const [
                EmptyState(
                  icon: Icons.cake_outlined,
                  title: 'No birthdays this week',
                  text: 'Upcoming birthdays for colleagues will appear here.',
                ),
              ],
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 40),
            itemCount: rows.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, i) {
              final r = rows[i];
              final hasPhoto = r['hasPhoto'] == true;
              final id = '${r['id']}';
              final name = '${r['name']}';
              final desig = r['designation'] as String?;
              final dept = r['department'] as String?;
              final sub = [
                if (desig != null && desig.isNotEmpty) desig,
                if (dept != null && dept.isNotEmpty) dept,
              ].join(' · ');
              final inDays = (r['inDays'] as num?)?.toInt() ?? 0;

              return Tile(
                child: Row(
                  children: [
                    PersonAvatar(
                      name: name,
                      photoPath: hasPhoto ? '/me/people/$id/photo' : null,
                      size: 48,
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                          if (sub.isNotEmpty) ...[
                            const SizedBox(height: 2),
                            Text(sub, style: TextStyle(color: c.onSurfaceVariant, fontSize: 13)),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: inDays == 0
                            ? Brand.magenta.withValues(alpha: 0.15)
                            : (inDays == 1 ? Brand.blue.withValues(alpha: 0.12) : c.surfaceContainerHighest),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        _pillText(inDays),
                        style: TextStyle(
                          color: inDays == 0 ? Brand.magenta : (inDays == 1 ? Brand.blue : c.onSurface),
                          fontSize: 12,
                          fontWeight: inDays == 0 ? FontWeight.w800 : FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class BirthdayTodayBanner extends StatefulWidget {
  const BirthdayTodayBanner({super.key});

  @override
  State<BirthdayTodayBanner> createState() => _BirthdayTodayBannerState();
}

class _BirthdayTodayBannerState extends State<BirthdayTodayBanner> {
  List<Map<String, dynamic>>? _todays;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = asList(await Api.instance.get('/me/birthdays'));
      if (!mounted) return;
      setState(() {
        _todays = rows.where((r) => (r['inDays'] as num?)?.toInt() == 0).toList();
        _loaded = true;
      });
    } catch (_) {
      if (mounted) setState(() => _loaded = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded || _todays == null || _todays!.isEmpty) {
      return const SizedBox.shrink();
    }

    final firstNames = _todays!.map((e) => ('${e['name']}').trim().split(' ').first).join(', ');
    final title = "🎂 It's $firstNames's birthday today!";
    final avatarList = _todays!.take(3).toList();

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const BirthdaysScreen()),
          ),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              gradient: Brand.gradient,
              borderRadius: BorderRadius.circular(20),
              boxShadow: [
                BoxShadow(
                  color: Brand.magenta.withValues(alpha: 0.35),
                  blurRadius: 14,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Row(
              children: [
                SizedBox(
                  width: 36.0 + (avatarList.length - 1) * 22.0,
                  height: 36,
                  child: Stack(
                    children: List.generate(avatarList.length, (idx) {
                      final r = avatarList[idx];
                      final hasPhoto = r['hasPhoto'] == true;
                      final id = '${r['id']}';
                      final name = '${r['name']}';
                      return Positioned(
                        left: idx * 22.0,
                        child: PersonAvatar(
                          name: name,
                          photoPath: hasPhoto ? '/me/people/$id/photo' : null,
                          size: 36,
                          ring: Colors.white,
                        ),
                      );
                    }),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 14.5,
                    ),
                  ),
                ),
                const Icon(Icons.chevron_right, color: Colors.white, size: 20),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
