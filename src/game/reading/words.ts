/** The things the wings can hide in, and the others lying about to make her read carefully. */
type ThingShape = 'ball' | 'box' | 'star';
export type ThingColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'pink';
/** How a thing moves, besides bobbing: hopping up and down, or spinning round and round. */
export type ThingMove = 'hop' | 'spin';

/**
 * What a thing looks like and does: its shape and colour; bigger than the rest; hopping or spinning;
 * floating high up in the sky (she jumps to catch it); twinkling with sparkles; spotty; wearing a hat;
 * smiling.
 */
export interface ThingLook {
  shape: ThingShape;
  color: ThingColor;
  big?: boolean;
  move?: ThingMove;
  high?: boolean;
  sparkles?: boolean;
  dots?: boolean;
  hat?: boolean;
  grin?: boolean;
}

/**
 * A sentence she reads, sound by sound and word by word; read together, it says where the purple
 * wings are hiding. `target` is the thing that holds them; `decoys` are the looks of everything lying
 * around it (repeated as needed, so a few looks make a whole field). `hint` is for the grown-up picking it.
 */
export interface Sentence {
  id: string;
  text: string;
  hint: string;
  words: readonly string[];
  target: ThingLook;
  decoys: readonly ThingLook[];
}

/**
 * What the sentence says about the thing holding the wings: its shape always, and whichever of the rest
 * the sentence names. `color` is a clue only when the sentence says it; otherwise `paint` colours the
 * thing, and the others come in every colour.
 */
type Clue = Omit<ThingLook, 'color'> & { color?: ThingColor; paint?: ThingColor };

const COLORS: readonly ThingColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink'];
const SHAPES: readonly ThingShape[] = ['ball', 'box', 'star'];
const FLAGS = ['big', 'high', 'sparkles', 'dots', 'hat', 'grin'] as const;

/**
 * The others in the field: each gets exactly one part of the sentence wrong (another shape, another
 * colour, not big, not hopping...), so she has to read every word to find the right one. Colours the
 * sentence doesn't name vary from one to the next.
 */
function nearMisses(clue: Clue, target: ThingLook): ThingLook[] {
  const out: ThingLook[] = [];
  let paint = COLORS.indexOf(target.color);
  const miss = (change: Partial<ThingLook>) => {
    const look: ThingLook = { ...target, ...change };
    if (!clue.color && !change.color) look.color = COLORS[(paint = (paint + 3) % COLORS.length)];
    out.push(look);
  };
  for (const shape of SHAPES) if (shape !== target.shape) miss({ shape });
  if (clue.color) for (const k of [2, 4]) miss({ color: COLORS[(COLORS.indexOf(clue.color) + k) % COLORS.length] });
  if (clue.move) { miss({ move: undefined }); miss({ move: clue.move === 'hop' ? 'spin' : 'hop' }); }
  for (const flag of FLAGS) if (clue[flag]) miss({ [flag]: false } as Partial<ThingLook>);
  return out;
}

/** "the big red box with dots": the thing holding the wings, said plainly for the grown-up. */
function describe(t: ThingLook): string {
  const traits = [
    t.move === 'hop' && 'hopping', t.move === 'spin' && 'spinning', t.sparkles && 'sparkling',
    t.high && 'high in the sky', t.dots && 'with dots', t.hat && 'with a hat', t.grin && 'with a grin',
  ].filter(Boolean);
  return `the ${t.big ? 'big ' : ''}${t.color} ${t.shape}${traits.length ? `, ${traits.join(', ')}` : ''}`;
}

const sentence = (text: string, clue: Clue): Sentence => {
  const { paint, ...look } = clue;
  const target: ThingLook = { ...look, color: clue.color ?? paint ?? 'yellow' };
  return {
    id: text.toLowerCase().replaceAll(' ', '-'), text, hint: describe(target), words: text.split(' '),
    target, decoys: nearMisses(clue, target),
  };
};

/**
 * The sentences a grown-up can pick from (in the HUD's grown-ups panel); the first is the default.
 * Short words that sound out the way they're spelled (red, big, box, dots, hat, hops, spins, grin),
 * with a few sight words (I, a, the) and the odd harder one (star, sky, down, sparkles).
 */
export const SENTENCES: readonly Sentence[] = [
  sentence('A Big Pink Ball', { shape: 'ball', color: 'pink', big: true }),
  sentence('A Red Box With Dots', { shape: 'box', color: 'red', dots: true }),
  sentence('A Box That Spins', { shape: 'box', move: 'spin', paint: 'green' }),
  sentence('A Ball With A Hat', { shape: 'ball', hat: true, paint: 'blue' }),
  sentence('I Am A Star That Hops', { shape: 'star', move: 'hop', paint: 'yellow' }),
  sentence('A Box With A Grin', { shape: 'box', grin: true, paint: 'yellow' }),
  sentence('A Red Star That Spins', { shape: 'star', color: 'red', move: 'spin' }),
  sentence('A Green Ball With Dots', { shape: 'ball', color: 'green', dots: true }),
  sentence('A Ball Up In The Sky', { shape: 'ball', high: true, paint: 'orange' }),
  sentence('I Am A Big Red Star', { shape: 'star', color: 'red', big: true }),
  sentence('A Big Box With A Hat', { shape: 'box', big: true, hat: true, paint: 'purple' }),
  sentence('A Pink Star With A Hat', { shape: 'star', color: 'pink', hat: true }),
  sentence('A Red Ball With A Grin', { shape: 'ball', color: 'red', grin: true }),
  sentence('A Pink Box That Sparkles', { shape: 'box', color: 'pink', sparkles: true }),
  sentence('A Green Star With A Grin', { shape: 'star', color: 'green', grin: true }),
  sentence('A Big Red Box That Hops', { shape: 'box', color: 'red', big: true, move: 'hop' }),
  sentence('A Box In The Sky With Dots', { shape: 'box', high: true, dots: true, paint: 'pink' }),
  sentence('A Ball With Dots And A Hat', { shape: 'ball', dots: true, hat: true, paint: 'blue' }),
  sentence('A Box That Jumps Up And Down', { shape: 'box', move: 'hop', paint: 'orange' }),
  sentence('A Star With A Hat That Spins', { shape: 'star', hat: true, move: 'spin', paint: 'yellow' }),
  sentence('A Big Ball That Hops Up And Down', { shape: 'ball', big: true, move: 'hop', paint: 'green' }),
  sentence('A Star In The Sky That Sparkles', { shape: 'star', high: true, sparkles: true, paint: 'yellow' }),
  sentence('A Star With A Grin In The Sky', { shape: 'star', grin: true, high: true, paint: 'pink' }),
  sentence('A Red Box With A Hat And A Grin', { shape: 'box', color: 'red', hat: true, grin: true }),
];

export const sentenceById = (id: string | null): Sentence => SENTENCES.find((s) => s.id === id) ?? SENTENCES[0];
