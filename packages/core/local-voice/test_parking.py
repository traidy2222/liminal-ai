"""GPU handoff contract without models, Torch or a GPU."""
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from worker import move_engine, resume_engine, can_keep_gpu

class ParkingTests(unittest.TestCase):
    def test_resident_switch_needs_workspace_but_cold_load_needs_weight_headroom(self):
        engine, _, torch = self.fixture()
        torch.cuda.mem_get_info = lambda: (2 * 1024**3, 10 * 1024**3)
        with patch.dict(sys.modules, {'torch': torch}):
            self.assertFalse(can_keep_gpu(engine))
            self.assertTrue(can_keep_gpu(engine, next_resident_ready=True))
            torch.cuda.mem_get_info = lambda: (1024**3, 10 * 1024**3)
            self.assertFalse(can_keep_gpu(engine, next_resident_ready=True))

    def fixture(self):
        events = []
        engine = SimpleNamespace(device='cuda')
        for name in ('t3', 's3gen', 've', 'conds'):
            setattr(engine, name, SimpleNamespace(to=lambda device, name=name: events.append((name, device))))
        for name in ('t3', 's3gen', 've'):
            module = getattr(engine, name)
            module.modules = lambda module=module: [module]
        class Tensor:
            device = SimpleNamespace(type='cuda')
            def to(self, device):
                events.append(('positional_tensor', device))
                self.device = SimpleNamespace(type=device)
                return self
        engine.s3gen.pe = Tensor()
        cuda = SimpleNamespace(is_available=lambda: True, synchronize=lambda: events.append('sync'),
            empty_cache=lambda: events.append('empty'), memory_allocated=lambda: 0,
            mem_get_info=lambda: (5 * 1024**3, 10 * 1024**3), set_per_process_memory_fraction=Mock())
        return engine, events, SimpleNamespace(cuda=cuda, is_tensor=lambda value: isinstance(value, Tensor))

    def test_release_moves_weights_and_conditionals_before_acknowledging(self):
        engine, events, torch = self.fixture()
        with patch.dict(sys.modules, {'torch': torch}):
            move_engine(engine, 'cpu')
        self.assertEqual(events, [('t3', 'cpu'), ('s3gen', 'cpu'), ('ve', 'cpu'), ('positional_tensor', 'cpu'), ('conds', 'cpu'), 'sync', 'empty'])
        self.assertEqual(engine.device, 'cpu')

    def test_unknown_cuda_state_refuses_release_and_partial_resumes_are_repaired(self):
        engine, events, torch = self.fixture()
        torch.cuda.memory_allocated = lambda: 512 * 1024**2
        with patch.dict(sys.modules, {'torch': torch}):
            with self.assertRaises(RuntimeError): move_engine(engine, 'cpu')
            torch.cuda.memory_allocated = lambda: 0
            move_engine(engine, 'cpu')
        self.assertEqual(events.count(('t3', 'cpu')), 2)

    def test_resume_restores_all_reference_tensors_to_available_gpu(self):
        engine, events, torch = self.fixture()
        with patch.dict(sys.modules, {'torch': torch}):
            move_engine(engine, 'cpu')
            events.clear()
            resume_engine(engine)
        self.assertEqual(engine.device, 'cuda')
        self.assertEqual(events, [('t3', 'cuda'), ('s3gen', 'cuda'), ('ve', 'cuda'), ('positional_tensor', 'cuda'), ('conds', 'cuda')])

if __name__ == '__main__': unittest.main()
