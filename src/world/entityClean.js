// Block entities read back from a save, made sound before anything ticks
// them: a hand-edited or damaged world (or one from a newer build) may hold
// slots that aren't arrays, ids this build doesn't know, or counts that
// aren't numbers. The stall cleans itself (stallState); these hold items.

import { isKnownItem, maxStack } from '../items/items.js';
import { SMELTING } from '../items/recipes.js';
import { CAMPFIRE_SLOTS } from '../items/campfire.js';
import { potIngredient, POT_MAX_ITEMS, potMealIds } from '../items/cookingPot.js';

const fin = (v, lo, hi, def = lo) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);

// a stack, or null
function stack(s) {
  if (!s || typeof s !== 'object' || !isKnownItem(s.id) || !Number.isInteger(s.count) || s.count <= 0) return null;
  s.count = Math.min(s.count, maxStack(s.id));
  return s;
}

const slotList = (a, n) => Array.from({ length: n }, (_, i) => stack(Array.isArray(a) ? a[i] : null));

const CLEAN = {
  chest(st) { st.slots = slotList(st.slots, Array.isArray(st.slots) && st.slots.length >= 1 && st.slots.length <= 54 ? st.slots.length : 27); },
  furnace(st) {
    for (const k of ['input', 'fuel', 'output']) st[k] = stack(st[k]);
    st.burnTotal = fin(st.burnTotal, 0, 1e5);
    st.burnLeft = fin(st.burnLeft, 0, st.burnTotal);
    st.cook = fin(st.cook, 0, 1e5);
  },
  campfire(st) {
    st.slots = Array.from({ length: CAMPFIRE_SLOTS }, (_, i) => {
      const s = Array.isArray(st.slots) ? st.slots[i] : null;
      return s && SMELTING.has(s.id) ? { ...s, t: fin(s.t, 0, 1e5) } : null;   // (only what it can cook)
    });
  },
  pot(st) {
    st.water = !!st.water;
    st.items = (Array.isArray(st.items) ? st.items : []).filter(potIngredient).slice(0, POT_MAX_ITEMS);
    st.t = fin(st.t, 0, 1e5);
    if (!potMealIds.has(st.meal)) st.meal = null;
    st.servings = st.meal ? Math.round(fin(st.servings, 1, POT_MAX_ITEMS + 1, 1)) : 0;
  },
};

export function cleanBlockEntities(chunk) {
  for (const st of chunk.blockEntities.values()) CLEAN[st.kind]?.(st);
}
