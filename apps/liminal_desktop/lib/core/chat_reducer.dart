import 'dart:convert';

import '../state/message_models.dart';
import 'chat_transcript_state.dart';
import 'tool_wire.dart';

const _reasoningTools = {'think', 'reason', 'plan', 'hypothesize', 'breakdown'};
const _orchTools = {
  'spawn_agent',
  'wait_for_agents',
  'cancel_agent',
  'list_agents',
};

/// Pure reducer: maps a harness wire event → next transcript state (web `useSSE` parity).
ChatTranscriptState reduceChatEvent(
  ChatTranscriptState state,
  String event,
  Map<String, dynamic> data,
) {
  switch (event) {
    case 'text':
      return _onText(state, data);
    case 'provider_retry':
      final attempt = data['attempt'];
      final max = data['maxAttempts'];
      final msg = data['message'] as String? ?? 'retrying';
      return state.copyWith(
        messages: [
          ...state.messages,
          ProviderRetryMessage('Provider retry $attempt/$max: $msg'),
        ],
      );
    case 'tool_start':
      return _onToolStart(state, data);
    case 'tool_delta':
      return _onToolDelta(state, data);
    case 'tool_approval':
      return _onToolApproval(state, data);
    case 'approval_decision':
      return state.copyWith(clearPendingApproval: true);
    case 'tool_result':
      return _onToolResult(state, data);
    case 'ask_user':
      return state.copyWith(
        pendingAskUser: PendingAskUser(data['prompt'] as String? ?? ''),
      );
    case 'ask_user_answered':
      return state.copyWith(clearPendingAskUser: true);
    case 'turn_end':
      return _onTurnEnd(state, data);
    case 'turn_summary':
      return state.copyWith(
        messages: [
          ...state.messages,
          TurnHeaderMessage(
            intentClass: data['intentClass'] as String? ?? '',
            outcomeScore: (data['outcomeScore'] as num?)?.toDouble() ?? 0,
            toolCount: (data['toolCount'] as num?)?.toInt() ?? 0,
            durationMs: (data['durationMs'] as num?)?.toInt() ?? 0,
            keyTools: (data['keyTools'] as List<dynamic>?)
                    ?.map((e) => e.toString())
                    .toList() ??
                const [],
            terminationReason: data['terminationReason'] as String? ?? '',
          ),
        ],
      );
    case 'error': {
      final finalized = _finalizeStreaming(state);
      return finalized.copyWith(
        busy: false,
        messages: [
          ...finalized.messages,
          ErrorMessage(data['message'] as String? ?? 'Unknown error'),
        ],
      );
    }
    case 'harness_running':
      return state.copyWith(busy: true);
    case 'persona_bootstrap_progress':
      return state.copyWith(
        busy: true,
        personaBootstrapStage: data['stage'] as String?,
        personaBootstrapProgress: data['message'] as String? ?? '',
      );
    case 'context_compressed':
      return state.copyWith(
        messages: [
          ...state.messages,
          ContextCompressedMessage(
            beforePct: (data['beforePct'] as num?)?.toDouble() ?? 0,
            afterPct: (data['afterPct'] as num?)?.toDouble() ?? 0,
            rounds: (data['rounds'] as num?)?.toInt() ?? 0,
          ),
        ],
      );
    case 'subtask_spawned':
      return state.copyWith(
        messages: [
          ...state.messages,
          SubtaskMessage(
            taskId: data['taskId'] as String? ?? '',
            parentTaskId: data['parentTaskId'] as String? ?? '',
            goal: data['goal'] as String? ?? '',
            depth: (data['depth'] as num?)?.toInt() ?? 0,
            status: SubtaskStatus.running,
          ),
        ],
      );
    case 'subtask_output':
      return _mapSubtask(state, data['taskId'] as String?, (m) {
        m.partialOutput += data['delta'] as String? ?? '';
        return m;
      });
    case 'subtask_done':
      return _mapSubtask(state, data['taskId'] as String?, (m) {
        m.status = SubtaskStatus.done;
        m.finalOutput = data['output'] as String? ?? m.partialOutput;
        return m;
      });
    case 'subtask_error':
      return _mapSubtask(state, data['taskId'] as String?, (m) {
        m.status = SubtaskStatus.error;
        m.finalOutput = data['error'] as String? ?? 'subtask failed';
        return m;
      });
    case 'session_reset':
      return ChatTranscriptState.initial;
    default:
      return state;
  }
}

ChatTranscriptState applyUserMessage(
  ChatTranscriptState state,
  String text, {
  List<UserAttachmentPreview> attachmentPreviews = const [],
}) {
  return state.copyWith(
    messages: [
      ...state.messages,
      UserMessage(text, attachmentPreviews: attachmentPreviews),
    ],
    busy: true,
    clearConnectionError: true,
  );
}

