import 'package:flutter/material.dart';

/// Tracks dictated text span inside a [TextEditingController].
class ComposerDictationSpan {
  ComposerDictationSpan(this.controller);

  final TextEditingController controller;
  int spanStart = 0;
  int committedLen = 0;
  int previewLen = 0;

  void onStart() {
    spanStart = controller.text.length;
    committedLen = 0;
    previewLen = 0;
  }

  void appendFinal(String text) {
    if (text.trim().isEmpty) return;
    final prev = controller.text;
    final baseEnd = spanStart + committedLen;
    final base = prev.substring(0, baseEnd);
    final after = prev.substring(baseEnd + previewLen);
    final sep = base.isNotEmpty && !base.endsWith(' ') ? ' ' : '';
    final insertion = '$sep${text.trim()}';
    committedLen += insertion.length;
    previewLen = 0;
    controller.text = base + insertion + after;
  }

  void setInterim(String text) {
    final prev = controller.text;
    final baseEnd = spanStart + committedLen;
    final base = prev.substring(0, baseEnd);
    final after = prev.substring(baseEnd + previewLen);
    final sep = base.isNotEmpty && !base.endsWith(' ') ? ' ' : '';
    final insertion = '$sep${text.trim()}';
    previewLen = insertion.length;
    controller.text = base + insertion + after;
  }

  void replaceWithRefined(String refinedText) {
    final prev = controller.text;
    final base = prev.substring(0, spanStart);
    final totalSpan = committedLen + previewLen;
    final after = prev.substring(spanStart + totalSpan);
    final sep = base.isNotEmpty && !base.endsWith(' ') ? ' ' : '';
    final insertion = '$sep${refinedText.trim()}';
    committedLen = insertion.length;
    previewLen = 0;
    controller.text = base + insertion + after;
  }

  String buildFullMessageForAutoSend() {
    final prev = controller.text;
    final dictated = prev
        .substring(
          spanStart,
          spanStart + committedLen + previewLen,
        )
        .trim();
    if (dictated.isEmpty) return '';
    final pre = prev.substring(0, spanStart);
    final sep = pre.isNotEmpty && !pre.endsWith(' ') ? ' ' : '';
    return (pre + sep + dictated).trim();
  }

  void clearAfterSend() {
    spanStart = 0;
    committedLen = 0;
    previewLen = 0;
  }
}
