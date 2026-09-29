/**
 * Upright modal dialogs and toasts for the shell (confirm, name entry, text viewer).
 */
import { t } from '@/i18n';
import { sfx } from '@/ui/audio/sfx';
import { button, h } from './dom';

interface OpenDialog {
  el: HTMLElement;
  close: () => void;
}
const stack: OpenDialog[] = [];

/** Close the top-most dialog (hardware back). Returns true if one was open. */
export function closeTopDialog(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export function openDialog(
  build: (close: () => void) => HTMLElement,
  opts: { top?: boolean; dismissable?: boolean; onClose?: () => void; cls?: string } = {},
): () => void {
  const backdrop = h('div', { class: `dlg-backdrop ${opts.top ? 'is-top' : ''} ${opts.cls ?? ''}`.trim() });
  let closed = false;
  const entry: OpenDialog = { el: backdrop, close: () => close() };
  const close = () => {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    backdrop.classList.add('is-closing');
    setTimeout(() => backdrop.remove(), 160);
    opts.onClose?.();
  };
  const panel = build(close);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  backdrop.append(panel);
  if (opts.dismissable !== false) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
  }
  stack.push(entry);
  document.body.append(backdrop);
  return close;
}

export function confirmDialog(o: {
  title: string;
  body?: string;
  ok: string;
  cancel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    openDialog(
      (close) =>
        h(
          'div',
          { class: 'dlg' },
          h('h2', { class: 'dlg-title' }, o.title),
          o.body ? h('p', { class: 'dlg-body' }, o.body) : null,
          h(
            'div',
            { class: 'dlg-actions' },
            button(o.cancel ?? t('shell.cancel'), () => close(), { cls: 'btn-ghost' }),
            button(o.ok, () => {
              result = true;
              close();
            }, { cls: o.danger ? 'btn-coral' : 'btn-primary' }),
          ),
        ),
      { onClose: () => resolve(result) },
    );
  });
}

/** Name entry: upright, near the top so the on-screen keyboard never covers it. */
export function promptText(o: {
  title: string;
  value: string;
  placeholder?: string;
  maxLength: number;
}): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    let input!: HTMLInputElement;
    openDialog(
      (close) => {
        input = h('input', {
          class: 'dlg-input',
          type: 'text',
          value: o.value,
          maxlength: o.maxLength,
          placeholder: o.placeholder ?? '',
          autocomplete: 'off',
          autocapitalize: 'words',
          spellcheck: 'false',
          enterkeyhint: 'done',
          'aria-label': o.title,
        });
        const counter = h('span', { class: 'dlg-counter num' }, `${o.value.length}/${o.maxLength}`);
        input.addEventListener('input', () => {
          counter.textContent = `${input.value.length}/${o.maxLength}`;
        });
        const submit = () => {
          result = input.value;
          close();
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            sfx.play('tap');
            submit();
          }
        });
        const clear = h('button', { type: 'button', class: 'dlg-clear', 'aria-label': t('shell.clear') }, '×');
        clear.addEventListener('click', () => {
          input.value = '';
          counter.textContent = `0/${o.maxLength}`;
          input.focus();
        });
        return h(
          'div',
          { class: 'dlg dlg-name' },
          h('h2', { class: 'dlg-title' }, o.title),
          h('div', { class: 'dlg-field' }, input, clear, counter),
          h(
            'div',
            { class: 'dlg-actions' },
            button(t('shell.cancel'), () => close(), { cls: 'btn-ghost' }),
            button(t('shell.ok'), submit, { cls: 'btn-primary' }),
          ),
        );
      },
      { top: true, onClose: () => resolve(result) },
    );
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

let toastHost: HTMLElement | null = null;
export function toast(text: string, ms = 1800): void {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: 'toast' }, text);
  toastHost.append(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 280);
  }, ms);
}
