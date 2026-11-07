/** Reserve evidence space before budgeting controls; never cut off the whole readable section. */
export function formatBrowserSnapshot(input:{observedAt:unknown;authentication?:unknown;contexts:string[];controls:string[];readable:string;tree:string},maxChars=8000):string {
 const budget=Math.max(2000,maxChars),refBudget=Math.floor(budget*.48),textBudget=Math.floor(budget*.35);
 const lines:string[]=[];let used=0;
 for(const line of input.controls){if(used+line.length+1>refBudget)continue;lines.push(line);used+=line.length+1;}
 const omitted=input.controls.length-lines.length;
 const context=input.contexts.join('\n');
 const readable=input.readable||input.tree||'(no rendered text)';
 return `OBSERVED_AT: ${JSON.stringify(input.observedAt)}${input.authentication?'\nAUTHENTICATION_CONTEXT: '+JSON.stringify(input.authentication):''}\nPAGE_CONTEXT:\n${context.slice(0,Math.floor(budget*.12))}${context.length>budget*.12?'\n…(context truncated)':''}\nSNAPSHOT_REFS (unchanged controls retain refs; replaced or hidden controls expire):\n${lines.join('\n')||'  (no visible interactive controls)'}${omitted?'\n…('+omitted+' controls omitted; use browser_extract forms/links or a narrower view)':''}\nREADABLE_CONTENT:\n${readable.slice(0,textBudget)}${readable.length>textBudget?'\n…(text truncated; use browser_extract with query or offset)':''}\nA11Y_TREE_EXCERPT:\n`;
}

function section(text: string, label: string, end: string): string {
  const start = text.indexOf(label); if (start < 0) return "";
  const finish = text.indexOf(end, start + label.length);
  return text.slice(start + label.length, finish < 0 ? undefined : finish).trim();
}
function controls(text: string): Map<string, string> {
  return new Map(text.split("\n").flatMap(line => { const ref = line.match(/^\s+(e\d+)\s/); return ref ? [[ref[1]!, line] as const] : []; }));
}

/** Keep historical messages append-only; compact only newly returned observations. */
export class BrowserObservations {
  private pages = new Map<string, string>();
  format(url: string, current: string, full = false): string {
    const before = this.pages.get(url); this.pages.delete(url); this.pages.set(url, current);
    if (this.pages.size > 8) this.pages.delete(this.pages.keys().next().value!);
    if (!before || full) return current;
    const oldRefs = controls(before), refs = controls(current);
    const changed = [...refs].filter(([id, line]) => oldRefs.get(id) !== line).map(([, line]) => line);
    const removed = [...oldRefs.keys()].filter(id => !refs.has(id));
    const oldContext = section(before, "PAGE_CONTEXT:\n", "\nSNAPSHOT_REFS");
    const context = section(current, "PAGE_CONTEXT:\n", "\nSNAPSHOT_REFS");
    const oldText = section(before, "READABLE_CONTENT:\n", "\nA11Y_TREE_EXCERPT:");
    const text = section(current, "READABLE_CONTENT:\n", "\nA11Y_TREE_EXCERPT:");
    const parts = [current.split("\n")[0]!, "OBSERVATION_DELTA: Reuse unchanged refs and content from the previous observation of this URL. browser_snapshot returns a full view."];
    const auth=current.split('\n').find(line=>line.startsWith('AUTHENTICATION_CONTEXT: ')),oldAuth=before.split('\n').find(line=>line.startsWith('AUTHENTICATION_CONTEXT: '));
    if(auth&&auth!==oldAuth)parts.push(auth);
    if(!auth&&oldAuth)parts.push('AUTHENTICATION_CONTEXT: null');
    if (context !== oldContext) parts.push("PAGE_CONTEXT:\n" + context);
    if (changed.length) parts.push("CHANGED_REFS:\n" + changed.join("\n"));
    if (removed.length) parts.push("EXPIRED_REFS: " + removed.join(", "));
    if (oldText !== text) {
      let start = 0; while (start < oldText.length && start < text.length && oldText[start] === text[start]) start++;
      let oldEnd = oldText.length, end = text.length;
      while (oldEnd > start && end > start && oldText[oldEnd - 1] === text[end - 1]) { oldEnd--; end--; }
      const from = Math.max(0, start - 180), to = Math.min(text.length, Math.max(end + 180, from + 400));
      parts.push("CONTENT_CHANGE: " + JSON.stringify({offset:from,changed_from:start,changed_to:end,previous_changed_to:oldEnd,text:text.slice(from,Math.min(to,from+2200)),truncated:to-from>2200}));
    }
    if (context === oldContext && !changed.length && !removed.length && oldText === text) parts.push("No reported text/control changes. Visual changes may still require a screenshot.");
    return parts.join("\n");
  }
}
