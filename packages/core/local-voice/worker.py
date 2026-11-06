"""Private stdin/stdout speech worker. No server socket or network during inference."""
import os
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_XET']='1'
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
import argparse, base64, contextlib, hashlib, io, json, pathlib, sys

ASSETS=pathlib.Path(__file__).resolve().parent
MANIFEST=json.loads((ASSETS/'manifest.json').read_text(encoding='utf8'))

def verify_assets():
    for name, entry in MANIFEST['assets'].items():
        with (ASSETS/name).open('rb') as reader:actual=hashlib.file_digest(reader,'sha256').hexdigest()
        if actual!=entry['sha256']:raise RuntimeError(f'Bundled voice asset checksum mismatch: {name}')

def load_engine(home, cpu_only=False):
    import torch
    from safetensors.torch import load_file
    from chatterbox.tts_turbo import ChatterboxTurboTTS
    verify_assets()
    torch.set_num_threads(max(1,min(4,os.cpu_count() or 1)))
    # Ampere+ can accelerate FP32 GEMMs using TF32 without converting the model
    # or its reference conditioning to a different dtype.
    if torch.cuda.is_available(): torch.set_float32_matmul_precision('high')
    device='cpu'
    if not cpu_only and torch.cuda.is_available():
        free,total=torch.cuda.mem_get_info()
        if total>=8*1024**3 and free>=4*1024**3:
            device='cuda'
            torch.cuda.set_per_process_memory_fraction(min(.7,5*1024**3/total))
    engine=ChatterboxTurboTTS.from_local(home/'models',device=device)
    state=load_file(str(ASSETS/'adapter.safetensors'))
    names={key.rsplit('.',1)[0] for key in state}
    if len(names)!=96 or any(not key.endswith(('.a','.b')) for key in state):
        raise RuntimeError('Unexpected voice adapter layout')
    with torch.no_grad():
        for name in names:
            module=engine.t3.get_submodule(name)
            delta=(state[name+'.b']@state[name+'.a']).T
            if delta.shape!=module.weight.shape:raise RuntimeError('Voice adapter shape mismatch')
            module.weight.add_(delta.to(device)*MANIFEST['adapterAlpha']/MANIFEST['adapterRank'])
    engine.t3.eval()
    engine.prepare_conditionals(str(ASSETS/'reference.wav'))
    prepare_decoder_precision(engine, preload=cpu_only)
    return engine

def native_bf16_supported(torch):
    """Emulated bf16 on pre-Ampere GPUs is not a fast decoder path."""
    return torch.cuda.is_available() and torch.cuda.get_device_capability()[0] >= 8


def prepare_decoder_precision(engine, preload=False):
    """Keep decoder weights and reference embeddings in the inference dtype."""
    import torch
    # CPU preload stores the decoder in its eventual GPU dtype; actual CPU
    # synthesis still restores float32. Avoid keeping a second full-size FP32
    # decoder in RAM just to transfer and convert it on the first spoken reply.
    dtype = torch.bfloat16 if (engine.device == 'cuda' or preload) and native_bf16_supported(torch) else torch.float32
    changed = next(engine.t3.parameters()).dtype != dtype
    if changed: engine.t3.to(dtype=dtype)
    engine.conds.t3.to(dtype=dtype)
    if changed and engine.device == 'cuda': torch.cuda.empty_cache()

def move_engine(engine, device):
    """Move all modules and reference tensors together before acknowledging release."""
    import torch
    # A failed resume can leave some modules on CUDA even while device says CPU.
    if engine.device == device and device != 'cpu': return
    engine.t3.to(device)
    engine.s3gen.to(device)
    engine.ve.to(device)
    # Chatterbox's positional encoders store plain Tensor attributes (not buffers).
    # Module.to() leaves these on their original device, causing stale CUDA state.
    parked = getattr(engine, '_parked_tensor_attrs', [])
    if device == 'cpu':
        for network in (engine.t3, engine.s3gen, engine.ve):
            for module in network.modules():
                for name, value in list(vars(module).items()):
                    if torch.is_tensor(value) and value.device.type == 'cuda':
                        if not any(owner is module and attr == name for owner, attr in parked): parked.append((module, name))
                        setattr(module, name, value.to(device))
        engine._parked_tensor_attrs = parked
    else:
        # Restore only attributes parked from CUDA; intentional CPU metadata stays CPU.
        for module, name in parked: setattr(module, name, getattr(module, name).to(device))
        engine._parked_tensor_attrs = []
    engine.conds.to(device)
    engine.device = device
    if device == 'cpu' and torch.cuda.is_available():
        import gc
        gc.collect()
        torch.cuda.synchronize()
        torch.cuda.empty_cache()
        # Small CUDA runtime caches can survive empty_cache. Bound the overhead;
        # model-sized retained allocations still force process exit.
        if torch.cuda.memory_allocated() > 256 * 1024**2:
            raise RuntimeError('Local voice retained GPU allocations after parking')

