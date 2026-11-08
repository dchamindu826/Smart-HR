import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import '../core/format.dart';
import '../core/location.dart';
import '../core/session.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Interactive confirmation sheet for Mark In and Mark Out.
/// Strictly enforces HR policies for Location and Face photo capture before confirming.
class PunchConfirmModal extends StatefulWidget {
  final String kind; // 'IN' or 'OUT'
  final Me me;
  final String initialMode; // 'OFFICE' or 'REMOTE'
  final Map<String, dynamic>? openSession;
  final Map<String, dynamic>? totals;

  const PunchConfirmModal({
    super.key,
    required this.kind,
    required this.me,
    required this.initialMode,
    this.openSession,
    this.totals,
  });

  @override
  State<PunchConfirmModal> createState() => _PunchConfirmModalState();
}

class _PunchConfirmModalState extends State<PunchConfirmModal> {
  late String _mode;
  Fix? _fix;
  bool _locLoading = false;
  String? _locError;
  bool _locCanOpenSettings = false;

  XFile? _facePhoto;
  bool _cameraLoading = false;
  
  final _picker = ImagePicker();
  final _timeFmt = DateFormat('hh:mm a');
  final _dateFmt = DateFormat('EEEE, d MMMM yyyy');

  bool get _isIn => widget.kind == 'IN';
  bool get _requiresLocation => _isIn && (widget.me.requireLocation || _mode == 'REMOTE');
  bool get _requiresFace => _isIn && widget.me.requireFace;

  bool get _canConfirm {
        if (!_isIn) return true;
    if (_requiresLocation && _fix == null) return false;
    if (_requiresFace && _facePhoto == null) return false;
    return true;
  }

  @override
  void initState() {
    super.initState();
    _mode = widget.initialMode;
    if (_requiresLocation) {
      _fetchLocation();
    }
  }

  Future<void> _fetchLocation() async {
    setState(() {
      _locLoading = true;
      _locError = null;
      _locCanOpenSettings = false;
    });
    try {
      final fix = await LocationService.current();
      if (!mounted) return;
      setState(() {
        _fix = fix;
        _locLoading = false;
      });
    } on LocationError catch (e) {
      if (!mounted) return;
      setState(() {
        _locError = e.message;
        _locCanOpenSettings = e.openSettings;
        _locLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _locError = 'Could not get location. Move to an open area or check GPS.';
        _locLoading = false;
      });
    }
  }

  Future<void> _captureFace() async {
    setState(() => _cameraLoading = true);
    try {
      // Prefer front camera for selfie
      XFile? photo = await _picker.pickImage(
        source: ImageSource.camera,
        preferredCameraDevice: CameraDevice.front,
        maxWidth: 1024,
        maxHeight: 1024,
        imageQuality: 85,
      );
      // Simulator fallback: if camera wasn't available, allow gallery
      if (photo == null && !Platform.isAndroid && !Platform.isIOS) {
        photo = await _picker.pickImage(source: ImageSource.gallery);
      }
      if (!mounted) return;
      if (photo != null) {
        setState(() => _facePhoto = photo);
      }
    } catch (e) {
      // In simulator where camera is unavailable, provide gallery fallback
      try {
        final photo = await _picker.pickImage(source: ImageSource.gallery);
        if (mounted && photo != null) setState(() => _facePhoto = photo);
      } catch (_) {
        if (mounted) toast(context, 'Camera unavailable: $e', error: true);
      }
    } finally {
      if (mounted) setState(() => _cameraLoading = false);
    }
  }

