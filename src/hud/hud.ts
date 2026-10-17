import { html, nothing, render } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { TOUCH } from '../game/config/controls';

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
  /** The drawing-buffer size, e.g. "2360×1640". */
  resolution: string;
  /** Selected wings ('' until she finds some). */
  wingName: string;
  wingsWorn: boolean;
  /** Flight time left for limited wings, 0..1; -1 hides the meter. */
  flight: number;
  /** Stars earned in the reading quest (one per word read), out of `starGoal`. */
  stars: number;
  starGoal: number;
  /** All sound is off (effects and music). */
  muted: boolean;
  /** The music alone is switched off. */
  musicOff: boolean;
  /** The grown-ups' panel (picking the sentence) is open. */
  showGrownUps: boolean;
  /** The sentences to pick from, and the one picked. */
  sentences: readonly SentenceOption[];
  sentenceId: string;
  /** The sentence is up: it can't be changed any more (until the page is reloaded). */
  sentenceLocked: boolean;
  /** Played by touch (an iPad): on-screen controls, a hidden "ok" for the grown-up, sound switches in their panel. */
  touch: boolean;
}

/** A sentence in the grown-ups' list: its words, and what the wings hide in. */
export interface SentenceOption { id: string; text: string; hint: string }

/**
 * The DOM overlay. The game pushes changes with update(); rendering is coalesced to at most once
 * per animation frame and skipped entirely when nothing changed.
 */