def resume_engine(engine):
    import torch
    if engine.device == 'cuda': return
    if torch.cuda.is_available():
        free, total = torch.cuda.mem_get_info()
        if total >= 8 * 1024**3 and free >= 4 * 1024**3:
            torch.cuda.set_per_process_memory_fraction(min(.7, 5 * 1024**3 / total))
            try:
                move_engine(engine, 'cuda')
            except RuntimeError:
                move_engine(engine, 'cpu')

def can_keep_gpu(engine, next_resident_ready=False):
    import torch
    if engine.device != 'cuda': return False
    # Release unused allocator cache before making a conservative shared-memory
    # decision. Inference remains serialized even when both weights stay resident.
    torch.cuda.empty_cache()
    free, total = torch.cuda.mem_get_info()
    return total >= 9 * 1024**3 and free >= (1.5 if next_resident_ready else 4) * 1024**3

def synthesize(engine,text):
    import numpy as np
    import torch
    import soundfile as sf
    from chatterbox.tts_turbo import punc_norm
    from chatterbox.models.s3gen.const import S3GEN_SIL
    from tone import warm_original_pitch
    prepare_decoder_precision(engine)
    if not text.strip() or len(text)>800:raise ValueError('Local speech requires 1–800 characters per segment')
    # Stable sampling for a consistent voice. Generate full phrases, never per-word fragments.
    torch.manual_seed(100)
    tokens=engine.tokenizer(punc_norm(text),return_tensors='pt').input_ids.to(engine.device)
    with torch.inference_mode():
        # Autocast just the autoregressive decoder on supported NVIDIA GPUs.
        # Integer speech tokens cross the boundary; the vocoder and approved tone
        # processing retain their original precision and reference conditioning.
        mixed = engine.device == 'cuda' and native_bf16_supported(torch)
        with torch.autocast('cuda', dtype=torch.bfloat16, enabled=mixed):
            speech=engine.t3.inference_turbo(t3_cond=engine.conds.t3,text_tokens=tokens,temperature=.65,top_p=.9,repetition_penalty=1.2)
        if speech.numel()>=1000:raise RuntimeError('Speech generation reached its limit; shorten the spoken passage and retry')
        speech=speech[speech<6561]
        speech=torch.cat([speech,torch.tensor([S3GEN_SIL]*3,device=engine.device)])
        wave,_=engine.s3gen.inference(speech_tokens=speech,ref_dict=engine.conds.gen,n_cfm_timesteps=2)
    audio=warm_original_pitch(wave.squeeze().cpu().numpy(),engine.sr,MANIFEST['tone'])
    # Retain Chatterbox's standard watermark after the final tone processing.
    audio=engine.watermarker.apply_watermark(audio,sample_rate=engine.sr)
    # A final uniform safety gain preserves the tone and timing.
    peak=float(np.max(np.abs(audio)))
    if peak>.707:audio*=.707/peak
    output=io.BytesIO();sf.write(output,audio,engine.sr,format='WAV',subtype='PCM_16')
    return base64.b64encode(output.getvalue()).decode('ascii')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--home',type=pathlib.Path,required=True);parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    if args.check:
        import torch, soundfile, transformers, perth
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        from tone import warm_original_pitch
        verify_assets()
        for name,entry in MANIFEST['models'].items():
            path=args.home/'models'/name
            if not path.exists() or path.stat().st_size!=entry['bytes']:raise RuntimeError(f'Missing voice model file: {name}')
        print('Local voice runtime and models verified');return
    engine=None
    for line in sys.stdin:
        request={}
        try:
            request=json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                if request.get('op') == 'release':
                    if engine is not None and request.get('allow_resident') and can_keep_gpu(engine, request.get('next_resident_ready', False)):
                        print(json.dumps({'id':request['id'],'released':True,'residentGpu':True}),file=sys.__stdout__,flush=True)
                        continue
                    if engine is not None: move_engine(engine, 'cpu')
                    print(json.dumps({'id':request['id'],'released':True}),file=sys.__stdout__,flush=True)
                    continue
                if request.get('op') == 'warmup':
                    if engine is None: engine=load_engine(args.home,cpu_only=True)
                    print(json.dumps({'id':request['id'],'ready':True}),file=sys.__stdout__,flush=True)
                    continue
                if engine is None:engine=load_engine(args.home)
                else:resume_engine(engine)
                print(json.dumps({'id':request['id'],'started':True,'device':str(engine.device)}),file=sys.__stdout__,flush=True)
                audio=synthesize(engine,str(request.get('text','')))
            print(json.dumps({'id':request['id'],'audio':audio}),flush=True)
        except Exception as error:
            print(json.dumps({'id':request.get('id'),'error':str(error)[:600]}),flush=True)

if __name__=='__main__':main()
