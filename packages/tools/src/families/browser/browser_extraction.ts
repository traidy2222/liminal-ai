/** Bound extraction data, keeping useful text ahead of optional link metadata. */
export function pageExtractedItems(data: unknown[], options: {offset?: number; maxChars?: number}, deduplicate = false) {
  const seen = new Set<string>();
  const items = deduplicate ? data.filter(item => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }) : data;
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  if (offset > 0 && offset >= items.length)
    throw new Error(`offset=${offset} is outside ${items.length} matches. This extraction uses zero-based item indexes, not character offsets. Start at 0 or use the returned next_offset.`);
  const budget = Math.max(500, Math.min(6000, Math.floor(options.maxChars ?? 5000)));
  const page: unknown[] = [], clipped: number[] = [];
  const envelope = () => ({items: page, offset, offset_unit: 'items' as const, total_matches: items.length,
    next_offset: offset + page.length < items.length ? offset + page.length : null,
    ...(deduplicate && items.length !== data.length ? {duplicate_matches_omitted: data.length - items.length} : {}),
    ...(clipped.length ? {truncated_items: clipped, note: 'Narrow the selector or query to read clipped matches in full.'} : {})});
  for (let i = offset; i < items.length && page.length < 20; i++) {
    page.push(items[i]);
    if (JSON.stringify(envelope()).length <= budget) continue;
    page.pop();
    if (page.length) break;
    const item = items[i];
    const row = item && typeof item === 'object' && !Array.isArray(item) ? {...item} as Record<string, unknown> : undefined;
    if (Array.isArray(row?.links)) row.links = row.links.slice(0, 2);
    const field = row && typeof row.nearbyText === 'string' ? 'nearbyText' : 'text';
    const value = typeof item === 'string' ? item : typeof row?.[field] === 'string' ? row[field] as string : undefined;
    if (value === undefined) throw new Error('Extracted item exceeds max_chars. Narrow the selector or increase max_chars.');
    clipped.push(i);
    let low = 0, high = value.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      page[0] = row ? {...row, [field]: value.slice(0, mid)} : value.slice(0, mid);
      if (JSON.stringify(envelope()).length <= budget) low = mid; else high = mid - 1;
    }
    page[0] = row ? {...row, [field]: value.slice(0, low)} : value.slice(0, low);
    if (JSON.stringify(envelope()).length > budget)
      throw new Error('Extraction metadata exceeds max_chars. Narrow the selector or increase max_chars.');
    break;
  }
  return envelope();
}

/** The budget covers serialized text data too, including escaped line breaks. */
export function pageExtractedText(value:string,options:{offset?:number;maxChars?:number}) {
  const offset=Math.max(0,Math.floor(options.offset??0));
  if(offset>0&&offset>=value.length)throw new Error(`offset=${offset} is outside ${value.length} characters. Start at 0 or use next_offset.`);
  const budget=Math.max(500,Math.min(6000,Math.floor(options.maxChars??5000)));
  const envelope=(length:number)=>({offset,offset_unit:'characters' as const,total_chars:value.length,
    next_offset:offset+length<value.length?offset+length:null,text:value.slice(offset,offset+length)});
  let low=0,high=Math.min(value.length-offset,budget);
  while(low<high){const mid=Math.ceil((low+high)/2);if(JSON.stringify(envelope(mid)).length<=budget)low=mid;else high=mid-1;}
  return envelope(low);
}

/** Keep exact destinations in the DOM; large tracking URLs become clickable refs. */
export function compactExtractedLinks(value: unknown, register: (selector: string, name: string, href: string) => string): unknown {
  if (Array.isArray(value)) return value.map(item => compactExtractedLinks(item, register));
  if (!value || typeof value !== 'object') return value;
  const row = {...value} as Record<string, unknown>;
  if (typeof row.href === 'string' && typeof row.selector === 'string') {
    row.ref = register(row.selector, String(row.text ?? ''), row.href);
    delete row.selector;
    if (row.href.length > 300) {
      const url = new URL(row.href);
      const destination = url.origin + url.pathname;
      row.destination = destination.length > 240 ? destination.slice(0, 237) + '…' : destination;
      row.url_chars = row.href.length;
      delete row.href;
    }
    return row;
  }
  for (const [key, item] of Object.entries(row)) row[key] = compactExtractedLinks(item, register);
  return row;
}
