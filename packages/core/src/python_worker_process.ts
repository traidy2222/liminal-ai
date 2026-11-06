import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Launch the real CPython worker rather than its Windows venv redirector.
 * CPython's own launcher uses __PYVENV_LAUNCHER__ to preserve sys.executable,
 * sys.prefix and site-packages. Piped stdio works with pythonw and needs no console.
 * https://github.com/python/cpython/blob/3.12/Modules/getpath.py
 */
export function resolvePythonWorkerProcess(command: string, platform=process.platform): {command:string;env?:NodeJS.ProcessEnv} {
  if(platform!=="win32"||!/^python(?:w)?\.exe$/i.test(path.basename(command)))return {command};
  try {
    const cfg=path.join(path.dirname(path.dirname(command)),"pyvenv.cfg");
    const home=readFileSync(cfg,"utf8").match(/^home\s*=\s*(.+)$/mi)?.[1]?.trim();
    if(!home||!path.isAbsolute(home))return {command};
    const real=["pythonw.exe","python.exe"].map(name=>path.join(home,name)).find(existsSync);
    if(!real||path.resolve(real)===path.resolve(command))return {command};
    return {command:real,env:{...process.env,__PYVENV_LAUNCHER__:command}};
  } catch { return {command}; }
}

export function spawnPythonWorker(command:string,args:string[]):ChildProcessWithoutNullStreams {
  const launch=resolvePythonWorkerProcess(command);
  return spawn(launch.command,args,{stdio:"pipe",windowsHide:true,...(launch.env?{env:launch.env}:{})});
}
