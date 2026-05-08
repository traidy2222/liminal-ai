package ai.liminal.mobile.notifications

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class LiminalMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    // TODO: POST token to mobile device registration endpoint.
  }

  override fun onMessageReceived(message: RemoteMessage) {
    // TODO: map push payloads into local notifications/deep links.
  }
}
