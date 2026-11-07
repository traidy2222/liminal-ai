import type {Page} from 'playwright';

/** Scroll the active content pane, not only the outer document. */
export async function scrollBrowserPage(page:Page,direction:'top'|'bottom'|'up'|'down'|'left'|'right',px=1200){
 return page.evaluate(async({direction,px})=>{
  const horizontal=direction==='left'||direction==='right',offset=horizontal?'scrollLeft':'scrollTop',extent=horizontal?'scrollWidth':'scrollHeight',viewport=horizontal?'clientWidth':'clientHeight',overflow=horizontal?'overflowX':'overflowY';
  const shown=(el:Element)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth&&getComputedStyle(el).visibility!=='hidden';};
  const dialogs=[...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"]')].filter(shown);
  const scope=dialogs.find(el=>el.contains(document.activeElement))??dialogs.at(-1)??document.body;
  const roots:(Element|ShadowRoot)[]=[scope];for(let i=0;i<roots.length;i++)for(const el of roots[i]!.querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);
  const candidates=roots.flatMap(root=>[...root.querySelectorAll<HTMLElement>('*')]).filter(el=>shown(el)&&!el.matches('input,textarea,[contenteditable]:not([contenteditable="false"])')&&el[extent]>el[viewport]+1&&/(auto|scroll|overlay)/.test(getComputedStyle(el)[overflow]));
  if(scope instanceof HTMLElement&&scope[extent]>scope[viewport]+1&&/(auto|scroll)/.test(getComputedStyle(scope)[overflow]))candidates.push(scope);
  const documentScroller=document.scrollingElement as HTMLElement|null;
  if(scope===document.body&&documentScroller&&documentScroller[extent]>documentScroller[viewport]+1)candidates.push(documentScroller);
  const score=(el:HTMLElement)=>{const r=el.getBoundingClientRect(),area=Math.max(0,Math.min(r.right,innerWidth)-Math.max(0,r.left))*Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(0,r.top));const nav=el.closest('nav,aside,[role="navigation"]');return area*(nav&&!nav.contains(document.activeElement)?0.1:1)*(el.contains(document.activeElement)?2:1);};
  candidates.sort((a,b)=>score(b)-score(a));
  const target=candidates[0]??document.scrollingElement??document.documentElement;
  const before=target[offset],max=Math.max(0,target[extent]-target[viewport]);
  target[offset]=direction==='top'?0:direction==='bottom'?max:before+(direction==='down'||direction==='right'?px:-px);
  await new Promise(r=>setTimeout(r,60));
  return {target:target.getAttribute('aria-label')||target.getAttribute('role')||target.tagName.toLowerCase(),axis:horizontal?'x':'y',before,after:target[offset],max,moved:Math.abs(target[offset]-before)>0.5};
 },{direction,px});
}
