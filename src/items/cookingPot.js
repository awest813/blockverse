// Cooking pot: set it over heat (a lit campfire, a fire, lava or a lit furnace
// right below it), fill it with a water bucket, put in two to four foods, and
// once the pot has simmered, ladle the meal out with bowls.
// Block entity: {kind: 'pot', water, items: [id...], t, meal: id | null, servings}
// The block's meta shows what's inside: 0 nothing, 1 water, 2+ the meal's colour.

import { B } from '../blocks/blocks.js';
import { I } from './itemIds.js';
import { forEachBlockEntity } from './campfire.js';
import { itemInfo } from './items.js';

export const POT_MAX_ITEMS = 4;
export const SIMMER_TIME = 30;   // seconds over the heat, counted from the last thing put in

const HEAT = new Set([B.CAMPFIRE, B.FIRE, B.LAVA, B.FURNACE_LIT]);
export const potHeated = (world, x, y, z) => HEAT.has(world.getBlockW(x, y - 1, z));

// what goes in, by kind (raw or cooked both do)
const BEEF = [I.BEEF_RAW, I.BEEF_COOKED];
const BIRD = [I.CHICKEN_RAW, I.CHICKEN_COOKED, I.DUCK_RAW, I.DUCK_COOKED];
const FISH = [I.FISH_RAW, I.FISH_COOKED, I.CRAB_RAW, I.CRAB_COOKED];   // (crab counts as seafood)
const OTHER_MEAT = [I.PORKCHOP_RAW, I.PORKCHOP_COOKED, I.MUTTON_RAW, I.MUTTON_COOKED];
const POTATO = [I.POTATO, I.BAKED_POTATO];
const MUSHROOM = [B.MUSHROOM_BROWN, B.MUSHROOM_RED, I.ROASTED_MUSHROOM];
const MEAT = new Set([...BEEF, ...BIRD, ...FISH, ...OTHER_MEAT]);
const INGREDIENTS = new Set([...MEAT, ...POTATO, ...MUSHROOM, I.CARROT, B.PUMPKIN,
  B.KELP, I.DRIED_KELP, I.COCONUT, I.APPLE, I.EGG, I.DUCK_EGG, I.WHEAT, I.CHEESE, I.BUTTER, I.BEETROOT, I.SCORCH_PEPPER, I.RICE, I.BERRIES]);
export const potIngredient = (id) => INGREDIENTS.has(id);

// Meals, most particular first: each needs one of every listed group (extras
// are fine unless it says otherwise). Colour: the meta its surface shows.
const MEALS = [
  { id: I.SPICY_STEW, needs: [[I.SCORCH_PEPPER], [...MEAT, ...POTATO]], colour: 2 },
  { id: I.BEETROOT_SOUP, needs: [[I.BEETROOT], [I.BEETROOT]], colour: 3, meatless: true },
  { id: I.FRIED_RICE, needs: [[I.RICE], [I.EGG, I.DUCK_EGG, ...MEAT, I.CARROT, I.BEETROOT, I.SCORCH_PEPPER]], colour: 4 },
  { id: I.COCONUT_CURRY, needs: [[I.COCONUT], [...FISH, ...BIRD], [I.CARROT, ...POTATO]], colour: 3 },
  { id: I.BEEF_STEW, needs: [BEEF, [I.CARROT], POTATO], colour: 2 },
  { id: I.FISH_CHOWDER, needs: [FISH, POTATO], colour: 4 },
  { id: I.CHICKEN_SOUP, needs: [BIRD, [I.CARROT, ...POTATO, ...MUSHROOM]], colour: 4 },
  { id: I.PUMPKIN_SOUP, needs: [[B.PUMPKIN], [I.CARROT, ...POTATO, I.APPLE, I.COCONUT]], colour: 3, meatless: true },
  { id: I.VEGETABLE_SOUP, needs: [[I.CARROT], POTATO, [...MUSHROOM, B.KELP, I.DRIED_KELP]], colour: 3, meatless: true },
  { id: I.MUSHROOM_SOUP, needs: [MUSHROOM, [I.BUTTER, I.CHEESE]], colour: 4, meatless: true },
  { id: I.MUSHROOM_STEW, needs: [MUSHROOM, MUSHROOM], colour: 2, meatless: true },
];

// the meal a set of ingredients makes: a named one, or else a hearty stew
export function potMeal(items) {
  for (const m of MEALS) {
    if (m.meatless && items.some((id) => MEAT.has(id))) continue;
    const left = [...items];
    const ok = m.needs.every((group) => {
      const i = left.findIndex((id) => group.includes(id));
      if (i < 0) return false;
      left.splice(i, 1);
      return true;
    });
    if (ok) return m;
  }
  return { id: I.HEARTY_STEW, colour: 2 };
}

export function potState(world, x, y, z) {
  let st = world.blockEntityAt(x, y, z);
  if (!st || st.kind !== 'pot') {
    st = { kind: 'pot', water: false, items: [], t: 0, meal: null, servings: 0 };
    world.setBlockEntity(x, y, z, st);
  }
  return st;
}

// show the contents: setBlock clears the entity, so put it back after
export function showPot(world, x, y, z, st) {
  const meta = st.meal ? (potMeal(st.items).colour ?? 2) : st.water ? 1 : 0;
  if (world.getMetaW(x, y, z) !== meta) {
    world.setBlock(x, y, z, B.COOKING_POT, meta);
    world.setBlockEntity(x, y, z, st);
  } else world.setBlockEntity(x, y, z, st);   // (marks the chunk modified)
}

