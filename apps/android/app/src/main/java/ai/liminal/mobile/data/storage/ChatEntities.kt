package ai.liminal.mobile.data.storage

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "chat_messages")
data class ChatMessageEntity(
  @PrimaryKey(autoGenerate = true) val id: Long = 0,
  val role: String,
  val content: String,
  val createdAtMs: Long
)