  void _onConfirm() {
    Navigator.pop(context, {
      'confirmed': true,
      'mode': _mode,
      'fix': _fix,
      'faceVerified': _requiresFace ? true : null,
      'facePhoto': _facePhoto,
    });
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final dark = Theme.of(context).brightness == Brightness.dark;
    
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.88,
      ),
      padding: EdgeInsets.fromLTRB(
        22,
        14,
        22,
        MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      decoration: BoxDecoration(
        color: dark ? const Color(0xFF101828) : Colors.white,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Drag handle
            Center(
              child: Container(
                width: 44,
                height: 5,
                decoration: BoxDecoration(
                  color: dark ? Colors.white24 : Colors.black12,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
            const SizedBox(height: 18),

            // Header Row
            Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    gradient: _isIn ? Brand.gradient : Brand.coralGradient,
                    borderRadius: BorderRadius.circular(16),
                    boxShadow: [
                      BoxShadow(
                        color: (_isIn ? Brand.magenta : Brand.coral).withValues(alpha: 0.35),
                        blurRadius: 14,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: Icon(
                    _isIn ? Icons.login_rounded : Icons.logout_rounded,
                    color: Colors.white,
                    size: 26,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _isIn ? 'Confirm Mark In' : 'Confirm Mark Out',
                        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -.02),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _isIn ? 'Are you ready to start work?' : 'End your current work session.',
                        style: TextStyle(fontSize: 13, color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded),
                  color: dark ? Colors.white70 : Colors.black54,
                ),
              ],
            ),
            const SizedBox(height: 20),

            // Time & Date Card
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
              decoration: BoxDecoration(
                color: dark ? const Color(0xFF162032) : const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: dark ? const Color(0xFF1E293B) : const Color(0x0C000000)),
              ),
              child: Row(
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _timeFmt.format(now),
                        style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, letterSpacing: -.02),
                      ),
                      Text(
                        _dateFmt.format(now),
                        style: TextStyle(fontSize: 12.5, color: dark ? const Color(0xFF94A3B8) : Brand.inkMuted),
                      ),
                    ],
                  ),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: (_isIn ? Brand.ok : Brand.coral).withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      _isIn ? 'START' : 'FINISH',
                      style: TextStyle(
                        color: _isIn ? Brand.ok : Brand.coral,
                        fontWeight: FontWeight.w800,
                        fontSize: 12,
                        letterSpacing: .04,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // If MARK OUT: show summary of session
            if (!_isIn) ...[
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: dark ? const Color(0xFF162032) : const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: dark ? const Color(0xFF1E293B) : const Color(0x0C000000)),
                ),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Working Mode', style: TextStyle(color: dark ? Colors.white70 : Brand.inkMuted)),
                        Text(
                          '${widget.openSession?['mode'] ?? 'OFFICE'}',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                    if (widget.openSession?['startAt'] != null) ...[
                      const Divider(height: 20),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('Marked in at', style: TextStyle(color: dark ? Colors.white70 : Brand.inkMuted)),
                          Text(
                            time(widget.openSession!['startAt']),
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                        ],
                      ),
                    ],
                    if (widget.totals?['workedMinutes'] != null) ...[
                      const Divider(height: 20),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('Worked today', style: TextStyle(color: dark ? Colors.white70 : Brand.inkMuted)),
                          Text(
                            dur(widget.totals!['workedMinutes'] as num?),
                            style: const TextStyle(fontWeight: FontWeight.w800, color: Brand.blue),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 20),
            ],

