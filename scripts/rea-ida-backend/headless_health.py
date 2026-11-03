"""Bounded idle work for an owned idalib pump; never changes GUI analysis."""

import time


def advance_headless_analysis(pump, auto, badaddr, tool_deadline=None,
                              budget_seconds=0.25, max_steps=256,
                              clock=time.monotonic):
    # The upstream pump exists in GUI mode too, but is active only in idalib.
    # Never call IDA APIs on a handler thread or enable/force analysis.
    if not pump.active or not pump.on_main_thread():
        return 0
    ready = getattr(auto, "auto_is_ok", None)
    step = getattr(auto, "auto_make_step", None)
    if not callable(ready) or not callable(step):
        return 0
    deadline = clock() + min(0.25, max(0.0, budget_seconds))
    if tool_deadline is not None:
        deadline = min(deadline, tool_deadline)
    count = 0
    while count < min(256, max(0, max_steps)) and clock() < deadline:
        if ready():
            break
        # A single native address step cannot be preempted; the time budget is
        # checked between steps, unlike unbounded auto_wait(). Errors propagate.
        progressed = step(0, badaddr)
        count += 1
        if not progressed:
            break
    return count
