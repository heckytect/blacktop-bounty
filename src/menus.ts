import { firstGamepad } from './input';
import { ACTION_LABELS, DEFAULT_BINDINGS, keyLabel, type Action, type Graphics, type Settings } from './settings';

// Spec §11 menus: one overlay, fully keyboard and gamepad navigable (↑/↓ or D-pad, Enter/Ⓐ, Esc/Ⓑ).

export interface Choice<T> {
  label: string;
  value: T;
  hint?: string;
  disabled?: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Menus {
  private readonly root = document.getElementById('menu')!;
  private cleanup: (() => void) | null = null;
  /** Click feedback hook (audio). */
  onMove?: () => void;

  get isOpen() {
    return !this.root.hidden;
  }

  /**
   * Show a screen and resolve with the chosen value, or `back` when Esc/Ⓑ is pressed.
   * `body` is trusted HTML built by the game (dynamic text is escaped by callers via `text()`).
   */
  choose<T>(title: string, choices: Choice<T>[], opts: { subtitle?: string; body?: string; back?: T; className?: string; onOpen?: (root: HTMLElement) => void } = {}): Promise<T> {
    this.close();
    this.root.className = opts.className ?? '';
    this.root.innerHTML = `
      <div class="panel">
        <h1 id="menu-title">${esc(title)}</h1>
        ${opts.subtitle ? `<p class="sub">${esc(opts.subtitle)}</p>` : ''}
        ${opts.body ?? ''}
        <div class="items">${choices
          .map((c, i) => `<button data-i="${i}" ${c.disabled ? 'disabled' : ''}>${esc(c.label)}${c.hint ? `<small>${esc(c.hint)}</small>` : ''}</button>`)
          .join('')}</div>
      </div>`;
    this.root.hidden = false;
    document.body.classList.add('in-menu');
    opts.onOpen?.(this.root);
    const focusables = () => [...this.root.querySelectorAll<HTMLElement>('button:not([disabled]), input, select')];
    focusables().find((el) => el.tagName === 'BUTTON' && el.closest('.items'))?.focus();

    return new Promise<T>((resolve) => {
      const done = (v: T) => {
        this.close();
        resolve(v);
      };
      const move = (d: number) => {
        const f = focusables();
        const i = f.indexOf(document.activeElement as HTMLElement);
        f[(i + d + f.length) % f.length]?.focus();
        this.onMove?.();
      };
      const onClick = (e: MouseEvent) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.items button');
        if (b && !b.disabled) done(choices[Number(b.dataset.i)].value);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.code === 'Escape' && opts.back !== undefined) return done(opts.back);
        if (e.code === 'Tab') {
          // Keep keyboard focus inside the open menu (WCAG 2.4.3 focus order / modal dialog).
          const f = focusables();
          const i = f.indexOf(document.activeElement as HTMLElement);
          e.preventDefault();
          f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
          return;
        }
        if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
          if ((e.target as HTMLElement).tagName === 'SELECT') return;
          e.preventDefault();
          move(e.code === 'ArrowDown' ? 1 : -1);
        }
      };
      this.root.addEventListener('click', onClick);
      addEventListener('keydown', onKey);
      // Gamepad: D-pad moves, A clicks the focused control, B goes back.
      let prev = [true, true, true, true];
      let raf = 0;
      const poll = () => {
        const pad = firstGamepad();
        if (pad) {
          const now = [12, 13, 0, 1].map((b) => !!pad.buttons[b]?.pressed);
          const hit = (k: number) => now[k] && !prev[k];
          if (hit(0)) move(-1);
          if (hit(1)) move(1);
          if (hit(2)) (document.activeElement as HTMLElement)?.click();
          if (hit(3) && opts.back !== undefined) return done(opts.back);
          prev = now;
        }
        raf = requestAnimationFrame(poll);
      };
      raf = requestAnimationFrame(poll);
      this.cleanup = () => {
        this.root.removeEventListener('click', onClick);
        removeEventListener('keydown', onKey);
        cancelAnimationFrame(raf);
      };
    });
  }

  close() {
    this.cleanup?.();
    this.cleanup = null;
    this.root.hidden = true;
    this.root.innerHTML = '';
    document.body.classList.remove('in-menu');
  }

  /** Settings screen (spec §11): volumes, graphics, retro, shake, key rebinding. Changes apply live via onChange. */
  async settings(s: Settings, onChange: (s: Settings) => void): Promise<void> {
    for (;;) {
      const pct = (v: number) => Math.round(v * 100);
      const body = `
        <div class="form">
          <label>Music <input type="range" id="set-music" min="0" max="100" value="${pct(s.music)}"></label>
          <label>Sound effects <input type="range" id="set-sfx" min="0" max="100" value="${pct(s.sfx)}"></label>
          <label>Graphics <select id="set-graphics">${(['low', 'medium', 'high'] as Graphics[]).map((g) => `<option value="${g}" ${g === s.graphics ? 'selected' : ''}>${g[0].toUpperCase() + g.slice(1)}</option>`).join('')}</select></label>
          <label><input type="checkbox" id="set-retro" ${s.retro ? 'checked' : ''}> Retro pixel mode (P)</label>
          <label><input type="checkbox" id="set-shake" ${s.shake ? 'checked' : ''}> Screen shake</label>
        </div>`;
      const pick = await this.choose('SETTINGS', [{ label: 'Controls…', value: 'controls' }, { label: 'Back', value: 'back' }], {
        body,
        back: 'back',
        onOpen: (root) => {
          const val = (id: string) => root.querySelector<HTMLInputElement>(`#${id}`)!;
          root.querySelector('.form')!.addEventListener('input', () => {
            s.music = Number(val('set-music').value) / 100;
            s.sfx = Number(val('set-sfx').value) / 100;
            s.graphics = val('set-graphics').value as Graphics;
            s.retro = val('set-retro').checked;
            s.shake = val('set-shake').checked;
            onChange(s);
          });
        },
      });
      if (pick === 'back') return;
      await this.controls(s, onChange);
    }
  }

  /** Key rebinding: pick an action, press the new key (Esc cancels). */
  private async controls(s: Settings, onChange: (s: Settings) => void) {
    for (;;) {
      const actions = Object.keys(ACTION_LABELS) as Action[];
      const pick = await this.choose<Action | 'reset' | 'back'>(
        'CONTROLS',
        [
          ...actions.map((a) => ({ label: ACTION_LABELS[a], hint: s.bindings[a].map(keyLabel).join(' / '), value: a })),
          { label: 'Reset to defaults', value: 'reset' as const },
          { label: 'Back', value: 'back' as const },
        ],
        { subtitle: 'Choose an action, then press the new key or mouse button. Gamepad layout is fixed.', back: 'back', className: 'controls' },
      );
      if (pick === 'back') return;
      if (pick === 'reset') s.bindings = structuredClone(DEFAULT_BINDINGS);
      else {
        const code = await this.capture(ACTION_LABELS[pick]);
        if (code) s.bindings = { ...s.bindings, [pick]: [code] };
      }
      onChange(s);
    }
  }

  private capture(label: string): Promise<string | null> {
    this.close();
    this.root.className = '';
    this.root.innerHTML = `<div class="panel"><h1>PRESS A KEY</h1><p class="sub">for ${esc(label)} · Esc to cancel</p></div>`;
    this.root.hidden = false;
    document.body.classList.add('in-menu');
    return new Promise((resolve) => {
      const finish = (code: string | null) => {
        removeEventListener('keydown', onKey, true);
        removeEventListener('mousedown', onMouse, true);
        this.close();
        resolve(code);
      };
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        finish(e.code === 'Escape' ? null : e.code);
      };
      const onMouse = (e: MouseEvent) => {
        e.preventDefault();
        finish(`Mouse${e.button}`);
      };
      addEventListener('keydown', onKey, true);
      setTimeout(() => addEventListener('mousedown', onMouse, true), 200); // ignore the click that opened this
    });
  }
}

/** Escape text for use inside `body` HTML. */
export const text = esc;
