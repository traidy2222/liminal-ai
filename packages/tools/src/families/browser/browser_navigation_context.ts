export type RequestedDates = {start: string; end: string};
const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const monthPattern = months.map(m => m.slice(0,3) + '(?:' + m.slice(3) + ')?').join('|');
function iso(year:number, month:number, day:number):string|undefined {
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date.toISOString().slice(0,10):undefined;
}

/** Only unambiguous, explicit ranges are authoritative. Never infer a year. */
export function requestedBrowserDates(text:string):RequestedDates|undefined {
  if(/\b(?:flexible\s+(?:travel\s+)?dates?|dates?\s+(?:are\s+)?flexible|(?:other|nearby|different)\s+dates?)\b/i.test(text))return;
  const ranges:RequestedDates[]=[];
  for(const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\s*(?:to|through|until|[–—])\s*(\d{4}-\d{2}-\d{2})\b/gi))ranges.push({start:m[1]!,end:m[2]!});
  const dayFirst=new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*[-–—]\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\.?\\s+(\\d{4})\\b`,'gi');
  const monthFirst=new RegExp(`\\b(${monthPattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*[-–—]\\s*(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,'gi');
  for(const [regex,first] of [[dayFirst,true],[monthFirst,false]] as const)for(const m of text.matchAll(regex)){
    const month=months.findIndex(name=>name.startsWith((first?m[3]:m[1])!.toLowerCase().slice(0,3)))+1;
    const start=iso(Number(m[4]),month,Number(first?m[1]:m[2])),end=iso(Number(m[4]),month,Number(first?m[2]:m[3]));
    if(start&&end)ranges.push({start,end});
  }
  const unique=[...new Map(ranges.map(r=>[r.start+'/'+r.end,r])).values()];
  if(unique.length!==1)return;
  const dates=unique[0]!;
  if(!dates.start.split('-').map(Number).every(Number.isFinite)||!dates.end.split('-').map(Number).every(Number.isFinite))return;
  const valid=(value:string)=>{const [y,m,d]=value.split('-').map(Number);return iso(y!,m!,d!)===value;};
  return valid(dates.start)&&valid(dates.end)&&dates.start<dates.end?dates:undefined;
}

const datePairs=[['checkin','checkout'],['check_in','check_out'],['check-in','check-out'],['checkin_date','checkout_date'],['arrival_date','departure_date'],['start_date','end_date']] as const;

/** Correct explicit date fields; preserve selected dates when refining the same
 * page. Other paths/origins and opaque/signed URLs are never given invented keys. */
export function applyBrowserDateContext(href:string,dates?:RequestedDates,currentHref?:string):{url:string;changes:string[]} {
  const url=new URL(href),changes:string[]=[];
  if([...url.searchParams.keys()].some(key=>/^(signature|sig|hmac|x-amz-signature|x-goog-signature)$/i.test(key)))return {url:href,changes};
  let current:URL|undefined;try{if(currentHref)current=new URL(currentHref);}catch{}
  for(const [startKey,endKey] of datePairs){
    const hasFields=url.searchParams.has(startKey)||url.searchParams.has(endKey);
    const samePage=current?.origin===url.origin&&current?.pathname===url.pathname;
    const inherited=samePage&&current?.searchParams.has(startKey)&&current.searchParams.has(endKey);
    if(!hasFields&&!inherited)continue;
    if([url.searchParams.get(startKey),url.searchParams.get(endKey)].some(value=>value&&!/^\d{4}-\d{2}-\d{2}$/.test(value)))continue;
    const start=dates?.start??url.searchParams.get(startKey)??(inherited?current!.searchParams.get(startKey):undefined);
    const end=dates?.end??url.searchParams.get(endKey)??(inherited?current!.searchParams.get(endKey):undefined);
    if(!start||!end)continue;
    for(const [key,value]of [[startKey,start],[endKey,end]])if(url.searchParams.get(key!)!==value){url.searchParams.set(key!,value!);changes.push(`${key}=${value}`);}
  }
  return {url:changes.length?url.href:href,changes};
}

export function isCurrentBrowserTabHandle(value:unknown):boolean {
  return typeof value==='string'&&['current','selected','main','latest'].includes(value.trim().toLowerCase());
}

/** Extra tracking fields do not change page identity. Explicit expected query
 * values, including dates, must still match exactly. */
export function browserPageMatches(expectedHref:string,actualHref:string):boolean {
  try{
    const expected=new URL(expectedHref),actual=new URL(actualHref);
    if(expected.origin!==actual.origin||expected.pathname!==actual.pathname)return false;
    return [...new Set(expected.searchParams.keys())].every(key=>JSON.stringify(expected.searchParams.getAll(key))===JSON.stringify(actual.searchParams.getAll(key)));
  }catch{return false;}
}
