import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/creative_background.dart';

class PayslipsScreen extends StatelessWidget {
  const PayslipsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        title: const Text('Payslips'),
        backgroundColor: Colors.transparent,
        systemOverlayStyle: dark
            ? SystemUiOverlayStyle.light
            : const SystemUiOverlayStyle(
                statusBarColor: Colors.transparent,
                statusBarBrightness: Brightness.light,
                statusBarIconBrightness: Brightness.dark,
              ),
      ),
      body: CreativeBackground(
        theme: BackgroundTheme.payslips,
        child: SafeArea(
          bottom: false,
          child: Loader<List<Map<String, dynamic>>>(
            load: () async => asList(await Api.instance.get('/payslips/mine')),
            builder: (context, rows, reload) {
              if (rows.isEmpty) {
                return ListView(children: const [EmptyState(icon: Icons.receipt_long_outlined, title: 'No payslips yet', text: 'Your payslip appears here when HR releases the month\'s payroll.')]);
              }
              return ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 160),
                itemCount: rows.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final r = rows[i];
                  return Tile(
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => PayslipScreen(id: '${r['id']}', period: '${r['period']}'))),
                    child: Row(children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(color: Brand.blue.withValues(alpha: .12), borderRadius: BorderRadius.circular(12)),
                        child: const Icon(Icons.receipt_long, color: Brand.blue),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(periodLabel('${r['period']}'), style: const TextStyle(fontWeight: FontWeight.w700)),
                          Text('Gross ${rs(r['gross'])}', style: TextStyle(color: c.onSurfaceVariant, fontSize: 13)),
                        ]),
                      ),
                      Text(rs(r['net']), style: const TextStyle(fontWeight: FontWeight.w800)),
                      const Icon(Icons.chevron_right),
                    ]),
                  );
                },
              );
            },
          ),
        ),
      ),
    );
  }
}

class PayslipScreen extends StatefulWidget {
  final String id;
  final String period;
  const PayslipScreen({super.key, required this.id, required this.period});
  @override
  State<PayslipScreen> createState() => _PayslipScreenState();
}

class _PayslipScreenState extends State<PayslipScreen> {
  bool _downloading = false;

  Future<void> _pdf() async {
    setState(() => _downloading = true);
    try {
      final dir = await getTemporaryDirectory();
      final path = '${dir.path}${Platform.pathSeparator}payslip-${widget.period}.pdf';
      await Api.instance.download('/payslips/${widget.id}/pdf', path);
      await OpenFilex.open(path, type: 'application/pdf');
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(periodLabel(widget.period))),
      body: Loader<Map<String, dynamic>>(
        load: () async => asMap(await Api.instance.get('/payslips/${widget.id}')),
        builder: (context, p, reload) {
          final lines = asList(p['lines']);
          final earn = lines.where((l) => l['kind'] == 'EARNING').toList();
          final ded = lines.where((l) => l['kind'] == 'DEDUCTION').toList();
          Widget row(Map<String, dynamic> l) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(children: [
                  Expanded(child: Text('${l['label']}${l['quantity'] != null ? '  (${l['quantity']})' : ''}')),
                  Text(money(l['amount'])),
                ]),
              );
          return ListView(padding: const EdgeInsets.all(16), children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(gradient: Brand.gradient, borderRadius: BorderRadius.circular(20)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Net pay', style: TextStyle(color: Colors.white70)),
                Text(rs(p['net']), style: const TextStyle(color: Colors.white, fontSize: 30, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text('Gross ${rs(p['gross'])} · Deductions ${rs(p['totalDeductions'])}', style: const TextStyle(color: Colors.white)),
              ]),
            ),
            const SectionTitle('Earnings'),
            Tile(child: Column(children: [for (final l in earn) row(l), const Divider(), Row(children: [const Expanded(child: Text('Gross pay', style: TextStyle(fontWeight: FontWeight.w700))), Text(money(p['gross']), style: const TextStyle(fontWeight: FontWeight.w700))])])),
            const SectionTitle('Deductions'),
            Tile(child: Column(children: [for (final l in ded) row(l), const Divider(), Row(children: [const Expanded(child: Text('Total deductions', style: TextStyle(fontWeight: FontWeight.w700))), Text(money(p['totalDeductions']), style: const TextStyle(fontWeight: FontWeight.w700))])])),
            const SectionTitle('Employer contributions'),
            Tile(
              child: Column(children: [
                Row(children: [const Expanded(child: Text('EPF (12%)')), Text(money(p['epfEmployer']))]),
                const SizedBox(height: 6),
                Row(children: [const Expanded(child: Text('ETF (3%)')), Text(money(p['etf']))]),
              ]),
            ),
            const SizedBox(height: 10),
            Text('Days paid ${p['workedDays']} · No-pay days ${p['noPayDays']} · Overtime ${dur(p['otMinutes'] as num?)}', style: TextStyle(color: c.onSurfaceVariant, fontSize: 13)),
            const SizedBox(height: 18),
            FilledButton.icon(onPressed: _downloading ? null : _pdf, icon: const Icon(Icons.picture_as_pdf_outlined), label: Text(_downloading ? 'Opening…' : 'Open PDF')),
          ]);
        },
      ),
    );
  }
}
