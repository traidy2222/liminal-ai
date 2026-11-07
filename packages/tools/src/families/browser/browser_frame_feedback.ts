import type {Page,Frame} from 'playwright';

/** Browser accessibility includes rendered text inside embedded/closed component trees
 * that DOM innerText cannot see. Return only missing text, never input values. */
export async function embeddedFrameFeedback(page:Page,frame:Frame,knownText:string,maxChars=800):Promise<string>{
 const session=await page.context().newCDPSession(frame);
 try{
  const {nodes}=await session.send('Accessibility.getFullAXTree');
  const fold=(s:string)=>s.replace(/\s+/g,' ').trim();
  const known=fold(knownText),seen=new Set<string>(),lines:string[]=[];let remaining=maxChars;
  for(const node of nodes){
   if(node.ignored||node.role?.value!=='StaticText'||typeof node.name?.value!=='string')continue;
   const value=fold(node.name.value);
   if(!value||seen.has(value)||known.includes(value))continue;
   seen.add(value);
   if(remaining<=0)break;
   lines.push(value.slice(0,remaining));remaining-=value.length+1;
  }
  return lines.join('\n');
 }finally{await session.detach().catch(()=>{});}
}
