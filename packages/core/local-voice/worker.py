"""Private stdin/stdout speech worker. No server socket or network during inference."""
import os
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_XET']='1'
import argparse, base64, contextlib, hashlib, io, json, pathlib, sys

ASSETS=pathlib.Path(__file__).resolve().parent
MANIFEST=json.loads((ASSETS/'manifest.json').read_text(encoding='utf8'))

def verify_assets():
    for name, entry in MANIFEST['assets'].items():
        with (ASSETS/name).open('rb') as reader:actual=hashlib.file_digest(reader,'sha256').hexdigest()
        if actual!=entry['sha256']:raise RuntimeError(f'Bundled voice asset checksum mismatch: {name}')

def load_engine(home):
    import torch
    from safetensors.torch import load_file
    from chatterbox.tts_turbo import ChatterboxTurboTTS
    verify_assets()
    torch.set_num_threads(max(1,min(4,os.cpu_count() or 1)))
    device='cpu'
    if torch.cuda.is_available():
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
    return engine

def synthesize(engine,text):
    import numpy as np
    import torch
    import soundfile as sf
    from chatterbox.tts_turbo import punc_norm
    from chatterbox.models.s3gen.const import S3GEN_SIL
    from tone import warm_original_pitch
    if not text.strip() or len(text)>800:raise ValueError('Local speech requires 1–800 characters per segment')
    # Stable sampling for a consistent voice. Generate full phrases, never per-word fragments.
    torch.manual_seed(100)
    tokens=engine.tokenizer(punc_norm(text),return_tensors='pt').input_ids.to(engine.device)
    with torch.inference_mode():
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
                if engine is None:engine=load_engine(args.home)
                audio=synthesize(engine,str(request.get('text','')))
            print(json.dumps({'id':request['id'],'audio':audio}),flush=True)
        except Exception as error:
            print(json.dumps({'id':request.get('id'),'error':str(error)[:600]}),flush=True)

if __name__=='__main__':main()
