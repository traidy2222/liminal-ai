import test from 'node:test';
import assert from 'node:assert/strict';
import { torchInstallArgs } from './setup.mjs';
test('CPU/CUDA switches force both PyTorch packages to change variant',()=>{
  for(const [cuda,previous] of [[true,'cpu'],[false,'cuda124']]){
    const args=torchInstallArgs('python',cuda,previous,true);
    assert.deepEqual(args.slice(-4),['--reinstall-package','torch','--reinstall-package','torchaudio']);
    assert.ok(args.includes(cuda?'https://download.pytorch.org/whl/cu124':'https://download.pytorch.org/whl/cpu'));
  }
});
test('an interrupted provisioning run is repaired, while a healthy matching runtime is reused',()=>{
  assert.ok(torchInstallArgs('python',true,'cuda124',false).includes('--reinstall-package'));
  assert.ok(!torchInstallArgs('python',true,'cuda124',true).includes('--reinstall-package'));
});
