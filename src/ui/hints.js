// Contextual survival tips shown as toasts the first time they become useful
// (first log -> craft planks -> crafting table -> tools ...). Which tips have
// been seen is remembered across worlds, since it's the player's knowledge.

import { B } from '../blocks/blocks.js';
import { I } from '../items/itemIds.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';

const SEEN_KEY = 'blockverse-hints';
const LOGS = [B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG];
const PLANKS = [B.OAK_PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS];
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
        'Night is coming', 'Zombies roam in the dark. Build a shelter, light it with torches, or sleep in a Bed.'],
      ['hungry', () => p.hunger <= 12, I.APPLE,
        'Hungry', `Hold food and ${k('use')} to eat. Cooked meat fills you up the most.`],
      ['sapling', () => has(SAPLINGS()), B.OAK_SAPLING,
        'Saplings', 'Plant saplings on grass or dirt — they grow into new trees.'],
      ['storage', () => p.inventory.filter(Boolean).length >= 28, B.CHEST,
        'Running out of space?', '8 planks make a Chest with 27 slots of storage.'],
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
