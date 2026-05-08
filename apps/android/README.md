# Liminal Android App

Native Android client scaffold for Google Play deployment.

## Stack

- Kotlin + Jetpack Compose
- Hilt DI
- Retrofit + OkHttp SSE
- Room + DataStore
- WorkManager + Firebase Messaging hooks

## Local Run

1. Install Android Studio (JDK 17).
2. Open `apps/android`.
3. Run `app` on emulator/device.
4. Default backend base URL is `http://10.0.2.2:3001`.

## Current Scope

- Chat UI with streaming connection lifecycle.
- Approval/ask-user interaction primitives.
- Draft persistence foundation and local message cache.
- Notification and upload-worker scaffolding for beta hardening.
