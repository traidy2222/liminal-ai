# Google Play Readiness Checklist (Harness App)

## Security and Privacy

- [ ] Enforce authenticated mobile sessions.
- [ ] Encrypt tokens/session metadata at rest.
- [ ] Ship strict production network security config (no cleartext domains).
- [ ] Add backend rate limiting and abuse controls for mobile auth + message APIs.
- [ ] Publish privacy policy URL in Play Console and in-app settings.
- [ ] Provide account deletion/data deletion path if accounts are used.

## Reliability and Quality

- [ ] Crash-free sessions target >= 99.5% in closed testing.
- [ ] ANR rate target below Play bad behavior thresholds.
- [ ] SSE reconnect/resume with persisted event id validated on flaky networks.
- [ ] Busy-state collision behavior validated (`409` path).
- [ ] WorkManager retries for uploads and deferred sends.

## Functional Parity

- [ ] Chat send/stream/turn-end parity with web.
- [ ] Approval and ask-user flows verified.
- [ ] Attachments path (gallery/camera/upload) verified end-to-end.
- [ ] Push notifications for completion, approvals, and failures.

## Release Pipeline

- [ ] Internal test track with smoke test suite.
- [ ] Closed test track with staged cohorts.
- [ ] Play pre-launch report clean for critical issues.
- [ ] Signed release bundle and rollback strategy documented.
