package ai.liminal.mobile.data.network

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import javax.inject.Inject
import javax.inject.Singleton

data class SseEvent(
  val id: String?,
  val type: String,
  val data: String
)

@Singleton
class SseClient @Inject constructor(
  private val okHttpClient: OkHttpClient
) {
  fun stream(baseUrl: String, lastEventId: Long? = null): Flow<SseEvent> = callbackFlow {
    val factory = EventSources.createFactory(okHttpClient)
    val requestBuilder = Request.Builder().url("$baseUrl/api/stream")
    if (lastEventId != null && lastEventId > 0) {
      requestBuilder.header("Last-Event-ID", lastEventId.toString())
    }
    val request = requestBuilder.build()
    val listener = object : EventSourceListener() {
      override fun onEvent(
        eventSource: EventSource,
        id: String?,
        type: String?,
        data: String
      ) {
        trySend(SseEvent(id = id, type = type ?: "message", data = data))
      }

      override fun onFailure(
        eventSource: EventSource,
        t: Throwable?,
        response: Response?
      ) {
        close(t ?: RuntimeException("SSE failed: ${response?.code ?: -1}"))
      }
    }
    val source = factory.newEventSource(request, listener)
    awaitClose {
      source.cancel()
    }
  }
}
