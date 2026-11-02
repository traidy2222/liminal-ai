import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as path;
import 'package:url_launcher/url_launcher.dart';

class WorkflowDeliverables extends StatelessWidget {
  const WorkflowDeliverables({super.key, required this.output});
  final String output;
  @override
  Widget build(BuildContext context) {
    Map<String, dynamic> data;
    try {
      data = jsonDecode(output) as Map<String, dynamic>;
    } catch (_) {
      return const SizedBox.shrink();
    }
    final directory = data['directory'];
    final files = data['files'];
    if (directory is! String ||
        !path.isAbsolute(directory) ||
        files is! List ||
        files.isEmpty) return const SizedBox.shrink();
    final names = files.whereType<String>().where(
        (f) => RegExp(r'^[a-z-]+\.(html|md|eml|json|diff|txt)$').hasMatch(f));
    return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Saved deliverables',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Wrap(
              spacing: 6,
              runSpacing: 6,
              children: names
                  .map((name) => OutlinedButton.icon(
                      icon: const Icon(Icons.open_in_new, size: 13),
                      label: Text(name),
                      onPressed: () async {
                        bool opened = false;
                        try {
                          opened = await launchUrl(
                              Uri.file(path.join(directory, name),
                                  windows: Platform.isWindows),
                              mode: LaunchMode.externalApplication);
                        } catch (_) {}
                        if (!opened && context.mounted)
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                              content: Text(
                                  'Could not open $name. File: ${path.join(directory, name)}')));
                      }))
                  .toList())
        ]));
  }
}
