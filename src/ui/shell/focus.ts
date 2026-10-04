/** Keyboard focus containment for the currently active modal surface. */
const selector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let active: FocusTrap | null = null;

function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(selector)].filter((el) => el.getClientRects().length > 0 && !el.closest('[aria-hidden="true"]'));
}

export class FocusTrap {
  private disposed = false;
  private observer: MutationObserver;

  constructor(private container: HTMLElement) {
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('focusin', this.onFocusIn, true);
    this.observer = new MutationObserver(() => {
      if (!this.container.isConnected) this.dispose();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  activate(preferred?: HTMLElement | null): void {
    if (this.disposed) return;
    active = this;
    // Activation runs a frame after opening: keep a focus the user already moved inside.
    if (!preferred && this.container.contains(document.activeElement)) return;
    this.focus(preferred);
  }

  focus(preferred?: HTMLElement | null): void {
    if (preferred?.isConnected && this.container.contains(preferred)) {
      preferred.focus();
      return;
    }
    const first = focusables(this.container)[0];
    if (first) first.focus();
    else {
      this.container.tabIndex = -1;
      this.container.focus();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (active === this) active = null;
    this.observer.disconnect();
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('focusin', this.onFocusIn, true);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (active !== this || event.key !== 'Tab') return;
    const items = focusables(this.container);
    if (!items.length) {
      event.preventDefault();
      this.focus();
      return;
    }
    const current = document.activeElement as HTMLElement | null;
    const index = current ? items.indexOf(current) : -1;
    if (event.shiftKey ? index <= 0 : index === -1 || index === items.length - 1) {
      event.preventDefault();
      items[event.shiftKey ? items.length - 1 : 0]!.focus();
    }
  };

  private onFocusIn = (event: FocusEvent): void => {
    if (active === this && !this.container.contains(event.target as Node)) this.focus();
  };
}
