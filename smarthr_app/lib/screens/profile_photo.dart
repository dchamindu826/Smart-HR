import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../core/api.dart';
import '../core/session.dart';
import '../widgets/avatar.dart';
import '../widgets/common.dart';

Future<void> changeProfilePhoto(BuildContext context) async {
  final session = context.read<Session>();
  final me = session.me;
  if (me == null) return;
  final picker = ImagePicker();

  final action = await showModalBottomSheet<String>(
    context: context,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 8),
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.grey.withValues(alpha: 0.3),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 12),
          ListTile(
            leading: const Icon(Icons.camera_alt_outlined),
            title: const Text('Take a photo'),
            onTap: () => Navigator.pop(ctx, 'camera'),
          ),
          ListTile(
            leading: const Icon(Icons.photo_library_outlined),
            title: const Text('Choose from library'),
            onTap: () => Navigator.pop(ctx, 'gallery'),
          ),
          if (me.hasPhoto)
            ListTile(
              leading: const Icon(Icons.delete_outline, color: Colors.red),
              title: const Text('Remove photo', style: TextStyle(color: Colors.red)),
              onTap: () => Navigator.pop(ctx, 'remove'),
            ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );

  if (action == null || !context.mounted) return;

  try {
    if (action == 'remove') {
      await Api.instance.delete('/me/photo');
      PhotoCache.bump('/me/photo');
      await session.reloadMe();
      if (context.mounted) toast(context, 'Photo removed.');
      return;
    }

    final source = action == 'camera' ? ImageSource.camera : ImageSource.gallery;
    final photo = await picker.pickImage(
      source: source,
      maxWidth: 800,
      maxHeight: 800,
      imageQuality: 85,
      preferredCameraDevice: CameraDevice.front,
    );

    if (photo == null || !context.mounted) return;

    await Api.instance.upload('/me/photo', photo.path, filename: 'photo.jpg');
    PhotoCache.bump('/me/photo');
    await session.reloadMe();
    if (context.mounted) toast(context, 'Photo updated. HR sees it too.');
  } on ApiError catch (e) {
    if (context.mounted) toast(context, e.message, error: true);
  } catch (e) {
    if (context.mounted) toast(context, 'Failed to update photo: $e', error: true);
  }
}

Future<void> setBirthdayVisible(BuildContext context, bool visible) async {
  final session = context.read<Session>();
  try {
    await Api.instance.patch('/me/preferences', {'birthdayOptOut': !visible});
    await session.reloadMe();
    if (context.mounted) {
      toast(
        context,
        visible ? 'Birthday is now visible to colleagues.' : 'Birthday is hidden from colleagues.',
      );
    }
  } on ApiError catch (e) {
    if (context.mounted) toast(context, e.message, error: true);
  } catch (e) {
    if (context.mounted) toast(context, 'Could not update preference.', error: true);
  }
}
