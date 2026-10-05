/** A tiny DOM stand-in (vitest runs in node): just what the money stage touches. */
export class FakeStyle {
  [k: string]: unknown;
  private props = new Map<string, string>();
  setProperty(k: string, v: string): void {
    this.props.set(k, v);
  }
  getPropertyValue(k: string): string {
    return this.props.get(k) ?? '';
  }
}

export class FakeEl {
  className = '';
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  style = new FakeStyle() as FakeStyle & Record<string, string>;
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  textContent = '';
  innerHTML = '';
  hidden = false;
  private cls = new Set<string>();
  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDoc,
  ) {}
  get classList() {
    const self = this;
    const sync = (): void => {
      const base = self.className.split(/\s+/).filter(Boolean);
      for (const c of base) self.cls.add(c);
    };
    return {
      add: (...c: string[]) => (sync(), c.forEach((x) => self.cls.add(x))),
      remove: (...c: string[]) => (sync(), c.forEach((x) => self.cls.delete(x))),
      toggle: (c: string, on?: boolean) => {
        sync();
        const want = on ?? !self.cls.has(c);
        if (want) self.cls.add(c);
        else self.cls.delete(c);
        return want;
      },
      contains: (c: string) => (sync(), self.cls.has(c)),
    };
  }
  append(...n: FakeEl[]): void {
    for (const c of n) {
      c.parent = this;
      this.children.push(c);
    }
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  querySelector(): null {
    return null;
  }
  querySelectorAll(): FakeEl[] {
    return [];
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1600, height: 1000, x: 0, y: 0, right: 1600, bottom: 1000 };
  }
  /** Every descendant. */
  all(): FakeEl[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
}

export class FakeDoc {
  createElement(tag: string): FakeEl {
    return new FakeEl(tag, this);
  }
}

export function fakeParent(): HTMLElement {
  return new FakeDoc().createElement('div') as unknown as HTMLElement;
}
