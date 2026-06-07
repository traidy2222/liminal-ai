import 'package:desktop_multi_window/desktop_multi_window.dart';

/// Cross-window RPC: sub-windows invoke; main window handles get_state / refresh.
const liminalAppsMethodChannel = WindowMethodChannel(
  'liminal_apps',
  mode: ChannelMode.unidirectional,
);
