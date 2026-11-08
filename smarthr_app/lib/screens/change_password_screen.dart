import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../widgets/common.dart';

class ChangePasswordScreen extends StatefulWidget {
  final bool firstTime;
  const ChangePasswordScreen({super.key, this.firstTime = false});
  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _cur = TextEditingController();
  final _new = TextEditingController();
  final _again = TextEditingController();
  String? _error;
  bool _busy = false;

  Future<void> _save() async {
    final pw = _new.text;
    if (pw.length < 8 || !RegExp(r'[A-Za-z]').hasMatch(pw) || !RegExp(r'\d').hasMatch(pw)) {
      setState(() => _error = 'Use at least 8 characters, with letters and a number.');
      return;
    }
    if (pw != _again.text) {
      setState(() => _error = 'The two new passwords do not match.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<Session>().changePassword(_cur.text, pw);
      if (!mounted) return;
      toast(context, 'Password changed.');
      if (!widget.firstTime) Navigator.pop(context);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.firstTime ? 'Set your password' : 'Change password'),
        actions: [if (widget.firstTime) TextButton(onPressed: () => context.read<Session>().logout(), child: const Text('Log out'))],
      ),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        if (widget.firstTime) const Padding(padding: EdgeInsets.only(bottom: 16), child: Text('Choose a password only you know. You will use it from now on.')),
        TextField(controller: _cur, obscureText: true, decoration: InputDecoration(labelText: widget.firstTime ? 'Temporary password' : 'Current password')),
        const SizedBox(height: 14),
        TextField(controller: _new, obscureText: true, decoration: const InputDecoration(labelText: 'New password', helperText: 'At least 8 characters, letters and a number')),
        const SizedBox(height: 14),
        TextField(controller: _again, obscureText: true, decoration: const InputDecoration(labelText: 'Type the new password again')),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 14), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        const SizedBox(height: 22),
        FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'Saving…' : 'Save password')),
      ]),
    );
  }
}
