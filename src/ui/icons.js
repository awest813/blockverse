// Pixel-art HUD icons (hearts, hunger, air) drawn from tiny character grids,
// so the status bars look the same on every OS instead of relying on emoji.

const HEART = [
  '.XX...XX.',
  'XRRX.XRRX',
  'XRWRXRRRX',
  'XRRRRRRRX',
  'XRRRRRRRX',
  '.XRRRRRX.',
  '..XRRRX..',
  '...XRX...',
  '....X....',
];

const FOOD = [
  '....XXXX.',
  '...XMMMMX',
  '..XMMHMMX',
  '..XMMMMMX',
  '..XMMMMDX',
  '.XXDMMDX.',
  'XWWXXXX..',
  'XWX......',
  '.X.......',
];

const BUBBLE = [
  '..XXXXX..',
  '.XBBBBBX.',
  'XBWWBBBBX',
  'XBWBBBBBX',
  'XBBBBBBBX',
  'XBBBBBBBX',
  'XBBBBBBBX',
  '.XBBBBBX.',
  '..XXXXX..',
];

const FULL = {
  heart: { X: '#2b0b0b', R: '#e0302c', W: '#ffb3ad' },
  food: { X: '#2e1a0a', M: '#c8702e', H: '#f0a060', D: '#8a4418', W: '#f2ead8' },
  bubble: { X: '#1d4f86', B: '#7fc4ff', W: '#ffffff' },
};
const EMPTY = {
  heart: { X: '#1a1a1a', R: '#3c3434', W: '#4a4040' },
  food: { X: '#1a1a1a', M: '#3c3836', H: '#46413e', D: '#332f2d', W: '#5a5753' },
};

function draw(grid, palette, half = null) {
  const c = document.createElement('canvas');
  c.width = c.height = 9;
  const ctx = c.getContext('2d');
  grid.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      // half icons: full colours on one side, empty colours on the other
      const pal = half && !half(x) ? EMPTY[half.kind] : palette;
      ctx.fillStyle = pal[ch];
      ctx.fillRect(x, y, 1, 1);
    });
  });
  return c.toDataURL();
}

const leftHalf = Object.assign((x) => x <= 4, { kind: 'heart' });
const rightHalf = Object.assign((x) => x >= 4, { kind: 'food' });

export const HUD_ICONS = {
  heartFull: draw(HEART, FULL.heart),
  heartHalf: draw(HEART, FULL.heart, leftHalf),
  heartEmpty: draw(HEART, EMPTY.heart),
  foodFull: draw(FOOD, FULL.food),
  foodHalf: draw(FOOD, FULL.food, rightHalf),
  foodEmpty: draw(FOOD, EMPTY.food),
  bubble: draw(BUBBLE, FULL.bubble),
};
