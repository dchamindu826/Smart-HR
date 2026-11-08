import 'package:flutter_test/flutter_test.dart';
import 'package:smarthr_app/core/format.dart';

void main() {
  test('durations', () {
    expect(dur(0), '0 min');
    expect(dur(45), '45 min');
    expect(dur(60), '1 h');
    expect(dur(510), '8 h 30 min');
  });

  test('minute of day', () {
    expect(hhmm(510), '08:30');
    expect(hhmm(1440 + 30), '00:30');
  });

  test('money', () {
    expect(money(1234567.5), '1,234,567.50');
    expect(rs('2500'), 'Rs 2,500.00');
    expect(money(null), '—');
  });

  test('Colombo time', () {
    expect(colomboIso('2026-10-05', '08:30'), '2026-10-05T03:00:00.000Z');
    expect(time('2026-10-05T03:00:00.000Z'), '08:30');
  });

  test('labels', () {
    expect(label('NEEDS_REASON'), 'Needs reason');
    expect(initials('Kamal Perera'), 'KP');
    expect(periodLabel('2026-10'), 'October 2026');
  });
}
