/**
 * Daily Mini Crossword: five or six words from a clue bank, crossing each other on a small grid.
 * The same crossword for everyone each day.
 */
import { seeded } from './puzzles';
import { hashString } from './spark';

/** Simple, child-friendly clues. */
export const CLUES: Record<string, string> = {
  apple: 'Red or green fruit that keeps the doctor away',
  brain: 'It does your thinking',
  chair: 'You sit on it',
  dance: 'Move to the music',
  eagle: 'Large bird of prey',
  flame: 'The bright part of a fire',
  grape: 'Small fruit that grows in bunches',
  happy: 'Feeling glad',
  juice: 'Drink squeezed from fruit',
  lemon: 'Sour yellow fruit',
  magic: 'Tricks with a wand',
  night: 'When the stars come out',
  ocean: 'Huge body of salt water',
  piano: 'Instrument with black and white keys',
  queen: 'A king\'s partner',
  river: 'Water flowing to the sea',
  smile: 'What you do when you are happy',
  tiger: 'Big striped cat',
  water: 'You drink it when thirsty',
  zebra: 'Striped horse of Africa',
  beach: 'Sandy place by the sea',
  bread: 'Baked loaf for sandwiches',
  candy: 'Sweet treat',
  cloud: 'White and fluffy in the sky',
  crown: 'A king wears it',
  dream: 'What you see while sleeping',
  earth: 'Our home planet',
  ghost: 'Spooky see-through spirit',
  heart: 'It beats in your chest',
  horse: 'Animal you can ride',
  house: 'A home to live in',
  koala: 'Australian animal that eats eucalyptus',
  laugh: 'Ha ha ha!',
  light: 'Opposite of dark',
  mango: 'King of fruits in India',
  mouse: 'Small animal, or a computer pointer',
  music: 'Songs and tunes',
  north: 'Direction a compass points',
  orbit: 'Path around a planet',
  paint: 'Colour you put on with a brush',
  panda: 'Black and white bear',
  party: 'A celebration with friends',
  peace: 'Opposite of war',
  pilot: 'Flies a plane',
  plant: 'Grows in soil',
  power: 'Strength or electricity',
  radio: 'You listen to it for songs and news',
  robot: 'A machine that can move by itself',
  salad: 'Dish of mixed vegetables',
  shark: 'Fish with sharp teeth',
  sheep: 'Gives us wool',
  shell: 'Hard outside of a snail',
  skate: 'Glide on ice',
  sleep: 'What you do in bed',
  snake: 'Long animal with no legs',
  space: 'Where the planets are',
  spoon: 'You eat soup with it',
  sport: 'Cricket or football, for example',
  stone: 'A small rock',
  storm: 'Wild weather with thunder',
  story: 'A tale to read',
  sugar: 'Makes tea sweet',
  table: 'Furniture you eat at',
  teeth: 'You brush them twice a day',
  toast: 'Crispy bread',
  tower: 'Tall, narrow building',
  train: 'Runs on tracks',
  truck: 'Big road vehicle for goods',
  uncle: 'Your parent\'s brother',
  video: 'Moving pictures to watch',
  whale: 'Largest animal in the ocean',
  wheat: 'Grain used to make roti',
  world: 'The whole planet',
  angel: 'Being with wings and a halo',
  arrow: 'Shot from a bow',
  berry: 'Small juicy fruit',
  brave: 'Not afraid',
  brick: 'Block used to build walls',
  camel: 'Desert animal with a hump',
  chalk: 'You write on a blackboard with it',
  chess: 'Game with kings, queens and knights',
  clock: 'Tells the time',
  coral: 'Colourful reef in the sea',
  diary: 'Book for your secrets',
  dozen: 'Twelve',
  eager: 'Very keen',
  fairy: 'Tiny magical being with wings',
  fruit: 'Apple or banana, for example',
  giant: 'Very, very big',
  globe: 'Round map of the world',
  grass: 'Green blades on a lawn',
  green: 'Colour of leaves',
  honey: 'Sweet food made by bees',
  igloo: 'House made of snow blocks',
  jelly: 'Wobbly dessert',
  kayak: 'Small boat paddled by one person',
  lunar: 'About the Moon',
  lunch: 'Midday meal',
  medal: 'Prize for winning',
  movie: 'A film',
  nurse: 'Cares for patients',
  otter: 'Playful river animal',
  paper: 'You write on it',
  pizza: 'Round Italian dish with cheese',
  polar: 'Kind of bear in the Arctic',
  puppy: 'Young dog',
  quiet: 'Not noisy',
  rhyme: 'Cat and hat do this',
  ruler: 'Measures straight lines',
  scarf: 'Worn around the neck in winter',
  seven: 'Days in a week',
  solar: 'Powered by the Sun',
  tiles: 'Squares on a floor',
  zesty: 'Full of flavour',
};

