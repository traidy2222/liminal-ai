package ai.liminal.mobile.data.storage

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface ChatDao {
  @Query("SELECT * FROM chat_messages ORDER BY createdAtMs ASC")
  fun observeMessages(): Flow<List<ChatMessageEntity>>

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun insert(entity: ChatMessageEntity)

  @Query("DELETE FROM chat_messages")
  suspend fun clear()
}