ChatTranscriptState _onText(ChatTranscriptState state, Map<String, dynamic> data) {
  final delta = data['delta'] as String? ?? '';
  final channel = data['channel'] as String? ?? 'user';
  if (delta.isEmpty) return state;
  if (channel == 'trace') {
    return state.copyWith(messages: [...state.messages, TraceMessage(delta)]);
  }
  if (channel == 'reasoning') {
    return _appendModelReasoning(state, delta);
  }
  return _appendAssistant(state, delta);
}

ChatTranscriptState _appendAssistant(ChatTranscriptState state, String delta) {
  final msgs = List<MessageEntry>.from(state.messages);
  if (msgs.isNotEmpty) {
    final last = msgs.last;
    if (last is AssistantMessage && last.streaming) {
      last.text += delta;
      return state.copyWith(messages: msgs);
    }
  }
  msgs.add(AssistantMessage(text: delta, streaming: true));
  return state.copyWith(messages: msgs);
}

ChatTranscriptState _appendModelReasoning(ChatTranscriptState state, String delta) {
  final msgs = List<MessageEntry>.from(state.messages);
  if (msgs.isNotEmpty) {
    final last = msgs.last;
    if (last is ModelReasoningMessage && last.streaming) {
      last.text += delta;
      return state.copyWith(messages: msgs);
    }
  }
  msgs.add(ModelReasoningMessage(text: delta, streaming: true));
  return state.copyWith(messages: msgs);
}

ChatTranscriptState _onToolStart(ChatTranscriptState state, Map<String, dynamic> data) {
  final callId = data['callId'] as String;
  final name = data['name'] as String;
  final base = _finalizeStreaming(state);
  if (name == 'think') {
    return base.copyWith(
      messages: [
        ...base.messages,
        ThinkMessage(callId: callId, streaming: true),
      ],
    );
  }
  if (name == 'reason') {
    return base.copyWith(
      messages: [
        ...base.messages,
        ReasonMessage(callId: callId, streaming: true),
      ],
    );
  }
  if (name == 'plan') {
    return base.copyWith(
      messages: [
        ...base.messages,
        PlanMessage(callId: callId, streaming: true),
      ],
    );
  }
  if (_orchTools.contains(name)) return base;
  return base.copyWith(
    messages: [
      ...base.messages,
      ToolCallMessage(
        callId: callId,
        name: name,
        status: ToolCallStatus.streaming,
        startedAt: DateTime.now().millisecondsSinceEpoch,
      ),
    ],
  );
}

ChatTranscriptState _onToolDelta(ChatTranscriptState state, Map<String, dynamic> data) {
  final callId = data['callId'] as String;
  final argsDelta = data['argsDelta'] as String? ?? '';
  final msgs = List<MessageEntry>.from(state.messages);
  for (var i = 0; i < msgs.length; i++) {
    final m = msgs[i];
    if (m is ThinkMessage && m.callId == callId && m.streaming) {
      m.argsPreview += argsDelta;
      m.content = _extractJsonString(m.argsPreview, 'content') ?? m.content;
      return state.copyWith(messages: msgs);
    }
    if (m is ReasonMessage && m.callId == callId && m.streaming) {
      m.argsPreview += argsDelta;
      m.inference = _extractJsonString(m.argsPreview, 'inference') ?? m.inference;
      return state.copyWith(messages: msgs);
    }
    if (m is PlanMessage && m.callId == callId && m.streaming) {
      m.argsPreview += argsDelta;
      return state.copyWith(messages: msgs);
    }
    if (m is ToolCallMessage && m.callId == callId) {
      m.argsPreview += argsDelta;
      return state.copyWith(messages: msgs);
    }
  }
  return state;
}

ChatTranscriptState _onToolApproval(ChatTranscriptState state, Map<String, dynamic> data) {
  final callId = data['callId'] as String;
  final msgs = List<MessageEntry>.from(state.messages);
  for (final m in msgs) {
    if (m is ToolCallMessage && m.callId == callId) {
      m.status = ToolCallStatus.pendingApproval;
    }
  }
  return state.copyWith(
    messages: msgs,
    pendingApproval: PendingApproval(
      callId: callId,
      name: data['name'] as String,
      args: Map<String, dynamic>.from(data['args'] as Map? ?? {}),
      approvalNonce: data['approvalNonce'] as String,
      approvalTimeoutMs: (data['approvalTimeoutMs'] as num?)?.toInt() ?? 120000,
    ),
  );
}