export interface CrosswordEntry {
  word: string;
  clue: string;
  row: number;
  col: number;
  across: boolean;
  /** The number shown in its first square. */
  number: number;
}

export interface Crossword {
  rows: number;
  cols: number;
  entries: CrosswordEntry[];
  /** Letter per square, or null for a black square. */
  grid: (string | null)[][];
}

const SIZE = 11;

function fits(grid: (string | null)[][], word: string, row: number, col: number, across: boolean): number {
  // Returns how many letters cross existing words, or -1 if it does not fit.
  const dr = across ? 0 : 1;
  const dc = across ? 1 : 0;
  const endR = row + dr * (word.length - 1);
  const endC = col + dc * (word.length - 1);
  if (row < 0 || col < 0 || endR >= SIZE || endC >= SIZE) return -1;
  const at = (r: number, c: number) => (r >= 0 && c >= 0 && r < SIZE && c < SIZE ? grid[r]![c] : null);
  if (at(row - dr, col - dc) || at(endR + dr, endC + dc)) return -1;
  let crossings = 0;
  for (let k = 0; k < word.length; k++) {
    const r = row + dr * k;
    const c = col + dc * k;
    const cell = grid[r]![c];
    if (cell) {
      if (cell !== word[k]) return -1;
      crossings += 1;
    } else if (at(r + dc, c + dr) || at(r - dc, c - dr)) {
      // A new letter must not touch another word side by side.
      return -1;
    }
  }
  return crossings === word.length ? -1 : crossings;
}

export function crosswordOfDay(day: string): Crossword {
  const rand = seeded(hashString(`crossword:${day}`));
  const words = Object.keys(CLUES).sort(() => rand() - 0.5);
  const grid: (string | null)[][] = Array.from({ length: SIZE }, () => Array<string | null>(SIZE).fill(null));
  const placed: Omit<CrosswordEntry, 'number' | 'clue'>[] = [];
  const put = (word: string, row: number, col: number, across: boolean) => {
    for (let k = 0; k < word.length; k++) grid[row + (across ? 0 : k)]![col + (across ? k : 0)] = word[k]!;
    placed.push({ word, row, col, across });
  };
  put(words[0]!, 5, 3, true);
  for (const word of words.slice(1)) {
    if (placed.length >= 6) break;
    // Try every crossing with a placed word, keep the first that fits.
    let done = false;
    for (const p of [...placed].sort(() => rand() - 0.5)) {
      if (done) break;
      for (let i = 0; i < p.word.length && !done; i++) {
        for (let j = 0; j < word.length && !done; j++) {
          if (p.word[i] !== word[j]) continue;
          const across = !p.across;
          const row = p.across ? p.row - j : p.row + i;
          const col = p.across ? p.col + i : p.col - j;
          if (fits(grid, word, row, col, across) > 0) {
            put(word, row, col, across);
            done = true;
          }
        }
      }
    }
  }
  // Trim to the used area.
  const rs = placed.flatMap((p) => [p.row, p.row + (p.across ? 0 : p.word.length - 1)]);
  const cs = placed.flatMap((p) => [p.col, p.col + (p.across ? p.word.length - 1 : 0)]);
  const r0 = Math.min(...rs);
  const c0 = Math.min(...cs);
  const rows = Math.max(...rs) - r0 + 1;
  const cols = Math.max(...cs) - c0 + 1;
  const trimmed = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => grid[r + r0]![c + c0] ?? null));
  // Number the starting squares in reading order.
  const starts = [...new Set(placed.map((p) => `${p.row - r0},${p.col - c0}`))].sort((a, b) => {
    const [ar, ac] = a.split(',').map(Number);
    const [br, bc] = b.split(',').map(Number);
    return ar! - br! || ac! - bc!;
  });
  const entries = placed.map((p) => ({
    word: p.word,
    clue: CLUES[p.word]!,
    row: p.row - r0,
    col: p.col - c0,
    across: p.across,
    number: starts.indexOf(`${p.row - r0},${p.col - c0}`) + 1,
  }));
  entries.sort((a, b) => Number(b.across) - Number(a.across) || a.number - b.number);
  return { rows, cols, entries, grid: trimmed };
}

/** Whether every square holds its letter. */
export function crosswordSolved(c: Crossword, letters: Record<string, string>): boolean {
  for (let r = 0; r < c.rows; r++) {
    for (let col = 0; col < c.cols; col++) {
      const want = c.grid[r]![col];
      if (want && (letters[`${r},${col}`] ?? '').toLowerCase() !== want) return false;
    }
  }
  return true;
}
