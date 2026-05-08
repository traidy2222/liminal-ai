package ai.liminal.mobile.data.prefs

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SessionPrefs @Inject constructor(
  private val dataStore: DataStore<Preferences>
) {
  private val baseUrlKey = stringPreferencesKey("base_url")
  private val lastEventIdKey = longPreferencesKey("last_event_id")

  val baseUrl: Flow<String> = dataStore.data.map {
    it[baseUrlKey] ?: "http://10.0.2.2:3001"
  }

  suspend fun setBaseUrl(value: String) {
    dataStore.edit { prefs ->
      prefs[baseUrlKey] = value
    }
  }

  val lastEventId: Flow<Long?> = dataStore.data.map { it[lastEventIdKey] }

  suspend fun setLastEventId(value: Long?) {
    dataStore.edit { prefs ->
      if (value == null) prefs.remove(lastEventIdKey) else prefs[lastEventIdKey] = value
    }
  }
}
