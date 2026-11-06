/** Bound new extraction results without rewriting earlier observations. */
export function pageExtractedItems(data:unknown[],options:{offset?:number;maxChars?:number},deduplicate=false) {
 const seen=new Set<string>();
 const items=deduplicate?data.filter(item=>{const key=JSON.stringify(item);if(seen.has(key))return false;seen.add(key);return true;}):data;
 const offset=Math.max(0,Math.floor(options.offset??0));
 const budget=Math.max(500,Math.min(6000,Math.floor(options.maxChars??5000)));
 const page:unknown[]=[];const clipped:number[]=[];let used=0;
 for(let i=offset;i<items.length;i++){
  let item=items[i];
  if(typeof item==='string'&&item.length>budget-200){item=item.slice(0,budget-200);clipped.push(i);}
  const size=JSON.stringify(item).length;
  if(page.length&&used+size>budget)break;
  // A matched passage carries its heading and links; preserve them even when
  // its excerpt needs shortening. Report the loss explicitly.
  if(!page.length&&size>budget&&item&&typeof item==='object'&&!Array.isArray(item)){
   const row={...item} as Record<string,unknown>;
   const field=typeof row.nearbyText==='string'?'nearbyText':'text';
   if(typeof row[field]==='string'){const value=row[field] as string;row[field]=value.slice(0,Math.max(100,budget-(size-value.length)-200));item=row;clipped.push(i);}
  }
  page.push(item);used+=JSON.stringify(item).length;
  if(page.length>=20)break;
 }
 const next=offset+page.length;
 return {items:page,offset,total_matches:items.length,next_offset:next<items.length?next:null,
  ...(deduplicate&&items.length!==data.length?{duplicate_matches_omitted:data.length-items.length}:{}),
  ...(clipped.length?{truncated_items:clipped,note:'Narrow the query or selector to read clipped matches in full.'}:{})};
}
