package ai.liminal.mobile.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ConfigResponse(
  val uiVerbosity: String = "normal",
  val approvalTimeoutMs: Long = 60_000
)

@Serializable
data class StatusResponse(
  val clients: Int = 0,
  val busy: Boolean = false,
  val startedAt: Long? = null,
  val lastTurnEndedAt: Long? = null
)

@Serializable
data class ApiError(
  val error: String
)

@Serializable
data class IncomingAttachment(
  val name: String? = null,
  val dataUrl: String? = null,
  val source: String? = null
)

@Serializable
data class MessageRequest(
  val message: String? = null,
  val freshContext: Boolean? = null,
  val attachments: List<IncomingAttachment> = emptyList()
)

@Serializable
data class OkResponse(
  val ok: Boolean
)

@Serializable
data class ApprovalDecisionBody(
  val decision: String,
  val reason: String? = null
)

@Serializable
data class ApprovalRequest(
  val callId: String,
  val decision: ApprovalDecisionBody
)

@Serializable
data class AnswerRequest(
  val answer: String
)

@Serializable
data class SseTextPayload(
  val delta: String = "",
  val channel: String? = null
)

@Serializable
data class SseToolStartPayload(
  val callId: String,
  val name: String
)

@Serializable
data class SseToolResultPayload(
  val callId: String,
  val name: String,
  val ok: Boolean,
  val output: String
)

@Serializable
data class SseAskUserPayload(
  val prompt: String
)

@Serializable
data class SseErrorPayload(
  val message: String
)

@Serializable
data class SseTurnEndPayload(
  @SerialName("contextSnapshot")
  val contextSnapshot: ContextSnapshot = ContextSnapshot()
)

@Serializable
data class ContextSnapshot(
  val tokenCount: Int = 0,
  val maxTokens: Int = 0,
  val usageFraction: Double = 0.0,
  val masked: Boolean = false
)
