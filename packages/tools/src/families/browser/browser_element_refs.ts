let registered: Promise<string> | undefined;
let generation=0;

/** Observed DOM identities, independent of mutable attributes on page controls. */
export function ensureBrowserElementRefs(attachedContext=false): Promise<string> {
  // connectOverCDP's existing default context does not inherit pre-registered
  // engines. Register a new generation after attachment, before using locators.
  if(attachedContext)registered=undefined;
  return registered ??= import('playwright').then(async ({selectors}) => {
    const name='liminalref'+(++generation);
    await selectors.register(name, () => ({
    query(root: Document | Element, selector: string): Element | null {
      const split = selector.indexOf(':');
      const targets = (window as unknown as Record<string, Map<string, WeakRef<Element>>>)[selector.slice(0, split)];
      const node = targets?.get(selector.slice(split + 1))?.deref();
      return node?.isConnected && (root.nodeType === 9 || root.contains(node)) ? node : null;
    },
    queryAll(root: Document | Element, selector: string): Element[] {
      const node = this.query(root, selector);
      return node ? [node] : [];
    },
    }));
    return name;
  }).catch(error => { registered = undefined; throw error; });
}