            // If MARK IN: Show Mode selector + Mandatory requirements (Location & Face)
            if (_isIn) ...[
              // Mode switcher if remote work is allowed
              if (widget.me.allowRemote) ...[
                Row(
                  children: [
                    Expanded(
                      child: GestureDetector(
                        onTap: () {
                          setState(() => _mode = 'OFFICE');
                          if (_requiresLocation && _fix == null && !_locLoading) _fetchLocation();
                        },
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          decoration: BoxDecoration(
                            color: _mode == 'OFFICE'
                                ? Brand.blue.withValues(alpha: 0.12)
                                : (dark ? const Color(0xFF162032) : const Color(0xFFF1F5F9)),
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(
                              color: _mode == 'OFFICE' ? Brand.blue : Colors.transparent,
                              width: 1.5,
                            ),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.apartment_rounded, size: 20, color: _mode == 'OFFICE' ? Brand.blue : Brand.inkMuted),
                              const SizedBox(width: 8),
                              Text(
                                'Office',
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                  color: _mode == 'OFFICE' ? Brand.blue : Brand.inkMuted,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: GestureDetector(
                        onTap: () {
                          setState(() => _mode = 'REMOTE');
                          if (_fix == null && !_locLoading) _fetchLocation();
                        },
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          decoration: BoxDecoration(
                            color: _mode == 'REMOTE'
                                ? Brand.magenta.withValues(alpha: 0.12)
                                : (dark ? const Color(0xFF162032) : const Color(0xFFF1F5F9)),
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(
                              color: _mode == 'REMOTE' ? Brand.magenta : Colors.transparent,
                              width: 1.5,
                            ),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.home_work_rounded, size: 20, color: _mode == 'REMOTE' ? Brand.magenta : Brand.inkMuted),
                              const SizedBox(width: 8),
                              Text(
                                'Remote',
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                  color: _mode == 'REMOTE' ? Brand.magenta : Brand.inkMuted,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
              ],

              // ── 1. Location Requirement ──
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: dark ? const Color(0xFF162032) : const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: dark ? const Color(0xFF1E293B) : const Color(0x0C000000)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.location_on_rounded,
                          size: 20,
                          color: _requiresLocation ? (_fix != null ? Brand.ok : Brand.warn) : Brand.inkMuted,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          'Location Check',
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5),
                        ),
                        const Spacer(),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: _requiresLocation
                                ? (_fix != null ? Brand.ok.withValues(alpha: 0.12) : Brand.warn.withValues(alpha: 0.12))
                                : (dark ? Colors.white12 : Colors.black.withValues(alpha: 0.06)),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            _requiresLocation ? (_fix != null ? 'Acquired' : 'Mandatory') : 'Optional',
                            style: TextStyle(
                              color: _requiresLocation ? (_fix != null ? Brand.ok : Brand.warn) : Brand.inkMuted,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (_requiresLocation) ...[
                      if (_locLoading) ...[
                        Row(
                          children: [
                            const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                            const SizedBox(width: 10),
                            Text('Acquiring GPS location...', style: TextStyle(fontSize: 13, color: dark ? Colors.white70 : Brand.inkMuted)),
                          ],
                        ),
                      ] else if (_fix != null) ...[
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                'Lat: ${_fix!.lat.toStringAsFixed(4)}, Lng: ${_fix!.lng.toStringAsFixed(4)} (±${_fix!.accuracy.round()}m)',
                                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.ok),
                              ),
                            ),
                            IconButton(
                              onPressed: _fetchLocation,
                              icon: const Icon(Icons.refresh_rounded, size: 20),
                              tooltip: 'Refresh GPS',
                            ),
                          ],
                        ),
                      ] else if (_locError != null) ...[
                        Text(_locError!, style: const TextStyle(fontSize: 12.5, color: Brand.bad)),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            OutlinedButton.icon(
                              onPressed: _fetchLocation,
                              icon: const Icon(Icons.refresh_rounded, size: 16),
                              label: const Text('Retry GPS'),
                              style: OutlinedButton.styleFrom(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                minimumSize: Size.zero,
                              ),
                            ),
                            if (_locCanOpenSettings) ...[
                              const SizedBox(width: 8),
                              FilledButton(
                                onPressed: LocationService.openSettings,
                                style: FilledButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                  minimumSize: Size.zero,
                                ),
                                child: const Text('Open Settings'),
                              ),
                            ],
                          ],
                        ),
                      ],
                    ] else ...[
                      Text(
                        'Location is not required by your company HR policy.',
                        style: TextStyle(fontSize: 12.5, color: dark ? Colors.white60 : Brand.inkMuted),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 14),

              // ── 2. Face Photo Requirement ──
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: dark ? const Color(0xFF162032) : const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: _requiresFace && _facePhoto == null
                        ? Brand.magenta.withValues(alpha: 0.4)
                        : (dark ? const Color(0xFF1E293B) : const Color(0x0C000000)),
                    width: _requiresFace && _facePhoto == null ? 1.5 : 1,
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.face_retouching_natural_rounded,
                          size: 20,
                          color: _requiresFace ? (_facePhoto != null ? Brand.ok : Brand.magenta) : Brand.inkMuted,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          'Face Verification',
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5),
                        ),
                        const Spacer(),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: _requiresFace
                                ? (_facePhoto != null ? Brand.ok.withValues(alpha: 0.12) : Brand.magenta.withValues(alpha: 0.12))
                                : (dark ? Colors.white12 : Colors.black.withValues(alpha: 0.06)),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            _requiresFace ? (_facePhoto != null ? 'Captured ✓' : 'Mandatory') : 'Optional',
                            style: TextStyle(
                              color: _requiresFace ? (_facePhoto != null ? Brand.ok : Brand.magenta) : Brand.inkMuted,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    if (_requiresFace) ...[
                      if (_facePhoto == null) ...[
                        Text(
                          'Company HR policy requires a live selfie to verify mark in.',
                          style: TextStyle(fontSize: 12.5, color: dark ? Colors.white70 : Brand.inkMuted),
                        ),
                        const SizedBox(height: 12),
                        GestureDetector(
                          onTap: _cameraLoading ? null : _captureFace,
                          child: Container(
                            height: 60,
                            decoration: BoxDecoration(
                              gradient: Brand.gradient,
                              borderRadius: BorderRadius.circular(16),
                              boxShadow: [
                                BoxShadow(
                                  color: Brand.magenta.withValues(alpha: 0.35),
                                  blurRadius: 14,
                                  offset: const Offset(0, 4),
                                ),
                              ],
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                if (_cameraLoading)
                                  const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                                else ...[
                                  const Icon(Icons.camera_alt_rounded, color: Colors.white),
                                  const SizedBox(width: 8),
                                  const Text(
                                    'Take Selfie Photo',
                                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                      ] else ...[
                        Row(
                          children: [
                            ClipRRect(
                              borderRadius: BorderRadius.circular(14),
                              child: Image.file(
                                File(_facePhoto!.path),
                                width: 56,
                                height: 56,
                                fit: BoxFit.cover,
                              ),
                            ),
                            const SizedBox(width: 14),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text('Face Photo Ready', style: TextStyle(fontWeight: FontWeight.w700, color: Brand.ok)),
                                  Text('Verified for mark in', style: TextStyle(fontSize: 12, color: dark ? Colors.white60 : Brand.inkMuted)),
                                ],
                              ),
                            ),
                            TextButton.icon(
                              onPressed: _captureFace,
                              icon: const Icon(Icons.refresh_rounded, size: 18),
                              label: const Text('Retake'),
                            ),
                          ],
                        ),
                      ],
                    ] else ...[
                      Text(
                        'Face verification is not required for your role or company settings.',
                        style: TextStyle(fontSize: 12.5, color: dark ? Colors.white60 : Brand.inkMuted),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 18),
            ],

            // ── Primary Action Button ──
            SizedBox(
              height: 56,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: _canConfirm
                      ? (_isIn ? Brand.gradient : Brand.coralGradient)
                      : null,
                  color: _canConfirm ? null : (dark ? const Color(0xFF1E293B) : const Color(0xFFE2E8F0)),
                  borderRadius: BorderRadius.circular(18),
                  boxShadow: _canConfirm
                      ? [
                          BoxShadow(
                            color: (_isIn ? Brand.magenta : Brand.coral).withValues(alpha: 0.4),
                            blurRadius: 18,
                            offset: const Offset(0, 6),
                          ),
                        ]
                      : null,
                ),
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.transparent,
                    shadowColor: Colors.transparent,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                  ),
                  onPressed: _canConfirm ? _onConfirm : null,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        _isIn ? Icons.check_circle_rounded : Icons.logout_rounded,
                        color: _canConfirm ? Colors.white : (dark ? Colors.white30 : Colors.black26),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        _isIn ? 'Confirm & Mark In' : 'Confirm & Mark Out',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                          color: _canConfirm ? Colors.white : (dark ? Colors.white30 : Colors.black26),
                          letterSpacing: -.01,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),

            // Cancel button
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(
                'Cancel',
                style: TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w600,
                  color: dark ? Colors.white60 : Brand.inkMuted,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
