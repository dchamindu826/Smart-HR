import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../theme.dart';

/// Loads data and shows loading / error / content, with pull-to-refresh.
class Loader<T> extends StatefulWidget {
  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;
  const Loader({super.key, required this.load, required this.builder});
  @override
  State<Loader<T>> createState() => LoaderState<T>();
}

class LoaderState<T> extends State<Loader<T>> {
  T? data;
  String? error;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    setState(() => loading = true);
    try {
      final d = await widget.load();
      if (!mounted) return;
      setState(() {
        data = d;
        error = null;
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        error = ApiError.from(e).message;
        loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (data == null && loading) return const Center(child: CircularProgressIndicator());
    if (data == null) {
      return RefreshIndicator(
        onRefresh: reload,
        child: ListView(children: [
          const SizedBox(height: 80),
          ErrorState(message: error ?? 'Could not load.', onRetry: reload),
        ]),
      );
    }
    return RefreshIndicator(onRefresh: reload, child: widget.builder(context, data as T, reload));
  }
}

class ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  const ErrorState({super.key, required this.message, this.onRetry});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(children: [
        Icon(Icons.cloud_off_outlined, size: 40, color: Theme.of(context).colorScheme.outline),
        const SizedBox(height: 10),
        Text(message, textAlign: TextAlign.center),
        if (onRetry != null) ...[const SizedBox(height: 12), OutlinedButton(onPressed: onRetry, child: const Text('Try again'))],
      ]),
    );
  }
}

class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? text;
  const EmptyState({super.key, required this.icon, required this.title, this.text});
  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
      child: Column(children: [
        Icon(icon, size: 40, color: c.outline),
        const SizedBox(height: 10),
        Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
        if (text != null) ...[const SizedBox(height: 4), Text(text!, textAlign: TextAlign.center, style: TextStyle(color: c.onSurfaceVariant))],
      ]),
    );
  }
}

/// A rounded modern card tile matching the design system.
class Tile extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final Gradient? glow;
  const Tile({super.key, required this.child, this.padding = const EdgeInsets.all(18), this.onTap, this.glow});
  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final card = Theme.of(context).colorScheme.surface;
    final body = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: card,
        gradient: glow,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: dark ? const Color(0xFF1E293B) : const Color(0x0A000000),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: dark ? Colors.black.withValues(alpha: 0.28) : const Color(0x0A0F172A),
            blurRadius: 20,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: child,
    );
    if (onTap == null) return body;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: onTap,
        child: body,
      ),
    );
  }
}

class StatusPill extends StatelessWidget {
  final String status;
  final String? text;
  const StatusPill(this.status, {super.key, this.text});
  static Color colorFor(String s) {
    switch (s) {
      case 'APPROVED':
      case 'PRESENT':
      case 'IN':
      case 'LOCKED':
        return Brand.ok;
      case 'PENDING':
      case 'NEEDS_REASON':
      case 'INCOMPLETE':
        return Brand.warn;
      case 'REJECTED':
      case 'ABSENT':
        return Brand.bad;
      case 'LEAVE':
      case 'HALF_LEAVE':
      case 'HOLIDAY':
        return Brand.magenta;
      default:
        return Brand.blue;
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = colorFor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 4),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        text ?? label(status),
        style: TextStyle(color: c, fontSize: 12, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class SectionTitle extends StatelessWidget {
  final String text;
  final Widget? trailing;
  const SectionTitle(this.text, {super.key, this.trailing});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 18, 4, 8),
        child: Row(children: [
          Expanded(child: Text(text, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
          if (trailing != null) trailing!,
        ]),
      );
}

void toast(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
    content: Text(message),
    backgroundColor: error ? Brand.bad : null,
    behavior: SnackBarBehavior.floating,
  ));
}

/// Ask for text (a reason). Returns null if cancelled.
Future<String?> askText(BuildContext context, {required String title, required String label, int minLength = 0, String ok = 'Send'}) async {
  final ctrl = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setS) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          maxLines: 3,
          decoration: InputDecoration(labelText: label, helperText: minLength > 0 ? 'At least $minLength characters' : null),
          onChanged: (_) => setS(() {}),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: ctrl.text.trim().length >= minLength ? () => Navigator.pop(ctx, ctrl.text.trim()) : null, child: Text(ok)),
        ],
      ),
    ),
  );
}

Future<bool> confirm(BuildContext context, {required String title, String? body, String ok = 'Confirm', bool danger = false}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: body == null ? null : Text(body),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        FilledButton(
          style: danger ? FilledButton.styleFrom(backgroundColor: Brand.bad) : null,
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(ok),
        ),
      ],
    ),
  );
  return r == true;
}

List<Map<String, dynamic>> asList(dynamic v) => ((v as List?) ?? []).map((e) => (e as Map).cast<String, dynamic>()).toList();
Map<String, dynamic> asMap(dynamic v) => ((v as Map?) ?? {}).cast<String, dynamic>();
