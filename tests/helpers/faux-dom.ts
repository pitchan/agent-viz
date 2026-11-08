// Un faux document pour les vues de l'observatoire : pas de navigateur, pas de
// jsdom. Les assertions cherchent les noeuds par classe dans l'arbre a plat.

export function fauxElement(tag: string): any {
  const classes = new Set<string>();
  return {
    tagName: tag.toUpperCase(),
    children: [] as any[],
    handlers: {} as Record<string, any>,
    dataset: {} as Record<string, any>,
    attrs: {} as Record<string, any>,
    disabled: false,
    open: false,
    hidden: false,
    title: '',
    type: '',
    value: '',
    scrolled: false,
    _text: '',
    get textContent() { return this._text; },
    set textContent(v: string) { this._text = v; this.children.length = 0; },
    set className(v: string) { classes.clear(); for (const c of v.split(/\s+/)) if (c) classes.add(c); },
    get className() { return [...classes].join(' '); },
    classList: {
      add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c),
      toggle: (c: string, force?: boolean) => {
        const on = force ?? !classes.has(c);
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
      contains: (c: string) => classes.has(c),
    },
    setAttribute(k: string, v: any) { this.attrs[k] = v; },
    append(...nodes: any[]) { this.children.push(...nodes); },
    appendChild(n: any) { this.children.push(n); return n; },
    addEventListener(evt: string, fn: (...a: any[]) => void) { this.handlers[evt] = fn; },
    click() { this.handlers.click && this.handlers.click({ target: this, preventDefault() {} }); },
    scrollIntoView() { this.scrolled = true; },
  };
}

export const aPlat = (n: any): any[] => [n, ...n.children.flatMap(aPlat)];
export const parClasse = (racine: any, classe: string) =>
  aPlat(racine).filter(n => n.classList && n.classList.contains(classe));
// Le texte visible d'un noeud et de ses enfants, comme textContent d'un vrai DOM.
export const texte = (n: any): string => n._text + n.children.map(texte).join('');

export function installFauxDocument() {
  globalThis.document = { createElement: fauxElement } as unknown as Document;
}