export class Hud {
  private readonly state: HudState = {
    status: 'loading', message: '', showHelp: false, showDebug: false,
    fps: 0, cpuMs: 0, quads: 0, draws: 0, particles: 0, playerState: '', playerX: 0, playerY: 0, resolution: '',
    wingName: '', wingsWorn: false, flight: -1,
    stars: 0, starGoal: 0, muted: false, musicOff: false,
    showGrownUps: false, sentences: [], sentenceId: '', sentenceLocked: false, touch: false,
  };
  /** A grown-up picked a different sentence. */
  onSentence: ((id: string) => void) | null = null;
  /** The grown-up tapped the hidden "ok" (touch screens). */
  onOk: (() => void) | null = null;
  /** The grown-up switched all sound, or just the music, on or off (touch screens; the keyboard has M and N). */
  onSound: (() => void) | null = null;
  onMusic: (() => void) | null = null;
  private scheduled = false;
  private readonly toggleHelp = () => this.update({ showHelp: !this.state.showHelp });
  private readonly toggleGrownUps = () => this.update({ showGrownUps: !this.state.showGrownUps });
  private readonly pickSentence = (e: Event) => {
    const select = e.target as HTMLSelectElement;
    this.onSentence?.(select.value);
    select.blur(); // hand the keyboard back to the game
  };
  /** Keys pressed in the grown-ups' panel (choosing from the list) shouldn't move her about. */
  private readonly keepKeys = (e: KeyboardEvent) => e.stopPropagation();
  /** Clicks shouldn't focus the buttons: Space (jump) would then press them too. */
  private readonly keepFocus = (e: Event) => e.preventDefault();
  private readonly ok = (e: Event) => { e.preventDefault(); this.onOk?.(); };
  private readonly sound = () => this.onSound?.();
  private readonly music = () => this.onMusic?.();
  private readonly stats = () => this.update({ showDebug: !this.state.showDebug });

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
      ${s.showHelp ? this.help(s) : this.toggle('left', html`<kbd>?</kbd> Controls`, this.toggleHelp)}
      ${s.showGrownUps ? this.grownUps(s) : this.toggle('right', 'Grown-ups', this.toggleGrownUps)}
      ${s.showDebug ? this.debug(s) : nothing}
      ${s.wingName ? this.wingBadge(s) : nothing}
      ${this.starRow(s.stars, s.starGoal)}
      ${s.touch
        ? html`<button class="grown-up-ok" tabindex="-1" aria-label="Grown-up: ok" @pointerdown=${this.ok}></button>
          <div class="rotate"><div class="card"><span class="device"></span>Turn the screen sideways to play</div></div>`
        : html`<div class="corner-hint"><kbd>M</kbd> sounds ${s.muted ? 'off' : 'on'} · <kbd>N</kbd> music ${s.muted || s.musicOff ? 'off' : 'on'} · <kbd>\`</kbd> stats</div>`}
    `;
  }

  /** A button that opens a panel (top left or right); it takes clicks without taking the keyboard. */
  private toggle(side: 'left' | 'right', label: unknown, onClick: () => void) {
    return html`<button class="toggle ${side}" tabindex="-1" aria-expanded="false" @mousedown=${this.keepFocus} @click=${onClick}>
      ${label} <span class="chevron">▾</span>
    </button>`;
  }

  /** A panel's title, with a button that folds it away again. */
  private heading(title: unknown, closeLabel: string, onClick: () => void) {
    return html`<h1>${title}
      <button class="collapse" tabindex="-1" aria-label=${closeLabel} aria-expanded="true" @mousedown=${this.keepFocus} @click=${onClick}>▴</button>
    </h1>`;
  }

  private help(s: HudState) {
    const row = (keys: string[], what: string) => html`<li><span>${keys.map((k) => html`<kbd>${k}</kbd>`)}</span>${what}</li>`;
    // on a touch screen, each button's own icon
    const button = (className: string, what: string) => html`<li><span><span class="pad-icon ${className}">${unsafeHTML(TOUCH.buttons.find((b) => b.className === className)?.icon ?? '')}</span></span>${what}</li>`;
    return html`<section class="panel help">
      ${this.heading(html`Earn your wings <small>reading game</small>`, 'Hide controls', this.toggleHelp)}
      <ul>
        ${row(['Finger'], 'tap a letter with your wand (or click it) · press and slide across a word')}
        ${s.touch ? html`
          ${row(['Left thumb'], 'slide it to walk, further to run · down to crouch')}
          ${button('jump', 'jump · hold for higher · again in the air to fly (once she has wings)')}
          ${button('catch', 'catch the thing the wings hide in')}
          ${button('wand', 'wave your wand')}
          ${button('magic', 'magic')}
          ${button('wings', 'put wings on or away (once earned)')}
        ` : html`
          ${row(['←', '→'], 'walk')}
          ${row(['Shift'], 'hold to run')}
          ${row(['Space'], 'jump · hold for higher')}
          ${row(['J'], 'wave your wand')}
          ${row(['L'], 'catch the thing the wings hide in')}
          ${row(['E'], 'put wings on or away (once earned)')}
          ${row(['M'], 'all sound on or off')}
          ${row(['N'], 'music on or off')}
        `}
      </ul>
      <p class="muted">Walk up to the elf and he puts up a sentence. Tap the first letter: it glows gold. Say its sound, then tap the next letter, and the next. When you've said them all, put your finger down on the first letter and slide it across the word, then read it out loud. Every word gives you a star. ${s.starGoal} words make the sentence: read it, and it tells you where the Purple Wings are hiding. Follow the elf: jump the gaps, and hop onto the floating islands to ride over the wide ones. ${s.touch
        ? 'Then catch the right one with the hand button!'
        : html`Then catch the right one with <kbd>L</kbd>!<br />Also: <kbd>↓</kbd> crouch, <kbd>K</kbd> magic, <kbd>H</kbd> tumble. Gamepad: stick, A jump, X wand, Y catch, LB wings, RB run.<br /><kbd>?</kbd> shows and hides this panel.`}</p>
    </section>`;
  }

  private grownUps(s: HudState) {
    const picked = s.sentences.find((o) => o.id === s.sentenceId);
    return html`<section class="panel grown-ups" @keydown=${this.keepKeys}>
      ${this.heading('Grown-ups', 'Hide the grown-ups panel', this.toggleGrownUps)}
      <label>
        <span>The sentence (the clue to where the purple wings are)</span>
        <select .value=${s.sentenceId} ?disabled=${s.sentenceLocked} @change=${this.pickSentence}>
          ${s.sentences.map((o) => html`<option value=${o.id} ?selected=${o.id === s.sentenceId}>${o.text}</option>`)}
        </select>
      </label>
      ${picked ? html`<p><b>The wings hide in:</b> ${picked.hint}.</p>` : nothing}
      <p class="muted">${s.sentenceLocked
        ? 'The sentence is up, so it\'s set for this game. Reload the page to start again with a different one.'
        : 'Pick it before the elf puts it up.'}</p>
      ${s.touch ? html`
        <p class="muted">Tap the very top middle of the screen, where the stars are, each time she says the sound of the letter she's tapped (it glows gold), and again once she has swiped across the word and read it out. Nothing shows there: it's your "ok". A word of one letter, like "a", needs only its sound. A tap doesn't count before she's tapped the letter, or before she has swiped the word.</p>
        <div class="switches">
          <button tabindex="-1" @click=${this.sound}>Sound ${s.muted ? 'off' : 'on'}</button>
          <button tabindex="-1" ?disabled=${s.muted} @click=${this.music}>Music ${s.muted || s.musicOff ? 'off' : 'on'}</button>
          <button tabindex="-1" @click=${this.stats}>Stats ${s.showDebug ? 'on' : 'off'}</button>
        </div>
        <p class="muted">Stats show how smoothly it runs (frames per second) at the bottom of the screen.</p>
      ` : html`
        <p class="muted">Type <kbd>o</kbd><kbd>k</kbd> on the keyboard each time she says the sound of the letter she's tapped (it glows gold), and again once she has swiped across the word and read it out. A word of one letter, like "a", needs only its sound. An <kbd>o</kbd><kbd>k</kbd> doesn't count before she's tapped the letter, or before she has swiped the word.</p>
      `}
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
      ${s.touch ? nothing : html`<kbd>E</kbd>`}
    </div>`;
  }

  private debug(s: HudState) {
    return html`<section class="panel debug">
      <div><b>${s.fps.toFixed(0)}</b> fps · ${s.cpuMs.toFixed(2)} ms cpu</div>
      <div>${s.quads} quads · ${s.draws} draws · ${s.particles} particles</div>
      <div>${s.resolution}</div>
      <div>${s.playerState} · x ${s.playerX.toFixed(0)} · height ${Math.max(0, -s.playerY).toFixed(0)}</div>
    </section>`;
  }
}
