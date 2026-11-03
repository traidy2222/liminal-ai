import unittest
from types import SimpleNamespace
from headless_health import advance_headless_analysis


class HealthTests(unittest.TestCase):
    def pump(self, active=True, main=True):
        return SimpleNamespace(active=active, on_main_thread=lambda: main)

    def test_owned_main_thread_makes_only_single_address_steps_until_ready(self):
        calls = []
        auto = SimpleNamespace(auto_is_ok=lambda: len(calls) == 3,
                               auto_make_step=lambda start, end: calls.append((start, end)) or True)
        self.assertEqual(advance_headless_analysis(self.pump(), auto, 999), 3)
        self.assertEqual(calls, [(0, 999)] * 3)

    def test_gui_or_handler_thread_does_not_call_ida(self):
        def forbidden():
            self.fail("GUI/non-main health must not advance analysis")
        auto = SimpleNamespace(auto_is_ok=forbidden)
        for pump in [self.pump(active=False), self.pump(main=False)]:
            self.assertEqual(advance_headless_analysis(pump, auto, 999), 0)

    def test_budget_and_tool_deadline_and_step_cap(self):
        for deadline in [None, 0.06]:
            steps = []
            ticks = iter([i / 100 for i in range(1000)])
            auto = SimpleNamespace(auto_is_ok=lambda: False,
                                   auto_make_step=lambda a, b: steps.append(1) or True)
            advance_headless_analysis(self.pump(), auto, 999, tool_deadline=deadline,
                                     clock=lambda: next(ticks))
            self.assertLessEqual(len(steps), 24 if deadline is None else 5)
            self.assertGreater(len(steps), 0)
        auto = SimpleNamespace(auto_is_ok=lambda: False, auto_make_step=lambda a, b: True)
        self.assertEqual(advance_headless_analysis(self.pump(), auto, 999, clock=lambda: 0), 256)
        self.assertEqual(advance_headless_analysis(self.pump(), auto, 999, tool_deadline=0, clock=lambda: 0), 0)

    def test_empty_queues_no_progress_missing_api_and_native_errors(self):
        auto = SimpleNamespace(auto_is_ok=lambda: True, auto_make_step=lambda a, b: self.fail())
        self.assertEqual(advance_headless_analysis(self.pump(), auto, 999), 0)
        auto = SimpleNamespace(auto_is_ok=lambda: False, auto_make_step=lambda a, b: False)
        self.assertEqual(advance_headless_analysis(self.pump(), auto, 999), 1)
        self.assertEqual(advance_headless_analysis(self.pump(), SimpleNamespace(), 999), 0)
        def fail(a, b):
            raise RuntimeError("native step failed")
        auto.auto_make_step = fail
        with self.assertRaisesRegex(RuntimeError, "native step failed"):
            advance_headless_analysis(self.pump(), auto, 999)


if __name__ == "__main__":
    unittest.main()
