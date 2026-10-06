/**
 * In-game "≡" menu (top-left, upright — whoever reaches for it can read it at a glance).
 * Rules · sound / haptics toggles · save & quit · resign (with confirm). The pause button next to it
 * opens the same sheet as a pause screen (title "paused", Resume first).
 */
import { t } from '@/i18n';
import { sfx } from '@/ui/audio/sfx';
import { haptic, setHapticsEnabled } from '@/ui/audio/haptics';
import { prefs } from '@/ui/shell/prefs';
import { anim } from '@/ui/fx/time';
import { FocusTrap } from '@/ui/shell/focus';
import { h, iconEl } from './util';
import { EASE } from '@/ui/fx/motion';

export interface MenuHandlers {
  onOpen: () => void;
  onClose: () => void;
  onRules: () => void;
  onSettings: () => void;
  onSaveQuit: () => void;
  onResign: () => void;
}

export class GameMenu {
  readonly button: HTMLButtonElement;
  readonly pauseButton: HTMLButtonElement;
  readonly overlay: HTMLElement;
  private sheet: HTMLElement;
  private open = false;
  private paused = false;
  private lastToggle = 0;
  private trap: FocusTrap | null = null;

  constructor(private hnd: MenuHandlers) {
    this.button = h('button', { class: 'menu-btn', type: 'button', 'aria-label': t('g.menu') });
    this.button.append(iconEl('menu', 'ico'));
    this.button.addEventListener('click', () => this.toggle());
    this.pauseButton = h('button', { class: 'pause-btn', type: 'button', 'aria-label': t('g.pause') });
    this.pauseButton.append(iconEl('pause', 'ico'));
    this.pauseButton.addEventListener('click', () => this.show(true));
    this.sheet = h('div', { class: 'menu-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('g.menu') });
    this.overlay = h('div', { class: 'menu-overlay' }, this.sheet);
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Debounced toggle (Escape + hardware back may both fire). */
  toggle(): void {
    const now = performance.now();
    if (now - this.lastToggle < 250) return;
    this.lastToggle = now;
    if (this.open) this.close();
    else this.show();
  }

  /** `paused`: opened as the pause screen (pause button / timer tap). */
  show(paused = false): void {
    if (this.open) return;
    this.open = true;
    this.paused = paused;
    sfx.play('tap');
    this.renderMain();
    this.overlay.classList.add('is-open');
    const trap = new FocusTrap(this.sheet);
    this.trap = trap;
    requestAnimationFrame(() => {
      if (this.open && this.trap === trap) trap.activate();
    });
    this.hnd.onOpen();
    void anim(this.sheet, [{ transform: 'translateY(-12px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
      duration: 220,
      easing: EASE.settle,
    });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.overlay.classList.remove('is-open');
    this.trap?.dispose();
    this.trap = null;
    this.hnd.onClose();
    if (this.button.isConnected) this.button.focus();
  }

  private item(icon: string, label: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = h('button', { class: `menu-item ${cls}`, type: 'button' }, iconEl(icon, 'ico'), h('span', { text: label }));
    b.addEventListener('click', () => {
      sfx.play('tap');
      haptic('light');
      onClick();
    });
    return b;
  }

  private toggleItem(icon: string, offIcon: string, label: string, on: boolean, set: (v: boolean) => void): HTMLButtonElement {
    const b = h('button', { class: `menu-item is-toggle${on ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(on) });
    const draw = (v: boolean): void => {
      b.innerHTML = '';
      b.classList.toggle('is-on', v);
      b.setAttribute('aria-pressed', String(v));
      b.append(iconEl(v ? icon : offIcon, 'ico'), h('span', { text: label }), h('span', { class: 'mi-state', text: v ? t('g.on') : t('g.off') }));
    };
    draw(on);
    b.addEventListener('click', () => {
      on = !on;
      set(on);
      draw(on);
      sfx.play('tap');
      haptic('light');
    });
    return b;
  }

  private renderMain(): void {
    const p = safePrefs();
    this.sheet.innerHTML = '';
    const resume = this.item('play', t('g.menu.resume'), () => this.close(), 'is-primary');
    this.sheet.append(
      h('div', { class: 'menu-title' }, h('span', { text: t(this.paused ? 'g.paused' : 'g.menu') }), this.closeBtn()),
      ...(this.paused ? [resume] : []),
      this.item('help', t('g.menu.rules'), () => {
        this.close();
        this.hnd.onRules();
      }),
      this.item('settings', t('g.menu.settings'), () => {
        this.close();
        this.hnd.onSettings();
      }),
      this.toggleItem('sound-on', 'sound-off', t('g.menu.sound'), p.sound, (v) => {
        try {
          prefs.set({ sound: v });
        } catch {
          /* prefs unavailable */
        }
        sfx.setMuted(!v);
      }),
      this.toggleItem('vibrate', 'vibrate', t('g.menu.haptics'), p.haptics, (v) => {
        try {
          prefs.set({ haptics: v });
        } catch {
          /* prefs unavailable */
        }
        setHapticsEnabled(v);
      }),
      this.item('save', t('g.menu.saveQuit'), () => {
        this.close();
        this.hnd.onSaveQuit();
      }),
      this.item('close', t('g.menu.resign'), () => this.renderConfirm(), 'is-danger'),
      ...(this.paused ? [] : [resume]),
    );
    if (this.open) this.trap?.activate();
  }

  private renderConfirm(): void {
    this.sheet.innerHTML = '';
    this.sheet.append(
      h('div', { class: 'menu-title' }, h('span', { text: t('g.menu.resign') }), this.closeBtn()),
      h('p', { class: 'menu-text', text: t('g.menu.resign.confirm') }),
      this.item('close', t('g.menu.resign.yes'), () => {
        this.close();
        this.hnd.onResign();
      }, 'is-danger'),
      this.item('chevron-left', t('g.menu.back'), () => this.renderMain()),
    );
    this.trap?.activate();
  }

  private closeBtn(): HTMLButtonElement {
    const b = h('button', { class: 'menu-x', type: 'button', 'aria-label': t('g.menu.close') }, iconEl('close', 'ico'));
    b.addEventListener('click', () => this.close());
    return b;
  }
}

function safePrefs(): { sound: boolean; haptics: boolean } {
  try {
    const p = prefs.get();
    return { sound: p.sound, haptics: p.haptics };
  } catch {
    return { sound: true, haptics: true };
  }
}