// an empty pot, ready for water again
export function emptyPot(st) {
  st.water = false; st.items = []; st.t = 0; st.meal = null; st.servings = 0;
}

// simmer: a watered pot with food in it over heat cooks its meal
export function tickPots(world, dt, onCooked) {
  forEachBlockEntity(world, 'pot', (x, y, z, st) => {
    if (world.getBlockW(x, y, z) !== B.COOKING_POT) return;
    if (st.meal || !st.water || st.items.length < 2 || !potHeated(world, x, y, z)) return;
    st.t += dt;
    if (st.t < SIMMER_TIME) return;
    st.meal = potMeal(st.items).id;
    // a proper recipe stretches to a helping more than went in (a fourth
    // thing in makes a fifth helping); a pot of odds and ends, one apiece
    st.servings = st.meal === I.HEARTY_STEW ? st.items.length : st.items.length + 1;
    showPot(world, x, y, z, st);
    onCooked?.(x, y, z, st);
  });
}

// what's in the pot, for breaking it: the raw ingredients come back (a
// finished meal spills and is lost), and so does the pot
export function potContents(st) {
  return st.meal ? [] : st.items.map((id) => ({ id, count: 1 }));
}

// Using the pot (it = the Interaction): water in, food in, a bowl for the
// meal; with an empty hand (or a bowl too soon) it says how it's getting on.
// False lets the use go on (eat what you hold, place a block against it).
export function usePot(it, t, held, { creative, itemName }) {
  const p = it.player, w = it.world;
  const st = potState(w, t.x, t.y, t.z);
  const say = (m) => it.cb.notify?.(m);
  const giveBack = (id) => {
    if (!p.inventory[p.selected]) p.inventory[p.selected] = { id, count: 1 };
    else if (p.give(id, 1) > 0) it.cb.spawnDrops(t.x + 0.5, t.y + 1, t.z + 0.5, [{ id, count: 1 }]);   // no room: drop it
  };
  const done = (sound, opts = {}) => {
    showPot(w, t.x, t.y, t.z, st);
    p.events.dispatchEvent(new CustomEvent('inventory'));
    if (sound) it.cb.playSound(sound, { pos: { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 }, ...opts });
    return true;
  };

  // pouring in and scooping out want a fresh press each (held down, the
  // bucket would go back and forth)
  const water = held?.id === I.WATER_BUCKET || (held?.id === I.BUCKET && st.water && !st.items.length && !st.meal);
  if (water && it.heldUse === 'pot-water') return true;
  if (water) it.heldUse = 'pot-water';
  if (held?.id === I.WATER_BUCKET) {
    if (st.water) { say('There’s water in the pot already'); return true; }
    st.water = true;
    if (!creative) p.inventory[p.selected] = { id: I.BUCKET, count: 1 };
    return done('splash', { vol: 0.5 });
  }
  // a bucket takes the water back out of a pot with nothing in it
  if (held?.id === I.BUCKET && st.water && !st.items.length && !st.meal) {
    st.water = false;
    if (!creative) { p.consumeHeld(1); giveBack(I.WATER_BUCKET); }
    return done('splash', { vol: 0.4 });
  }
  if (st.meal) {
    if (held?.id === I.BOWL) {
      const meal = st.meal;
      if (--st.servings <= 0) emptyPot(st);
      if (!creative) p.consumeHeld(1);
      giveBack(meal);
      if (!st.meal) say('That’s the last of it');
      return done('ladle');
    }
    if (held) return false;
    say(`${itemName(st.meal)} — ladle it out with a bowl (${st.servings} ${st.servings === 1 ? 'helping' : 'helpings'} left)`);
    return true;
  }
  if (held && potIngredient(held.id)) {
    // a dry or full pot doesn't stand between a hungry player and their food
    const eat = itemInfo(held.id)?.food > 0 && p.hunger < 20 && !creative;
    if (!st.water) { if (eat) return false; say('Fill the pot with water first (a water bucket)'); return true; }
    if (st.items.length >= POT_MAX_ITEMS) { if (eat) return false; say('The pot is full — let it cook'); return true; }
    st.items.push(held.id);
    st.t = 0;   // it simmers from the last thing in
    it.useCooldown = 0.4;   // one at a time, even with the button held
    if (!creative) p.consumeHeld(1);
    if (st.items.length >= 2 && !potHeated(w, t.x, t.y, t.z)) say('Now set it over a campfire to cook');
    return done('splash', { vol: 0.25, pitch: 1.6 });
  }
  if (held && held.id !== I.BOWL) return false;
  // how it's getting on
  if (!st.water) say('An empty pot: fill it with water, put in 2–4 foods and set it over a campfire');
  else if (st.items.length < 2) say(st.items.length ? 'Put in at least one more food' : 'Water’s in: now put in 2–4 foods');
  else if (!potHeated(w, t.x, t.y, t.z)) say(`${itemName(potMeal(st.items).id)}, waiting for a fire under the pot`);
  else say(`${itemName(potMeal(st.items).id)} is simmering — ready in ${Math.max(1, Math.ceil(SIMMER_TIME - st.t))}s`);
  return true;
}
