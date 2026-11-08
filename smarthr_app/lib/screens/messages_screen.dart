import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../widgets/common.dart';

/// Chats with HR, managers and colleagues. The same conversations show in the web console.
class MessagesScreen extends StatefulWidget {
  const MessagesScreen({super.key});
  @override
  State<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends State<MessagesScreen> {
  final _key = GlobalKey<LoaderState<List<Map<String, dynamic>>>>();
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(const Duration(seconds: 20), (_) => _key.currentState?.reload());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _open(String id, String title) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(id: id, title: title)));
    _key.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    final fmt = DateFormat('d MMM');
    final tfmt = DateFormat('HH:mm');
    return Scaffold(
      appBar: AppBar(title: const Text('Messages')),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.edit_outlined),
        label: const Text('New'),
        onPressed: () async {
          final r = await Navigator.push<Map<String, dynamic>>(context, MaterialPageRoute(builder: (_) => const NewChatScreen()));
          if (r != null) _open('${r['id']}', '${r['title']}');
        },
      ),
      body: Loader<List<Map<String, dynamic>>>(
        key: _key,
        load: () async => asList(await Api.instance.get('/messages')),
        builder: (context, rows, reload) {
          if (rows.isEmpty) {
            return ListView(children: const [EmptyState(icon: Icons.chat_bubble_outline, title: 'No messages yet', text: 'Start a chat with HR, your manager or a colleague.')]);
          }
          final today = todayStr();
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
            itemCount: rows.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, i) {
              final r = rows[i];
              final last = r['last'] == null ? null : asMap(r['last']);
              final unread = (r['unread'] as num? ?? 0).toInt();
              final at = last == null ? null : DateTime.tryParse('${last['at']}');
              final local = at == null ? null : toColombo(at);
              final when = local == null ? '' : (DateFormat('yyyy-MM-dd').format(local) == today ? tfmt.format(local) : fmt.format(local));
              final title = '${r['title'] ?? 'Conversation'}';
              return Tile(
                onTap: () => _open('${r['id']}', title),
                padding: const EdgeInsets.all(14),
                child: Row(children: [
                  CircleAvatar(
                    radius: 22,
                    backgroundColor: c.primaryContainer,
                    child: r['kind'] == 'GROUP' ? Icon(Icons.groups_2_outlined, color: c.onPrimaryContainer) : Text(initials(title), style: TextStyle(color: c.onPrimaryContainer, fontWeight: FontWeight.w700)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: unread > 0 ? FontWeight.w800 : FontWeight.w600))),
                        Text(when, style: TextStyle(fontSize: 12, color: c.onSurfaceVariant)),
                      ]),
                      const SizedBox(height: 2),
                      Row(children: [
                        Expanded(
                          child: Text(
                            last == null ? 'No messages yet' : '${r['kind'] == 'GROUP' ? '${last['sender']}: ' : ''}${last['body']}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(color: c.onSurfaceVariant, fontSize: 13.5),
                          ),
                        ),
                        if (unread > 0)
                          Container(
                            margin: const EdgeInsets.only(left: 8),
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(color: c.primary, borderRadius: BorderRadius.circular(10)),
                            child: Text('$unread', style: TextStyle(color: c.onPrimary, fontSize: 11.5, fontWeight: FontWeight.w700)),
                          ),
                      ]),
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

class ChatScreen extends StatefulWidget {
  final String id;
  final String title;
  const ChatScreen({super.key, required this.id, required this.title});
  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final List<Map<String, dynamic>> _msgs = [];
  final _text = TextEditingController();
  final _scroll = ScrollController();
  Timer? _poll;
  bool _loading = true;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 5), (_) => _fetchNew());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = asMap(await Api.instance.get('/messages/${widget.id}'));
      if (!mounted) return;
      setState(() {
        _msgs
          ..clear()
          ..addAll(asList(r['messages']));
        _loading = false;
        _error = null;
      });
      _toBottom();
    } on ApiError catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.message;
        });
      }
    }
  }

  Future<void> _fetchNew() async {
    if (_msgs.isEmpty) return _load();
    try {
      final r = asMap(await Api.instance.get('/messages/${widget.id}', {'since': '${_msgs.last['createdAt']}'}));
      final add = asList(r['messages']).where((m) => !_msgs.any((x) => x['id'] == m['id'])).toList();
      if (add.isEmpty || !mounted) return;
      setState(() => _msgs.addAll(add));
      _toBottom();
    } catch (_) {}
  }

  void _toBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    });
  }

  Future<void> _send() async {
    final t = _text.text.trim();
    if (t.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await Api.instance.post('/messages/${widget.id}', {'body': t});
      _text.clear();
      await _fetchNew();
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    final tfmt = DateFormat('d MMM, HH:mm');
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Column(children: [
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? ErrorState(message: _error!, onRetry: _load)
                  : _msgs.isEmpty
                      ? const EmptyState(icon: Icons.waving_hand_outlined, title: 'Say hello')
                      : ListView.builder(
                          controller: _scroll,
                          padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
                          itemCount: _msgs.length,
                          itemBuilder: (context, i) {
                            final m = _msgs[i];
                            final mine = m['mine'] == true;
                            final prev = i > 0 ? _msgs[i - 1] : null;
                            final showName = !mine && (prev == null || asMap(prev['sender'])['id'] != asMap(m['sender'])['id']);
                            final at = DateTime.tryParse('${m['createdAt']}');
                            return Align(
                              alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                              child: Container(
                                constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * .78),
                                margin: EdgeInsets.only(top: showName ? 10 : 3),
                                padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
                                decoration: BoxDecoration(
                                  color: mine ? c.primary : c.surfaceContainerHighest,
                                  borderRadius: BorderRadius.only(
                                    topLeft: const Radius.circular(16),
                                    topRight: const Radius.circular(16),
                                    bottomLeft: Radius.circular(mine ? 16 : 4),
                                    bottomRight: Radius.circular(mine ? 4 : 16),
                                  ),
                                ),
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  if (showName) Text('${asMap(m['sender'])['name']}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: c.primary)),
                                  Text(
                                    m['deleted'] == true ? 'Message removed' : '${m['body']}',
                                    style: TextStyle(color: mine ? c.onPrimary : c.onSurface, fontStyle: m['deleted'] == true ? FontStyle.italic : null),
                                  ),
                                  if (at != null)
                                    Align(
                                      alignment: Alignment.centerRight,
                                      child: Text(tfmt.format(toColombo(at)), style: TextStyle(fontSize: 10.5, color: (mine ? c.onPrimary : c.onSurfaceVariant).withValues(alpha: .75))),
                                    ),
                                ]),
                              ),
                            );
                          },
                        ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 8, 8),
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: _text,
                  minLines: 1,
                  maxLines: 5,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(hintText: 'Write a message', isDense: true),
                ),
              ),
              const SizedBox(width: 6),
              IconButton.filled(onPressed: _sending ? null : _send, icon: const Icon(Icons.send_rounded)),
            ]),
          ),
        ),
      ]),
    );
  }
}

