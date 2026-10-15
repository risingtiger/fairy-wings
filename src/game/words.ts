/** One word of the sentence; `missing` is the letter she has to remember and go and catch. */
export interface Round {
  word: string;
  missing: number;
}

/** The things the wings can hide in, and the others lying about to make her read carefully. */
export type ThingShape = 'ball' | 'box' | 'star';
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
    OTHER_COLORS.flatMap((color, i): ThingLook[] => [{ shape: i % 2 ? 'box' : 'ball', color }])),
];

export const sentenceById = (id: string | null): Sentence => SENTENCES.find((s) => s.id === id) ?? SENTENCES[0];

/** How to say each letter's name, so speech engines never read "A" as "uh". */
const LETTER_NAMES: Record<string, string> = {
  A: 'ay', B: 'bee', C: 'see', D: 'dee', E: 'ee', F: 'eff', G: 'jee', H: 'aitch', I: 'eye', J: 'jay', K: 'kay', L: 'el', M: 'em',
  N: 'en', O: 'oh', P: 'pee', Q: 'cue', R: 'ar', S: 'ess', T: 'tee', U: 'you', V: 'vee', W: 'double you', X: 'ex', Y: 'why', Z: 'zee',
};

export const letterName = (letter: string) => LETTER_NAMES[letter] ?? letter;

/** The word spelled out, then said: "see, ay, tee... cat!" */
export const spellOut = (word: string) => `${[...word].map(letterName).join(', ')}... ${word.toLowerCase()}!`;

/**
 * One thing a character says: shown in a bubble, and read aloud (`say` when it should sound different).
 * Nothing shows or speaks these at the moment (the bubbles and voice are switched off); the script is
 * kept for whatever replaces them.
 */
export interface Line {
  who: 'elf' | 'star';
  text: string;
  say?: string;
}

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export const LINES = {
  intro: [
    { who: 'elf', text: 'Hi there! Do you want to earn your wings?' },
    { who: 'elf', text: 'Then you need five stars!' },
    { who: 'elf', text: 'Every word here is missing a letter. The letters love to hide! Find them and bring them back to me!' },
  ] satisfies Line[],
  /** The elf shows a new word; the missing letter swirls up over him meanwhile. */
  show(r: Round): Line {
    const letter = r.word[r.missing];
    return {
      who: 'elf',
      text: `This word is ${r.word}. It needs the letter ${letter}.`,
      say: `This word is ${r.word.toLowerCase()}. It needs the letter ${letterName(letter)}.`,
    };
  },
  /** ...and off it flies. */
  flewAway(r: Round): Line {
    const letter = r.word[r.missing];
    return { who: 'elf', text: `Oh! ${letter} flew away to hide! Can you find ${letter}?`, say: `Oh! The letter ${letterName(letter)} flew away to hide! Can you find it?` };
  },
  /** Said once, in the first round. */
  howToCatch: { who: 'star', text: 'Letters hide in the leaves. When you see it, press J to catch it!', say: 'Letters hide in the leaves. When you see it, press the letter jay to catch it!' } satisfies Line,
  /** Talking to the elf mid-search. */
  ask(r: Round): Line {
    const letter = r.word[r.missing];
    return {
      who: 'elf',
      text: `This word is ${r.word}. It needs the letter ${letter}. Can you find ${letter}? It's hiding in the leaves!`,
      say: `This word is ${r.word.toLowerCase()}. It needs the letter ${letterName(letter)}. Can you find it? It's hiding in the leaves!`,
    };
  },
  found(r: Round): Line {
    const letter = r.word[r.missing];
    return { who: 'star', text: `You caught ${letter}! Let's take it back to the elf!`, say: `You caught ${letterName(letter)}! Let's take it back to the elf!` };
  },
  spelled(r: Round): Line {
    return { who: 'elf', text: `${[...r.word].join(' - ')}... ${r.word}!`, say: spellOut(r.word) };
  },
  star(count: number): Line {
    return count === 1
      ? { who: 'elf', text: 'You earned a star!' }
      : { who: 'elf', text: `${count} stars!`, say: `${NUMBERS[count]} stars!` };
  },
  wings: [
    { who: 'elf', text: 'Five stars! You did it! You earned your wings!' },
    { who: 'star', text: 'Jump, then press Space again to fly!', say: 'Jump, then press space again to fly!' },
  ] satisfies Line[],
  done: { who: 'elf', text: 'You can fly now! Well done!' } satisfies Line,
  placeJump: { who: 'star', text: 'Jump up to put it in the word!' } satisfies Line,
  bring: { who: 'elf', text: 'Put the letter in the word! Stand under it and jump!' } satisfies Line,
  hint: { who: 'star', text: "I think it's this way!" } satisfies Line,
  /** After a long search, once she's close: the star makes the hidden letter twinkle. */
  close: { who: 'star', text: "It's close! Look for the twinkle in the leaves!" } satisfies Line,
};
