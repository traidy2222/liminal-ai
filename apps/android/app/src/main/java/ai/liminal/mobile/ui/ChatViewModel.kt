package ai.liminal.mobile.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ai.liminal.mobile.data.HarnessRepository
import ai.liminal.mobile.data.StreamSignal
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import javax.inject.Inject

data class TimelineEntry(
  val id: Long = System.nanoTime(),
  val kind: String,
  val text: String,
  val status: String? = null,
  val callId: String? = null
)

data class ChatUiState(
  val draft: String = "",
  val busy: Boolean = false,
  val error: String? = null,
  val streamConnected: Boolean = false,
  val showDiagnostics: Boolean = false,
  val contextPct: Int = 0,
  val pendingApprovalCallId: String? = null,
  val pendingApprovalTool: String? = null,
  val pendingAskPrompt: String? = null,
  val askAnswer: String = "",
  val pendingAttachmentNames: List<String> = emptyList(),
  val timeline: List<TimelineEntry> = emptyList()
)

@HiltViewModel
class ChatViewModel @Inject constructor(
  private val repo: HarnessRepository,
  private val json: Json
) : ViewModel() {
  private val _ui = MutableStateFlow(ChatUiState())
  val ui: StateFlow<ChatUiState> = _ui.asStateFlow()

  init {
    viewModelScope.launch {
      var backoffMs = 1_000L
      while (true) {
        try {
          repo.stream("http://10.0.2.2:3001").collect { event ->
            val signal = repo.applySseEvent(event)
            when (event.type) {
              "text" -> appendAssistantDelta(extractString(event.data, "delta"))
              "tool_start" -> {
                val callId = extractString(event.data, "callId")
                val toolName = extractString(event.data, "name")
                if (_ui.value.showDiagnostics) {
                  pushEntry(TimelineEntry(kind = "tool", text = toolName, status = "running", callId = callId))
                }
              }
              "tool_result" -> {
                val callId = extractString(event.data, "callId")
                val ok = extractBool(event.data, "ok")
                val output = extractString(event.data, "output")
                if (_ui.value.showDiagnostics) {
                  setToolStatus(callId, if (ok) "done" else "error")
                  pushEntry(TimelineEntry(kind = "tool_result", text = output.take(500), status = if (ok) "ok" else "error"))
                }
              }
              "provider_retry" -> {
                if (_ui.value.showDiagnostics) {
                  pushEntry(TimelineEntry(kind = "trace", text = "Provider retry: ${event.data.take(200)}"))
                }
              }
              "turn_end" -> {
                val pct = ((extractDouble(event.data, "contextSnapshot.usageFraction")) * 100.0).toInt()
                _ui.value = _ui.value.copy(busy = false, contextPct = pct.coerceIn(0, 100))
              }
              "error" -> _ui.value = _ui.value.copy(busy = false)
              else -> Unit
            }
            when (signal) {
              StreamSignal.Connected -> _ui.value = _ui.value.copy(streamConnected = true)
              is StreamSignal.ApprovalRequired -> _ui.value = _ui.value.copy(
                pendingApprovalCallId = signal.callId,
                pendingApprovalTool = signal.toolName
              )
              is StreamSignal.AskUser -> _ui.value = _ui.value.copy(pendingAskPrompt = signal.prompt)
              is StreamSignal.Error -> _ui.value = _ui.value.copy(error = signal.message)
              null -> Unit
            }
          }
          backoffMs = 1_000L
        } catch (_: Exception) {
          _ui.value = _ui.value.copy(streamConnected = false)
          delay(backoffMs)
          backoffMs = (backoffMs * 2).coerceAtMost(15_000L)
        }
      }
    }
  }

  fun setDraft(value: String) {
    _ui.value = _ui.value.copy(draft = value)
  }

  fun send() {
    val queued = _ui.value.pendingAttachmentNames
    val text = _ui.value.draft.trim()
    if (text.isEmpty()) return
    val finalText =
      if (queued.isEmpty()) text
      else "$text\n[mobile-attached: ${queued.joinToString()}]"
    viewModelScope.launch {
      _ui.value = _ui.value.copy(busy = true, error = null)
      pushEntry(TimelineEntry(kind = "user", text = finalText))
      val result = repo.sendMessage(finalText)
      _ui.value = if (result.isSuccess) {
        _ui.value.copy(busy = false, draft = "", pendingAttachmentNames = emptyList())
      } else {
        _ui.value.copy(busy = false, error = result.exceptionOrNull()?.message)
      }
    }
  }

  fun clearSession() {
    viewModelScope.launch {
      val result = repo.resetSession()
      if (result.isFailure) {
        _ui.value = _ui.value.copy(error = result.exceptionOrNull()?.message)
      }
    }
  }

  fun approvePending() {
    val callId = _ui.value.pendingApprovalCallId ?: return
    viewModelScope.launch {
      val result = repo.approve(callId)
      _ui.value = if (result.isSuccess) {
        _ui.value.copy(
          pendingApprovalCallId = null,
          pendingApprovalTool = null
        )
      } else {
        _ui.value.copy(error = result.exceptionOrNull()?.message)
      }
    }
  }

  fun setAskAnswer(value: String) {
    _ui.value = _ui.value.copy(askAnswer = value)
  }

  fun submitAskAnswer() {
    val answer = _ui.value.askAnswer.trim()
    if (answer.isEmpty()) return
    viewModelScope.launch {
      val result = repo.answer(answer)
      _ui.value = if (result.isSuccess) {
        _ui.value.copy(
          askAnswer = "",
          pendingAskPrompt = null
        )
      } else {
        _ui.value.copy(error = result.exceptionOrNull()?.message)
      }
    }
  }

  fun queueAttachment(name: String) {
    if (name.isBlank()) return
    _ui.value = _ui.value.copy(
      pendingAttachmentNames = (_ui.value.pendingAttachmentNames + name).takeLast(8)
    )
  }

  fun clearAttachments() {
    _ui.value = _ui.value.copy(pendingAttachmentNames = emptyList())
  }

  fun toggleDiagnostics() {
    _ui.value = _ui.value.copy(showDiagnostics = !_ui.value.showDiagnostics)
  }

  private fun pushEntry(entry: TimelineEntry) {
    _ui.value = _ui.value.copy(timeline = (_ui.value.timeline + entry).takeLast(500))
  }

  private fun appendAssistantDelta(delta: String) {
    if (delta.isBlank()) return
    val timeline = _ui.value.timeline.toMutableList()
    val last = timeline.lastOrNull()
    if (last != null && last.kind == "assistant" && last.status == "streaming") {
      timeline[timeline.lastIndex] = last.copy(text = last.text + delta)
    } else {
      timeline += TimelineEntry(kind = "assistant", text = delta, status = "streaming")
    }
    _ui.value = _ui.value.copy(timeline = timeline.takeLast(500))
  }

  private fun setToolStatus(callId: String, status: String) {
    if (callId.isBlank()) return
    val timeline = _ui.value.timeline.toMutableList()
    val idx = timeline.indexOfLast { it.kind == "tool" && it.callId == callId }
    if (idx >= 0) {
      timeline[idx] = timeline[idx].copy(status = status)
      _ui.value = _ui.value.copy(timeline = timeline)
    }
  }

  private fun extractString(raw: String, key: String): String {
    return runCatching {
      val obj = json.decodeFromString<JsonObject>(raw)
      var el: JsonElement? = obj
      for (part in key.split(".")) {
        el = (el as? JsonObject)?.get(part) ?: return@runCatching ""
      }
      (el as? JsonPrimitive)?.content ?: ""
    }.getOrDefault("")
  }

  private fun extractBool(raw: String, key: String): Boolean {
    return runCatching {
      var el: JsonElement? = json.decodeFromString<JsonObject>(raw)
      for (part in key.split(".")) {
        el = (el as? JsonObject)?.get(part) ?: return@runCatching false
      }
      (el as? JsonPrimitive)?.booleanOrNull ?: false
    }.getOrDefault(false)
  }

  private fun extractDouble(raw: String, key: String): Double {
    return runCatching {
      var el: JsonElement? = json.decodeFromString<JsonObject>(raw)
      for (part in key.split(".")) {
        el = (el as? JsonObject)?.get(part) ?: return@runCatching 0.0
      }
      (el as? JsonPrimitive)?.doubleOrNull ?: 0.0
    }.getOrDefault(0.0)
  }
}
