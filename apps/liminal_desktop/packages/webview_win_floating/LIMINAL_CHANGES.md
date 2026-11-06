# Liminal-maintained WebView fixes

Based on upstream webview_win_floating 3.0.3 (BSD-3-Clause; see LICENSE).
This source dependency keeps the fixes reproducible without changing a developer's Pub cache.

- Preserve HRESULT details and complete failed native environment/controller starts.
- Release a failed cached environment so the next creation can reacquire it.
- Propagate asynchronous platform-adapter errors to callers.
- Observe initialization errors, unregister failed controllers, and make disposal awaited and idempotent.
- Retire failed controllers without trying to dispose a native view that never existed.
- Ignore retired-widget visibility/resume operations, avoiding unhandled lifecycle errors.

The app retries native tab creation once. Page navigation and form actions are outside that retry.