ChatTranscriptState _onToolResult(ChatTranscriptState state, Map<String, dynamic> data) {
  final callId = data['callId'] as String;
  final name = data['name'] as String? ?? '';
  final parsed = parseWireToolResult(data);
  final ok = parsed.ok;
  final output = parsed.output;
  final args = Map<String, dynamic>.from(data['args'] as Map? ?? {});

  if (name == 'think' && ok) {
    return _replaceStreamingThink(state, callId, args);
  }
  if (name == 'reason' && ok) {
    return _replaceStreamingReason(state, callId, args);
  }
  if (name == 'plan' && ok) {
    return _replaceStreamingPlan(state, callId, args);
  }
  if (_reasoningTools.contains(name) || _orchTools.contains(name)) {
    return state;
  }

  final msgs = List<MessageEntry>.from(state.messages);
  final argsJson = args.isNotEmpty ? jsonEncode(args) : '';
  var matched = false;
  for (final m in msgs) {
    if (m is ToolCallMessage && m.callId == callId) {
      matched = true;
      m.status = ok ? ToolCallStatus.done : ToolCallStatus.error;
      m.output = output;
      if (argsJson.isNotEmpty) m.argsPreview = argsJson;
    }
  }
  if (!matched) {
    msgs.add(
      ToolCallMessage(
        callId: callId,
        name: name.isNotEmpty ? name : 'tool',
        status: ok ? ToolCallStatus.done : ToolCallStatus.error,
        argsPreview: argsJson,
        output: output,
      ),
    );
  }
  return state.copyWith(
    messages: [...msgs, ToolResultMessage(callId: callId, output: output, ok: ok)],
  );
}

ChatTranscriptState _replaceStreamingThink(
  ChatTranscriptState state,
  String callId,
  Map<String, dynamic> args,
) {
  final msgs = state.messages
      .where((m) => !(m is ThinkMessage && m.streaming && m.callId == callId))
      .toList();
  msgs.add(
    ThinkMessage(
      callId: callId,
      content: (args['content'] as String?) ?? '',
      streaming: false,
    ),
  );
  return state.copyWith(messages: msgs);
}

ChatTranscriptState _replaceStreamingReason(
  ChatTranscriptState state,
  String callId,
  Map<String, dynamic> args,
) {
  final msgs = state.messages
      .where((m) => !(m is ReasonMessage && m.streaming && m.callId == callId))
      .toList();
  msgs.add(
    ReasonMessage(
      callId: callId,
      inference: (args['inference'] as String?) ?? '',
      confidence: args['confidence'] as String?,
      streaming: false,
    ),
  );
  return state.copyWith(messages: msgs);
}

ChatTranscriptState _replaceStreamingPlan(
  ChatTranscriptState state,
  String callId,
  Map<String, dynamic> args,
) {
  final steps = args['steps'] is List
      ? (args['steps'] as List).map((e) => e.toString()).toList()
      : <String>[];
  final msgs = state.messages
      .where((m) => !(m is PlanMessage && m.streaming && m.callId == callId))
      .toList();
  msgs.add(PlanMessage(callId: callId, steps: steps, streaming: false));
  return state.copyWith(messages: msgs);
}

ChatTranscriptState _onTurnEnd(ChatTranscriptState state, Map<String, dynamic> data) {
  var next = _finalizeStreaming(state).copyWith(busy: false);
  final hm = data['harnessMetrics'] as Map<String, dynamic>?;
  if (hm != null) {
    final ep = hm['epistemicState'] as Map<String, dynamic>?;
    final ex = hm['executionState'] as Map<String, dynamic>?;
    if (ep != null || ex != null) {
      final subgoals = ep?['subgoals'] as List<dynamic>?;
      final subPreview = subgoals
          ?.take(4)
          .map((g) {
            final m = g as Map<String, dynamic>;
            return '[${m['status']}] ${m['id']}';
          })
          .join(' · ');
      next = next.copyWith(
        messages: [
          ...next.messages,
          WorkingStateMessage(
            goal: ep?['goal'] as String?,
            driftScore: (ex?['driftScore'] as num?)?.toDouble(),
            subgoalsPreview: subPreview,
            executionPreview: hm['workingStatePreview'] as String?,
          ),
        ],
      );
    }
  }
  return next;
}

ChatTranscriptState _finalizeStreaming(ChatTranscriptState state) {
  final msgs = List<MessageEntry>.from(state.messages);
  for (final m in msgs) {
    if (m is AssistantMessage && m.streaming) m.streaming = false;
    if (m is ModelReasoningMessage && m.streaming) m.streaming = false;
    if (m is ToolCallMessage &&
        (m.status == ToolCallStatus.streaming || m.status == ToolCallStatus.running)) {
      m.status = ToolCallStatus.done;
    }
  }
  return state.copyWith(messages: msgs);
}

ChatTranscriptState _mapSubtask(
  ChatTranscriptState state,
  String? taskId,
  SubtaskMessage Function(SubtaskMessage) fn,
) {
  if (taskId == null) return state;
  final msgs = List<MessageEntry>.from(state.messages);
  for (var i = 0; i < msgs.length; i++) {
    if (msgs[i] is SubtaskMessage && (msgs[i] as SubtaskMessage).taskId == taskId) {
      msgs[i] = fn(msgs[i] as SubtaskMessage);
      return state.copyWith(messages: msgs);
    }
  }
  return state;
}

String? _extractJsonString(String partial, String key) {
  try {
    final decoded = jsonDecode(partial);
    if (decoded is Map && decoded[key] is String) return decoded[key] as String;
  } catch (_) {
    final pattern = RegExp('"$key"\\s*:\\s*"([^"]*)"');
    final match = pattern.firstMatch(partial);
    if (match != null) return match.group(1);
  }
  return null;
}
