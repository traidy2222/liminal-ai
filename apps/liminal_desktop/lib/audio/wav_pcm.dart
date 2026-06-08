import 'dart:typed_data';

/// Build a mono 16-bit PCM WAV from raw s16le samples (16 kHz default).
Uint8List buildWavFromPcm16(
  Uint8List pcm, {
  int sampleRate = 16000,
  int channels = 1,
}) {
  final bitsPerSample = 16;
  final byteRate = sampleRate * channels * (bitsPerSample ~/ 8);
  final blockAlign = channels * (bitsPerSample ~/ 8);
  final dataLen = pcm.length;
  final out = Uint8List(44 + dataLen);
  final h = ByteData.sublistView(out, 0, 44);

  void writeFourCC(int offset, String s) {
    for (var i = 0; i < 4; i++) {
      h.setUint8(offset + i, s.codeUnitAt(i));
    }
  }

  writeFourCC(0, 'RIFF');
  h.setUint32(4, 36 + dataLen, Endian.little);
  writeFourCC(8, 'WAVE');
  writeFourCC(12, 'fmt ');
  h.setUint32(16, 16, Endian.little);
  h.setUint16(20, 1, Endian.little);
  h.setUint16(22, channels, Endian.little);
  h.setUint32(24, sampleRate, Endian.little);
  h.setUint32(28, byteRate, Endian.little);
  h.setUint16(32, blockAlign, Endian.little);
  h.setUint16(34, bitsPerSample, Endian.little);
  writeFourCC(36, 'data');
  h.setUint32(40, dataLen, Endian.little);
  out.setRange(44, 44 + dataLen, pcm);
  return out;
}
