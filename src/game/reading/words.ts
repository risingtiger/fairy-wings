/** One word of the sentence; `missing` is the letter she has to remember and go and catch. */
export interface Round {
  word: string;
  missing: number;
}

/** The things the wings can hide in, and the others lying about to make her read carefully. */
type ThingShape = 'ball' | 'box' | 'star';
export type ThingColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'pink';
export interface ThingLook { shape: ThingShape; color: ThingColor; big?: boolean }

/**
 * A sentence the elf builds up word by word; read together, it says where the purple wings are
 * hiding. `target` is the thing that holds them; `decoys` are the looks of everything lying around it
 * (repeated as needed, so a few looks make a whole field). `hint` is for the grown-up picking it.
 */
export interface Sentence {
  id: string;
  text: string;
  hint: string;
  rounds: readonly Round[];
  target: ThingLook;
  decoys: readonly ThingLook[];
}

/** Every word misses its first letter (for "I" and "A" that's the whole word). */
const sentence = (id: string, text: string, hint: string, target: ThingLook, decoys: ThingLook[]): Sentence => ({
  id, text, hint, target, decoys, rounds: text.split(' ').map((word) => ({ word, missing: 0 })),
});

const OTHER_COLORS: ThingColor[] = ['blue', 'green', 'yellow', 'purple', 'orange', 'pink'];

/** The sentences a grown-up can pick from (in the HUD's grown-ups panel); the first is the default. */
export const SENTENCES: readonly Sentence[] = [
  sentence('ball', 'I AM A BALL', 'the one ball among boxes', { shape: 'ball', color: 'pink' },
    OTHER_COLORS.concat('red').map((color) => ({ shape: 'box', color }))),
  sentence('box', 'I AM A BOX', 'the one box among balls', { shape: 'box', color: 'orange' },
    OTHER_COLORS.concat('red').map((color) => ({ shape: 'ball', color }))),
  sentence('red-ball', 'A RED BALL', 'the red ball among balls of other colours', { shape: 'ball', color: 'red' },
    OTHER_COLORS.map((color) => ({ shape: 'ball', color }))),
  sentence('red-box', 'A RED BOX', 'the red box among red balls and boxes of other colours', { shape: 'box', color: 'red' },
    [{ shape: 'ball', color: 'red' }, ...OTHER_COLORS.map((color): ThingLook => ({ shape: 'box', color })), { shape: 'ball', color: 'red' }]),
  sentence('big', 'I AM BIG', 'the one big ball among little balls', { shape: 'ball', color: 'purple', big: true },
    OTHER_COLORS.concat('red').map((color) => ({ shape: 'ball', color }))),
  sentence('star', 'I AM A STAR', 'the one star among balls and boxes', { shape: 'star', color: 'yellow' },
    OTHER_COLORS.map((color, i): ThingLook => ({ shape: i % 2 ? 'box' : 'ball', color }))),
];

export const sentenceById = (id: string | null): Sentence => SENTENCES.find((s) => s.id === id) ?? SENTENCES[0];
