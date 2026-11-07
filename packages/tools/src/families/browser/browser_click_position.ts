import type {Locator} from 'playwright';

/** Styled native inputs are often covered by their associated label's icon.
 * Use that real HTML label rather than forcing a click through its artwork. */
export async function browserAssociatedControlLabel(locator: Locator): Promise<string | null> {
 return locator.evaluate(el => {
  if (!(el instanceof HTMLInputElement) || !['radio','checkbox'].includes(el.type) || el.disabled) return null;
  const otherControls = 'a[href],button,input,select,textarea,[role="button"],[contenteditable="true"]';
  const label = Array.from(el.labels || []).find(candidate => {
   const rect = candidate.getBoundingClientRect(), style = getComputedStyle(candidate);
   return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    && !Array.from(candidate.querySelectorAll(otherControls)).some(child => child !== el);
  });
  if (!label) return null;
  return label.contains(el) ? 'ancestor::label[1]' : el.id ? `label[for="${CSS.escape(el.id)}"]` : null;
 }, undefined, {timeout:2000});
}

/** A row's centre may be a nested link/checkbox. Hit-test an ordinary native
 * click on the requested control itself; never force through another control. */
export async function browserContainerClickPosition(locator:Locator){
 return locator.evaluate(el=>{
  const interactive='a[href],button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[contenteditable]:not([contenteditable="false"])';
  if(!el.matches('button,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="row"],[role="listitem"]'))return undefined;
  const box=el.getBoundingClientRect(),points:{x:number;y:number}[]=[{x:box.x+box.width/2,y:box.y+box.height/2}];
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  for(let node=walker.nextNode();node;node=walker.nextNode()){
   if(!node.textContent?.trim()||node.parentElement?.closest(interactive)!==el)continue;
   const range=document.createRange();range.selectNodeContents(node);
   for(const rect of range.getClientRects())if(rect.width>2&&rect.height>2)points.push({x:rect.x+rect.width/2,y:rect.y+rect.height/2});
  }
  for(const y of [.04,.12,.3,.7,.88,.96])for(const x of [.02,.08,.3,.7,.92,.98])points.push({x:box.x+box.width*x,y:box.y+box.height*y});
  for(const p of points){
   if(p.x<0||p.y<0||p.x>=innerWidth||p.y>=innerHeight)continue;
   let hit=document.elementFromPoint(p.x,p.y);while(hit?.shadowRoot){const inner=hit.shadowRoot.elementFromPoint(p.x,p.y);if(!inner||inner===hit)break;hit=inner;}
   if(hit&&(hit===el||el.contains(hit))&&hit.closest(interactive)===el)return {x:p.x-box.x-(el as HTMLElement).clientLeft,y:p.y-box.y-(el as HTMLElement).clientTop};
  }
  return null;
 },undefined,{timeout:2000});
}
