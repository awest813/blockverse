// Contextual survival tips shown as toasts the first time they become useful
// (first log -> craft planks -> crafting table -> tools ...). Which tips have
// been seen is remembered across worlds, since it's the player's knowledge.

import { B } from '../blocks/blocks.js';
import { I } from '../items/itemIds.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';

const SEEN_KEY = 'blockverse-hints';
const LOGS = [B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG];
const PLANKS = [B.OAK_PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS];
const cap = (t) => t[0].toUpperCase() + t.slice(1);
const RAW_FOOD = [I.PORKCHOP_RAW, I.MUTTON_RAW, I.BEEF_RAW, I.CHICKEN_RAW, I.FISH_RAW];
const SAPLINGS = () => [B.OAK_SAPLING, B.BIRCH_SAPLING, B.SPRUCE_SAPLING];

function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set(); }
}

export class Hints {
  constructor(game) {
    this.game = game;
    this.seen = loadSeen();
    this.playTime = 0;
    this.openedInventory = this.seen.has('opened-inventory');
  }

  save() {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...this.seen])); } catch { /* storage unavailable */ }
  }

  markInventoryOpened() {
    if (this.openedInventory) return;
    this.openedInventory = true;
    this.seen.add('opened-inventory');
    this.save();
    this.game.hud.setInventoryHint(null);
  }

  // [id, condition, icon item, title, text]; checked in order, one toast at a time
  tips() {
    const g = this.game, p = g.player;
    const has = (ids, n = 1) => ids.reduce((sum, id) => sum + p.countOf(id), 0) >= n;
    const k = (what) => g.controlLabel(what);
    return [
      ['punch-tree', () => this.playTime > 25 && !has(LOGS) && !has(PLANKS), B.OAK_LOG,
        'Gather wood', `Find a tree and ${k('mine')} its trunk to collect logs.`],
      ['craft-planks', () => has(LOGS) && !has(PLANKS), B.OAK_PLANKS,
        'Make planks', `${k('inventory')} opens your inventory — pick Planks in the recipe book.`],
      ['craft-table', () => has(PLANKS, 4) && !has([B.CRAFTING_TABLE]) && !this.seen.has('place-table'), B.CRAFTING_TABLE,
        'Crafting Table', '4 planks make a Crafting Table. It unlocks tools and bigger recipes.'],
      ['place-table', () => has([B.CRAFTING_TABLE]), B.CRAFTING_TABLE,
        'Use your table', `Place the Crafting Table, then ${k('use')} it to craft a Wooden Pickaxe.`],
      ['furnace', () => has([B.COBBLESTONE], 8), B.FURNACE,
        'Furnace', '8 cobblestone make a Furnace: smelt ores and cook raw meat.'],
      ['night', () => g.time > 0.43 && g.time < 0.5, B.TORCH,
        'Night is coming', 'Zombies, skeletons, spiders and creepers come out in the dark. Build a shelter, light it with torches, or sleep in a Bed.'],
      ['hungry', () => p.hunger <= 12, I.APPLE,
        'Hungry', `Hold food and ${k('use')} to eat. Cooked meat fills you up the most.`],
      ['sapling', () => has(SAPLINGS()), B.OAK_SAPLING,
        'Saplings', 'Plant saplings on grass or dirt — they grow into new trees.'],
      ['storage', () => p.inventory.filter(Boolean).length >= 28, B.CHEST,
        'Running out of space?', '8 planks make a Chest with 27 slots of storage.'],
      ['seeds', () => has([I.WHEAT_SEEDS]), I.WHEAT_SEEDS,
        'Farming', `Craft a hoe and ${k('use')} grass to till it, then plant seeds. Crops grow twice as fast near water.`],
      ['wheat', () => has([I.WHEAT], 3), I.BREAD,
        'Bread', '3 wheat in a row make Bread — a filling, renewable food.'],
      ['bone', () => has([I.BONE]), I.BONE_MEAL,
        'Bone meal', `Craft bones into bone meal, then ${k('use')} it on crops or saplings to make them grow.`],
      ['armor', () => has([I.IRON_INGOT], 5) || has([I.DIAMOND], 5), I.IRON_CHESTPLATE,
        'Armour', 'Ingots or diamonds make helmets, chestplates, leggings and boots. Wear them to take less damage.'],
      ['creeper', () => g.entities.mobs.some((m) => m.kind === 'creeper' && Math.hypot(m.x - p.x, m.z - p.z) < 14), I.GUNPOWDER,
        'Creeper!', 'It hisses before it explodes — back away fast, or hit it first.'],
      ['bow', () => has([I.STRING], 3), I.BOW,
        'Bow', '3 sticks + 3 string make a Bow. Arrows need flint (from gravel), a stick and a feather (from chickens).'],
      ['tame', () => g.entities.mobs.some((m) => (m.kind === 'dog' || m.kind === 'cat') && !m.tamed && Math.hypot(m.x - p.x, m.z - p.z) < 12), I.BONE,
        'A wild animal', `Tame dogs with bones and cats with raw fish (${k('use')} them). Dogs guard you; creepers fear cats.`],
      ['leather', () => has([I.LEATHER], 3), I.LEATHER_CHESTPLATE,
        'Leather armour', 'Cow leather makes light armour — a good start before iron.'],
      ['campfire', () => RAW_FOOD.some((id) => has([id])), B.CAMPFIRE,
        'Cook on a campfire', `3 sticks, coal or charcoal and 3 logs make a Campfire. ${cap(k('use'))} it with raw meat or fish to cook — no fuel needed.`],
      ['bed', () => has([B.WOOL], 3), B.BED,
        'Bed', '3 wool + 3 planks make a Bed. Sleep to skip the night and set your respawn point.'],
    ];
  }

  update(dt) {
    const g = this.game;
    if (g.player.mode === GAMEMODE_CREATIVE || g.player.dead || g.uiOpen) return;
    this.playTime += dt;
    if (!this.openedInventory && this.playTime > 4) g.hud.setInventoryHint(g.controlLabel('inventory'));
    if (g.hud.toastBusy()) return;
    for (const [id, cond, icon, title, text] of this.tips()) {
      if (this.seen.has(id) || !cond()) continue;
      this.seen.add(id);
      this.save();
      g.hud.toast(title, text, icon);
      break;
    }
  }
}
