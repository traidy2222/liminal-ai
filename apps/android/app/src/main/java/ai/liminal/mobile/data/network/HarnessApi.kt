package ai.liminal.mobile.data.network

import ai.liminal.mobile.data.model.AnswerRequest
import ai.liminal.mobile.data.model.ApprovalRequest
import ai.liminal.mobile.data.model.ConfigResponse
import ai.liminal.mobile.data.model.MessageRequest
import ai.liminal.mobile.data.model.OkResponse
import ai.liminal.mobile.data.model.StatusResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

interface HarnessApi {
  @GET("/api/config")
  suspend fun getConfig(): ConfigResponse

  @GET("/api/status")
  suspend fun getStatus(): StatusResponse

  @POST("/api/message")
  suspend fun sendMessage(@Body request: MessageRequest): Response<OkResponse>

  @POST("/api/approve")
  suspend fun sendApproval(@Body request: ApprovalRequest): Response<OkResponse>

  @POST("/api/answer")
  suspend fun sendAnswer(@Body request: AnswerRequest): Response<OkResponse>

  @POST("/api/session/reset")
  suspend fun resetSession(): Response<OkResponse>
}
