"""Pinned, checked, resumable downloads. Network access is confined to installation."""
import argparse, concurrent.futures, hashlib, json, pathlib, time
import requests

ASSETS = pathlib.Path(__file__).resolve().parent
MANIFEST = None
CHUNK = 16 * 1024 * 1024

def sha256(path):
    with path.open('rb') as reader:
        return hashlib.file_digest(reader, 'sha256').hexdigest()

def download_model(name, entry, directory):
    dest = directory/name
    if dest.exists() and dest.stat().st_size == entry['bytes'] and sha256(dest) == entry['sha256']:
        print(f'{name}: verified', flush=True)
        return
    url = f"https://huggingface.co/{MANIFEST['baseRepo']}/resolve/{MANIFEST['baseRevision']}/{name}?download=true"
    parts = directory/(name+'.parts'); parts.mkdir(exist_ok=True)
    def fetch(index):
        start = index*CHUNK; end = min(entry['bytes'],start+CHUNK)-1
        part = parts/f'{index:04d}'
        if part.exists() and part.stat().st_size == end-start+1:
            return part
        for attempt in range(4):
            try:
                headers = {'Range':f'bytes={start}-{end}'} if entry['bytes'] > CHUNK else {}
                with requests.get(url+f'&part={index}', headers=headers, timeout=(20,60), stream=True) as response:
                    response.raise_for_status()
                    if headers and (response.status_code != 206 or not response.headers.get('Content-Range','').startswith(f'bytes {start}-{end}/')):
                        raise RuntimeError(f'{name}: server did not honor the download range')
                    count = 0
                    with part.open('wb') as writer:
                        for block in response.iter_content(256*1024):
                            count += len(block)
                            if count > end-start+1: raise RuntimeError('Download exceeded expected length')
                            writer.write(block)
                    if count != end-start+1: raise RuntimeError('Incomplete download')
                return part
            except Exception:
                if part.exists(): part.unlink()
                if attempt == 3: raise
                time.sleep(attempt+1)
    count = (entry['bytes']+CHUNK-1)//CHUNK
    print(f'{name}: downloading {entry["bytes"]/1e6:.1f} MB', flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for i,_ in enumerate(pool.map(fetch,range(count))):
            if i%8 == 0: print(f'{name}: {i+1}/{count} parts',flush=True)
    temporary = directory/(name+'.download')
    with temporary.open('wb') as writer:
        for i in range(count):
            with (parts/f'{i:04d}').open('rb') as reader:
                while block := reader.read(1024*1024): writer.write(block)
    if sha256(temporary) != entry['sha256']:
        # Do not keep accepting same-sized corrupted parts on the next install attempt.
        for part in parts.iterdir(): part.unlink()
        raise RuntimeError(f'{name}: checksum mismatch; retry installation')
    temporary.replace(dest)
    for part in parts.iterdir(): part.unlink()
    parts.rmdir()
    print(f'{name}: verified',flush=True)

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--home',type=pathlib.Path,required=True)
    parser.add_argument('--profile', choices=['whisper','qwen'], required=True)
    args=parser.parse_args(); MANIFEST = json.loads((ASSETS/'manifest.json').read_text(encoding='utf8'))['profiles'][args.profile]
    directory=args.home/'models';directory.mkdir(parents=True,exist_ok=True)
    for name,entry in MANIFEST['models'].items(): download_model(name,entry,directory)
