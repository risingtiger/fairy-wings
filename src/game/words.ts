/**
 * The words of the reading quest, easiest first; each one earns a star, and earning them all earns
 * her wings (five for now). Each round's missing letter flies off to hide near hideX, down low wherever
 * the leaves there hide it best (see QUEST.hideTop); the spots alternate sides and get further away.
 */
export interface Round {
  word: string;
  missing: number;
  hideX: number;
}

export const ROUNDS: readonly Round[] = [
  { word: 'CAT', missing: 0, hideX: -1100 },
  { word: 'SUN', missing: 0, hideX: 1600 },
  { word: 'DOG', missing: 0, hideX: -1900 },
  { word: 'HAT', missing: 0, hideX: 2300 },
  { word: 'PIG', missing: 0, hideX: -2700 },
];

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
