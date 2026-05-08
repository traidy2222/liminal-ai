package ai.liminal.mobile.data

import ai.liminal.mobile.data.model.AnswerRequest
import ai.liminal.mobile.data.model.ApiError
import ai.liminal.mobile.data.model.ApprovalDecisionBody
import ai.liminal.mobile.data.model.ApprovalRequest
import ai.liminal.mobile.data.model.MessageRequest
import ai.liminal.mobile.data.model.OkResponse
import ai.liminal.mobile.data.model.SseAskUserPayload
import ai.liminal.mobile.data.model.SseErrorPayload
import ai.liminal.mobile.data.network.HarnessApi
import ai.liminal.mobile.data.network.SseClient
import ai.liminal.mobile.data.network.SseEvent
import ai.liminal.mobile.data.prefs.SessionPrefs
import ai.liminal.mobile.data.storage.ChatDao
import ai.liminal.mobile.data.storage.ChatMessageEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

data class UiMessage(
  val role: String,
  val text: String
)

sealed interface StreamSignal {
  data class AskUser(val prompt: String) : StreamSignal
  data class ApprovalRequired(val callId: String, val toolName: String) : StreamSignal
  data class Error(val message: String) : StreamSignal
  data object Connected : StreamSignal
}

@Singleton
class HarnessRepository @Inject constructor(
  private val api: HarnessApi,
  private val sseClient: SseClient,
  private val chatDao: ChatDao,
  private val json: Json,
  private val sessionPrefs: SessionPrefs
) {
  fun observeMessages(): Flow<List<UiMessage>> =
    chatDao.observeMessages().map { rows ->
      rows.map { UiMessage(role = it.role, text = it.content) }
    }

  suspend fun sendMessage(text: String): Result<Unit> {
    chatDao.insert(ChatMessageEntity(role = "user", content = text, createdAtMs = System.currentTimeMillis()))
    val response = api.sendMessage(MessageRequest(message = text))
    return response.toResult()
  }

  suspend fun approve(callId: String): Result<Unit> =
    api.sendApproval(
      ApprovalRequest(
        callId = callId,
        decision = ApprovalDecisionBody(decision = "approve")
      )
    ).toResult()

  suspend fun answer(promptAnswer: String): Result<Unit> =
    api.sendAnswer(AnswerRequest(answer = promptAnswer)).toResult()

  suspend fun resetSession(): Result<Unit> {
    val res = api.resetSession().toResult()
    if (res.isSuccess) chatDao.clear()
    return res
  }

  suspend fun stream(baseUrl: String): Flow<SseEvent> {
    val lastEventId = sessionPrefs.lastEventId.first()
    return sseClient.stream(baseUrl, lastEventId)
  }

  suspend fun applySseEvent(event: SseEvent): StreamSignal? {
    event.id?.toLongOrNull()?.let { sessionPrefs.setLastEventId(it) }
    when (event.type) {
      "connected" -> return StreamSignal.Connected
      "text" -> {
        val obj = json.decodeFromString<JsonObject>(event.data)
        val delta = obj["delta"]?.jsonPrimitive?.content.orEmpty()
        if (delta.isNotEmpty()) {
          chatDao.insert(
            ChatMessageEntity(
              role = "assistant",
              content = delta,
              createdAtMs = System.currentTimeMillis()
            )
          )
        }
      }
      "tool_approval" -> {
        val obj = json.decodeFromString<JsonObject>(event.data)
        val callId = obj["callId"]?.jsonPrimitive?.content.orEmpty()
        val toolName = obj["name"]?.jsonPrimitive?.content.orEmpty()
        return StreamSignal.ApprovalRequired(callId, toolName)
      }
      "ask_user" -> {
        val payload = json.decodeFromString<SseAskUserPayload>(event.data)
        return StreamSignal.AskUser(payload.prompt)
      }
      "error" -> {
        val payload = runCatching {
          json.decodeFromString<SseErrorPayload>(event.data)
        }.getOrNull()
        return StreamSignal.Error(payload?.message ?: "Unknown stream error")
      }
      else -> Unit
    }
    return null
  }

  private fun Response<OkResponse>.toResult(): Result<Unit> {
    if (isSuccessful) return Result.success(Unit)
    val body = errorBody()?.string()
    val msg = runCatching {
      if (body.isNullOrBlank()) "Request failed (${code()})"
      else json.decodeFromString<ApiError>(body).error
    }.getOrElse { "Request failed (${code()})" }
    return Result.failure(IllegalStateException(msg))
  }
}
