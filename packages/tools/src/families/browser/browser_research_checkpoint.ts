import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {resolveWorkspaceRoot} from '@liminal/core';

export function browserResearchCheckpointPath(taskId: string): string {
  const name=createHash('sha256').update(taskId).digest('hex').slice(0,16);
  return `.agent_artifacts/browser/research/${name}.json`;
}

/** Persist bounded observations as they arrive, without another model/tool call. */
export function saveBrowserResearchCheckpoint(taskId: string, observation: {source: unknown; data: unknown}): string {
  const relative=browserResearchCheckpointPath(taskId),file=path.join(resolveWorkspaceRoot(),relative);
  let observations: typeof observation[]=[];
  try {const prior=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(prior.observations))observations=prior.observations;} catch {}
  const key=JSON.stringify(observation);
  if(!observations.some(item=>JSON.stringify(item)===key))observations.push(observation);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const next=file+'.tmp';
  fs.writeFileSync(next,JSON.stringify({updated_at:new Date().toISOString(),observations:observations.slice(-80)}),{mode:0o600});
  fs.renameSync(next,file);
  return relative;
}
