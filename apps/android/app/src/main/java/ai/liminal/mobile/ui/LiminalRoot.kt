@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package ai.liminal.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

private object Routes {
  const val Chat = "chat"
  const val Session = "session"
  const val Settings = "settings"
  const val Tools = "tools"
  const val Diagnostics = "diagnostics"
}

@Composable
fun LiminalRoot(
  navController: NavHostController = rememberNavController()
) {
  MaterialTheme {
    NavHost(
      navController = navController,
      startDestination = Routes.Chat
    ) {
      composable(Routes.Chat) { ChatRoute() }
      composable(Routes.Session) { PlaceholderScreen("Session") }
      composable(Routes.Settings) { PlaceholderScreen("Settings") }
      composable(Routes.Tools) { PlaceholderScreen("Tools") }
      composable(Routes.Diagnostics) { PlaceholderScreen("Diagnostics") }
    }
  }
}

@Composable
private fun ChatRoute(vm: ChatViewModel = hiltViewModel()) {
  val ui by vm.ui.collectAsStateWithLifecycle()

  Scaffold(
    topBar = {
      TopAppBar(
        title = { Text(if (ui.streamConnected) "Liminal (connected)" else "Liminal (connecting)") },
        actions = {
          AssistChip(
            onClick = vm::toggleDiagnostics,
            label = { Text(if (ui.showDiagnostics) "Diagnostics on" else "Diagnostics off") }
          )
          Spacer(Modifier.width(8.dp))
          Button(onClick = vm::clearSession) {
            Text("New session")
          }
        }
      )
    }
  ) { inner ->
    Column(
      modifier = Modifier
        .fillMaxSize()
        .padding(inner)
    ) {
      LazyColumn(
        modifier = Modifier
          .weight(1f)
          .fillMaxWidth(),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
      ) {
        items(ui.timeline, key = { it.id }) { m ->
          TimelineItem(m)
        }
      }
      ContextUsageBar(ui.contextPct)
      if (ui.error != null) {
        Text(
          text = "Error: ${ui.error}",
          color = MaterialTheme.colorScheme.error,
          modifier = Modifier.padding(horizontal = 12.dp)
        )
      }
      if (ui.pendingApprovalCallId != null) {
        HorizontalDivider()
        Row(
          modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
          horizontalArrangement = Arrangement.SpaceBetween
        ) {
          Text("Approval needed: ${ui.pendingApprovalTool ?: "tool"}")
          Button(onClick = vm::approvePending) { Text("Approve") }
        }
      }
      if (ui.pendingAskPrompt != null) {
        HorizontalDivider()
        Column(
          modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
          verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
          Text("Agent asks: ${ui.pendingAskPrompt}")
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
              value = ui.askAnswer,
              onValueChange = vm::setAskAnswer,
              label = { Text("Your answer") },
              modifier = Modifier.weight(1f)
            )
            Button(onClick = vm::submitAskAnswer) { Text("Submit") }
          }
        }
      }
      if (ui.pendingAttachmentNames.isNotEmpty()) {
        HorizontalDivider()
        Text(
          "Attachments: ${ui.pendingAttachmentNames.joinToString()}",
          modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
        )
      }
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
      ) {
        OutlinedTextField(
          value = ui.draft,
          onValueChange = vm::setDraft,
          label = { Text("Message") },
          modifier = Modifier.weight(1f),
          maxLines = 6
        )
        Spacer(Modifier.width(4.dp))
        Button(
          onClick = vm::send,
          enabled = !ui.busy
        ) {
          Text(if (ui.busy) "..." else "Send")
        }
        Spacer(Modifier.width(4.dp))
        Button(
          onClick = { vm.queueAttachment("image-${System.currentTimeMillis()}.jpg") },
          enabled = !ui.busy
        ) {
          Text("Attach")
        }
      }
    }
  }
}

@Composable
private fun TimelineItem(message: TimelineEntry) {
  when (message.kind) {
    "user" -> Text("You: ${message.text}")
    "assistant" -> Text("Liminal: ${message.text}")
    "tool" -> Text("Tool ${message.text} (${message.status ?: "running"})")
    "tool_result" -> Text("→ ${message.text}")
    "trace" -> Text("[trace] ${message.text}", color = Color.Gray)
    else -> Text(message.text)
  }
}

@Composable
private fun ContextUsageBar(pct: Int) {
  val color = when {
    pct >= 85 -> Color(0xFFEA4335)
    pct >= 60 -> Color(0xFFFBBC05)
    else -> Color(0xFF34A853)
  }
  Row(
    modifier = Modifier
      .fillMaxWidth()
      .padding(horizontal = 12.dp, vertical = 4.dp),
    horizontalArrangement = Arrangement.SpaceBetween
  ) {
    Text("Context", style = MaterialTheme.typography.labelMedium)
    Text("$pct%", color = color, style = MaterialTheme.typography.labelMedium)
  }
}

@Composable
private fun PlaceholderScreen(name: String) {
  Scaffold(topBar = { TopAppBar(title = { Text(name) }) }) { inner ->
    Column(
      modifier = Modifier
        .fillMaxSize()
        .padding(inner)
        .padding(24.dp)
    ) {
      Text("$name screen scaffolded.")
    }
  }
}
