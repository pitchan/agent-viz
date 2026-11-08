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
    set innerHTML(v: string) { this._text = v; this.children.length = 0; },
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
    parent: null as any,
    append(...nodes: any[]) { for (const n of nodes) this.appendChild(n); },
    appendChild(n: any) { n.parent = this; this.children.push(n); return n; },
    addEventListener(evt: string, fn: (...a: any[]) => void) { this.handlers[evt] = fn; },
    click() { this.handlers.click && this.handlers.click({ target: this, preventDefault() {} }); },
    scrollIntoView() { this.scrolled = true; },
    matches(sel: string) { return correspond(this, sel); },
    closest(sel: string) {
      let n = this;
      while (n && !correspond(n, sel)) n = n.parent;
      return n ?? null;
    },
    querySelector(sel: string) {
      return aPlat(this).slice(1).find(n => correspond(n, sel)) ?? null;
    },
  };
}

// Les selecteurs que les vues emploient : `balise`, `.classe` et `[data-x]` ou
// `[data-x="v"]`, combinables (`.advisor-card[data-rec-id="7"]`). Un autre se refuse.
const SELECTEUR = /^([a-z]+)?(?:\.([\w-]+))?(?:\[data-([\w-]+)(?:="([^"]*)")?\])?$/;

function correspond(n: any, sel: string) {
  const m = SELECTEUR.exec(sel);
  if (!m || sel === '') throw new Error(`selecteur non pris en charge par le faux DOM : ${sel}`);
  const [, balise, classe, data, valeur] = m;
  if (balise && n.tagName !== balise.toUpperCase()) return false;
  if (classe && !n.classList.contains(classe)) return false;
  if (data) {
    const cle = data.replace(/-(\w)/g, (_: string, c: string) => c.toUpperCase());
    if (!(cle in n.dataset)) return false;
    if (valeur !== undefined && String(n.dataset[cle]) !== valeur) return false;
  }
  return true;
}

export const aPlat = (n: any): any[] => [n, ...n.children.flatMap(aPlat)];
export const parClasse = (racine: any, classe: string) =>
  aPlat(racine).filter(n => n.classList && n.classList.contains(classe));
// Le texte visible d'un noeud et de ses enfants, comme textContent d'un vrai DOM.
export const texte = (n: any): string => n._text + n.children.map(texte).join('');

export function installFauxDocument() {
  globalThis.document = { createElement: fauxElement } as unknown as Document;
}
