import 'package:flutter/material.dart';

import '../../theme/liminal_theme_extension.dart';

/// Settings / list filter field with search icon.
class LiminalSearchField extends StatefulWidget {
  const LiminalSearchField({
    super.key,
    required this.controller,
    this.hintText = 'Search settings…',
    this.onChanged,
  });

  final TextEditingController controller;
  final String hintText;
  final ValueChanged<String>? onChanged;

  @override
  State<LiminalSearchField> createState() => _LiminalSearchFieldState();
}

class _LiminalSearchFieldState extends State<LiminalSearchField> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onTextChanged);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onTextChanged);
    super.dispose();
  }

  void _onTextChanged() => setState(() {});

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return TextField(
      controller: widget.controller,
      onChanged: widget.onChanged,
      decoration: InputDecoration(
        hintText: widget.hintText,
        prefixIcon: Icon(Icons.search, color: lim.textDim, size: 20),
        suffixIcon: widget.controller.text.isEmpty
            ? null
            : IconButton(
                tooltip: 'Clear',
                icon: Icon(Icons.close, size: 18, color: lim.textMuted),
                onPressed: () {
                  widget.controller.clear();
                  widget.onChanged?.call('');
                },
              ),
      ),
    );
  }
}
