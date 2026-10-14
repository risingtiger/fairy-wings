import { html, nothing, render } from 'lit-html';
import { keyed } from 'lit-html/directives/keyed.js';

export interface HudState {
  status: 'loading' | 'ready' | 'error';
  message: string;
  showHelp: boolean;
  showDebug: boolean;
  fps: number;
  cpuMs: number;
  quads: number;
  draws: number;
  particles: number;
  playerState: string;
  playerX: number;
  playerY: number;
  /** Selected wings ('' until she finds some). */
  wingName: string;
  wingsWorn: boolean;
  /** Flight time left for limited wings, 0..1; -1 hides the meter. */
  flight: number;
  toast: { id: number; title: string; body: string } | null;
  /** Stars earned in the reading quest, out of `starGoal` (the number that earns her wings). */
  stars: number;
  starGoal: number;
  /** Sound effects are off. */
  muted: boolean;
}

/**
 * The DOM overlay. The game pushes changes with update(); rendering is coalesced to at most once
 * per animation frame and skipped entirely when nothing changed.
 */
export class Hud {
  private readonly state: HudState = {
    status: 'loading', message: '', showHelp: false, showDebug: false,
    fps: 0, cpuMs: 0, quads: 0, draws: 0, particles: 0, playerState: '', playerX: 0, playerY: 0,
    wingName: '', wingsWorn: false, flight: -1, toast: null,
    stars: 0, starGoal: 0, muted: false,
  };
  private scheduled = false;
  private toastTimer = 0;
  private toastCount = 0;
  private readonly toggleHelp = () => this.update({ showHelp: !this.state.showHelp });
  /** Clicks shouldn't focus the buttons: Space (jump) would then press them too. */
  private readonly keepFocus = (e: Event) => e.preventDefault();

  constructor(private readonly root: HTMLElement) { this.flush(); }

  get value(): Readonly<HudState> { return this.state; }

  update(patch: Partial<HudState>): void {
    let changed = false;
    for (const key in patch) {
      const k = key as keyof HudState;
      if (this.state[k] !== patch[k]) { (this.state as unknown as Record<string, unknown>)[k] = patch[k]; changed = true; }
    }
    if (changed && !this.scheduled) {
      this.scheduled = true;
      requestAnimationFrame(() => this.flush());
    }
  }

  /** Shows a message card for a few seconds. */
  toast(title: string, body: string, ms = 7000): void {
    clearTimeout(this.toastTimer);
    this.update({ toast: { id: ++this.toastCount, title, body } });
    this.toastTimer = window.setTimeout(() => this.update({ toast: null }), ms);
  }

  private flush(): void {
    this.scheduled = false;
    render(this.template(this.state), this.root);
  }

  private template(s: HudState) {
    if (s.status === 'loading') return html`<div class="center"><div class="card">Loading…</div></div>`;
    if (s.status === 'error') {
      return html`<div class="center"><div class="card error">
        <h2>The game can't start</h2>
        <p>${s.message}</p>
        <p class="muted">It needs WebGPU: recent Chrome or Edge, or Safari 26 and later.</p>
      </div></div>`;
    }
    return html`
      ${s.showHelp ? this.help(s) : this.helpButton()}
      ${s.showDebug ? this.debug(s) : nothing}
      ${s.toast ? keyed(s.toast.id, html`<div class="toast"><b>${s.toast.title}</b><span>${s.toast.body}</span></div>`) : nothing}
      ${s.wingName ? this.wingBadge(s) : nothing}
      ${this.starRow(s.stars, s.starGoal)}
      <div class="corner-hint"><kbd>M</kbd> sounds ${s.muted ? 'off' : 'on'} · <kbd>\`</kbd> stats</div>
    `;
  }

  private helpButton() {
    return html`<button class="help-toggle" tabindex="-1" aria-expanded="false" @mousedown=${this.keepFocus} @click=${this.toggleHelp}>
      <kbd>?</kbd> Controls <span class="chevron">▾</span>
    </button>`;
  }

  private help(s: HudState) {
    const row = (keys: string[], what: string) => html`<li><span>${keys.map((k) => html`<kbd>${k}</kbd>`)}</span>${what}</li>`;
    return html`<section class="panel help">
      <h1>Earn your wings <small>reading game</small>
        <button class="collapse" tabindex="-1" aria-label="Hide controls" aria-expanded="true" @mousedown=${this.keepFocus} @click=${this.toggleHelp}>▴</button>
      </h1>
      <ul>
        ${row(['←', '→'], 'walk')}
        ${row(['Shift'], 'hold to run')}
        ${row(['Space'], 'jump · hold for higher · land on a wrong letter to bounce it away')}
        ${row(['J'], 'wave your wand · catch the missing letter')}
        ${row(['E'], 'put wings on or away (once earned)')}
      </ul>
      <p class="muted">Walk up to the elf to get a word. Remember the golden letter before it floats away, then head right: letters come walking along. Catch the missing one with your wand (wrong ones bump you!), read the word out loud, and the elf brings you a star. ${s.starGoal} stars earn the Purple Wings.<br />Also: <kbd>↓</kbd> crouch, <kbd>K</kbd> magic, <kbd>H</kbd> tumble. Gamepad: stick, A jump, X wand, LB wings, RB run.<br /><kbd>?</kbd> shows and hides this panel.</p>
    </section>`;
  }

  private starRow(stars: number, goal: number) {
    return html`<div class="stars" aria-label="${stars} of ${goal} stars">${Array.from({ length: goal }, (_, i) => html`<span class=${i < stars ? 'on' : ''}></span>`)}</div>`;
  }

  private wingBadge(s: HudState) {
    const meter = s.wingsWorn && s.flight >= 0;
    return html`<div class="ability ${s.wingsWorn ? 'on' : 'off'}">
      <span class="icon ${s.wingName.startsWith('Purple') ? 'purple' : ''}"></span>
      <span>${s.wingName} · ${s.wingsWorn ? 'worn' : 'put away'}</span>
      ${meter ? html`<span class="meter ${s.flight < 0.3 ? 'low' : ''}"><span style="transform: scaleX(${s.flight.toFixed(3)})"></span></span>` : nothing}
      <kbd>E</kbd>
    </div>`;
  }

  private debug(s: HudState) {
    return html`<section class="panel debug">
      <div><b>${s.fps.toFixed(0)}</b> fps · ${s.cpuMs.toFixed(2)} ms cpu</div>
      <div>${s.quads} quads · ${s.draws} draws · ${s.particles} particles</div>
      <div>${s.playerState} · x ${s.playerX.toFixed(0)} · height ${Math.max(0, -s.playerY).toFixed(0)}</div>
    </section>`;
  }
}
