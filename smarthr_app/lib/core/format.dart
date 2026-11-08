import 'package:intl/intl.dart';

/// Sri Lanka is UTC+05:30 all year.
const _colombo = Duration(hours: 5, minutes: 30);

DateTime toColombo(DateTime utc) => utc.toUtc().add(_colombo);

/// Today as YYYY-MM-DD in Colombo.
String todayStr() => DateFormat('yyyy-MM-dd').format(toColombo(DateTime.now()));

String money(dynamic v) {
  if (v == null) return '—';
  final n = double.tryParse('$v');
  if (n == null) return '$v';
  return NumberFormat('#,##0.00', 'en_US').format(n);
}

String rs(dynamic v) => 'Rs ${money(v)}';

/// ISO instant → "08:32" (Colombo)
String time(dynamic iso) {
  if (iso == null) return '—';
  final d = DateTime.tryParse('$iso');
  if (d == null) return '—';
  return DateFormat('HH:mm').format(toColombo(d));
}

/// "2026-10-05" → "Mon 5 Oct"
String day(String? d, {bool year = false}) {
  if (d == null) return '—';
  final x = DateTime.tryParse(d);
  if (x == null) return d;
  return DateFormat(year ? 'EEE d MMM yyyy' : 'EEE d MMM').format(x);
}

/// minutes → "8 h 30 min"
String dur(num? minutes) {
  if (minutes == null) return '—';
  final m = minutes.round().abs();
  final h = m ~/ 60;
  final r = m % 60;
  if (h == 0) return '$r min';
  if (r == 0) return '$h h';
  return '$h h $r min';
}

/// minute of day → "08:30"
String hhmm(num minute) {
  final m = ((minute.round() % 1440) + 1440) % 1440;
  return '${(m ~/ 60).toString().padLeft(2, '0')}:${(m % 60).toString().padLeft(2, '0')}';
}

/// "2026-10" → "October 2026"
String periodLabel(String p) {
  final d = DateTime.tryParse('$p-01');
  return d == null ? p : DateFormat('MMMM yyyy').format(d);
}

String label(String? s) {
  if (s == null || s.isEmpty) return '—';
  final t = s.toLowerCase().replaceAll('_', ' ');
  return t[0].toUpperCase() + t.substring(1);
}

String initials(String name) {
  final p = name.trim().split(RegExp(r'\s+')).where((x) => x.isNotEmpty).take(2);
  return p.map((x) => x[0].toUpperCase()).join();
}

/// A Colombo date + "HH:MM" → ISO instant (UTC).
String colomboIso(String date, String hm) {
  final local = DateTime.parse('${date}T$hm:00Z');
  return local.subtract(_colombo).toIso8601String();
}