class NewChatScreen extends StatefulWidget {
  const NewChatScreen({super.key});
  @override
  State<NewChatScreen> createState() => _NewChatScreenState();
}

class _NewChatScreenState extends State<NewChatScreen> {
  final _q = TextEditingController();
  List<Map<String, dynamic>> _people = [];
  bool _loading = true;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _search();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _search() async {
    setState(() => _loading = true);
    try {
      final r = asList(await Api.instance.get('/messages/people', {if (_q.text.trim().isNotEmpty) 'q': _q.text.trim()}));
      if (mounted) setState(() => _people = r);
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _start(Map<String, dynamic> p) async {
    try {
      final r = asMap(await Api.instance.post('/messages', {'userIds': [p['id']]}));
      if (mounted) Navigator.pop(context, {'id': r['id'], 'title': p['name']});
    } on ApiError catch (e) {
      if (mounted) toast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('New message')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: TextField(
            controller: _q,
            autofocus: true,
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search people'),
            onChanged: (_) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 350), _search);
            },
          ),
        ),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : ListView.builder(
                  itemCount: _people.length,
                  itemBuilder: (context, i) {
                    final p = _people[i];
                    final e = p['employee'] == null ? null : asMap(p['employee']);
                    final sub = [if (e?['designation'] != null) e!['designation'], if (e?['department'] != null) asMap(e!['department'])['name']].join(' · ');
                    return ListTile(
                      leading: CircleAvatar(backgroundColor: c.primaryContainer, child: Text(initials('${p['name']}'), style: TextStyle(color: c.onPrimaryContainer, fontWeight: FontWeight.w700))),
                      title: Text('${p['name']}'),
                      subtitle: sub.isEmpty ? null : Text(sub),
                      onTap: () => _start(p),
                    );
                  },
                ),
        ),
      ]),
    );
  }
}
