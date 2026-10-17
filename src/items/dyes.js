// Colours: the dyes, the wool and carpet they make, and the fleece a dyed
// sheep grows (and passes on to its lambs).
//
//   white   bone meal              red     a poppy
//   yellow  a dandelion            orange  red + yellow
//   pink    red + bone meal        green   a cactus, smelted
//   brown   a brown mushroom       black   coal or charcoal
//   grey    black + bone meal      blue    a cornflower
//   cyan    blue + green           purple  red + blue

import { B } from '../blocks/blocks.js';
import { I } from './itemIds.js';

// rgb: the wool block's colour; tint: a sheep's fleece
export const COLOURS = [
  { key: 'white', rgb: [228, 228, 222], tint: 0xffffff, dye: I.BONE_MEAL, wool: B.WOOL, carpet: B.WHITE_CARPET },
  { key: 'red', rgb: [168, 48, 44], tint: 0xd0544c, dye: I.RED_DYE, wool: B.RED_WOOL, carpet: B.RED_CARPET },
  { key: 'yellow', rgb: [222, 188, 52], tint: 0xf0d050, dye: I.YELLOW_DYE, wool: B.YELLOW_WOOL, carpet: B.YELLOW_CARPET },
  { key: 'orange', rgb: [220, 120, 38], tint: 0xf09440, dye: I.ORANGE_DYE, wool: B.ORANGE_WOOL, carpet: B.ORANGE_CARPET },
  { key: 'pink', rgb: [232, 148, 168], tint: 0xf4b0c2, dye: I.PINK_DYE, wool: B.PINK_WOOL, carpet: B.PINK_CARPET },
  { key: 'green', rgb: [84, 116, 40], tint: 0x76a040, dye: I.GREEN_DYE, wool: B.GREEN_WOOL, carpet: B.GREEN_CARPET },
  { key: 'brown', rgb: [108, 72, 42], tint: 0x8a6040, dye: I.BROWN_DYE, wool: B.BROWN_WOOL, carpet: B.BROWN_CARPET },
  { key: 'black', rgb: [34, 32, 32], tint: 0x3a3634, dye: I.BLACK_DYE, wool: B.BLACK_WOOL, carpet: B.BLACK_CARPET },
  { key: 'grey', rgb: [104, 104, 100], tint: 0x8e8c88, dye: I.GREY_DYE, wool: B.GREY_WOOL, carpet: B.GREY_CARPET },
  { key: 'blue', rgb: [52, 72, 168], tint: 0x5068d0, dye: I.BLUE_DYE, wool: B.BLUE_WOOL, carpet: B.BLUE_CARPET },
  { key: 'cyan', rgb: [32, 136, 148], tint: 0x40a8b4, dye: I.CYAN_DYE, wool: B.CYAN_WOOL, carpet: B.CYAN_CARPET },
  { key: 'purple', rgb: [112, 52, 156], tint: 0x9058c0, dye: I.PURPLE_DYE, wool: B.PURPLE_WOOL, carpet: B.PURPLE_CARPET },
];
export const COLOUR = Object.fromEntries(COLOURS.map((c) => [c.key, c]));
export const colourOfDye = (id) => COLOURS.find((c) => c.dye === id) ?? null;
export const ALL_WOOL = COLOURS.map((c) => c.wool);

// two fleeces' lamb: some pairs blend, otherwise it takes after one parent
const BLENDS = { 'red+white': 'pink', 'red+yellow': 'orange', 'black+white': 'grey', 'blue+green': 'cyan', 'blue+red': 'purple' };
export function blendColours(a, b) {
  if (a === b) return a;
  return BLENDS[[a, b].sort().join('+')] ?? null;
}
