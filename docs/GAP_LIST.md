# BlockVerse gap list

Collected from audits of biomes, mobs, hostile mobs, crafting, survival
mechanics, swimming and the in-game + launcher UI. `[x]` = done,
`[ ]` = open. Roughly most important first within each section.

## UI / UX
- [ ] **Touch: containers can't be closed** (screen covers the touch buttons) — add a ✕/Done button to every container window, tap outside to close
- [ ] **Phones: GUI too small** (auto scale floors at 0.6 → ~8px text, 26px touch targets); allow pinch zoom
- [ ] Settings panel clipped on short screens (max-height fights `zoom`)
- [ ] Debug overlay and chat overlap in touch mode
- [ ] Inventory hint text ignores rebinding / touch; loading tip hard-codes "T or /"
- [ ] Default sprint key Ctrl (Ctrl+W closes the tab outside fullscreen); Ctrl+Q drop-stack quits Firefox
- [ ] Empty world list: big disabled "Play" above a small "Create"
- [ ] Esc from in-game Settings should return to the pause menu
- [ ] Chat/toasts show through pause and container screens
- [ ] Keybind conflicts only shown as a red border; say what clashes
- [ ] Death screen: low-contrast title, inconsistent "Title Screen" vs "Save & Quit" wording
- [ ] Focus rings for creative tabs, recipes, slots; reduced-motion for pulses/toasts
- [ ] Furnace 🔥 emoji clashes with pixel icons; ambiguous touch glyphs
- [ ] Separate volume sliders, brightness, view bobbing, screenshot key, crosshair options
- [ ] World list search/sort, duplicate, export/import, copy seed
- [ ] Chat command completion; touch send button
- [ ] Loading screen cancel / "taking longer" state

## Crafting & items
- [x] Shift-click craft output duplicated items when the inventory was nearly full
- [x] Shift-click furnace output lost/duplicated the remainder
- [x] Torches accept charcoal
- [x] Mossy cobblestone recipe used an unobtainable item (now cobble + seeds); clay block recipe
- [x] Recipe book counts mixed plank types (2 oak + 2 birch = table)
- [x] Smelting guide auto-fuel no longer burns coal blocks / chests / bookshelves
- [x] Ice can be collected
- [x] Bone meal on grass grows tall grass and flowers
- [ ] Unobtainable: obsidian (no lava), snow block (no snowballs)
- [ ] Shears (wool without killing, collect grass/dead bush), bucket, flint & steel, fishing rod
- [ ] Ladders, doors, fences, slabs/stairs, glass panes, signs
- [ ] Sugar cane and cactus never grow
- [ ] Tool repair in the crafting grid

## Mobs & animals
- [x] **Dolphins** (ocean pods, follow swimmers, leap, speed boost; feed fish to escort you)
- [x] **Manatees** (warm rivers/swamps/coasts, surface to breathe; feed wheat or sugar cane)
- [x] Fed farm animals are kept: stashed when far away, saved with the world
- [x] Breeding: wheat (cow, sheep), seeds (chicken), apple (pig) → babies that grow up
- [x] Land mobs climb out of water at banks instead of bobbing forever
- [x] Swimmers and birds turn away from walls
- [x] Melee hits pets only while sneaking
- [ ] Passive mob sounds; birds roost at night; whales drop nothing
- [ ] Mob–mob / player–mob collision (mobs overlap)
- [ ] Sheep shearing / wool regrowth, milk, eggs

## Hostile mobs
- [x] No melee hits through block corners (line of sight required)
- [x] No spawning on tree canopies
- [x] A lit creeper fuse ignores creative players
- [x] Zombies/skeletons don't burn while standing in water
- [x] Skeletons lead moving targets
- [x] Hostile cap scales with difficulty (easy 5 / normal 8 / hard 12)
- [ ] Burning flame visual, undead seek shade
- [ ] Husks (desert), drowned (zombies underwater), baby zombies
- [ ] Arrows slow in water

## Survival mechanics
- [x] Starvation floor by difficulty (easy 5 hearts, normal ½, hard none)
- [x] Peaceful regenerates health and hunger
- [x] Respawn resets exhaustion / regen / air timers
- [x] No sprint hunger drain in shallow water
- [ ] Burning state (fire time, extinguished by water) for campfires/lava
- [ ] Per-food saturation, eating takes time
- [ ] Mining slower underwater / in mid-air

## Swimming
- [x] Sprint-swimming in the look direction (dive/climb with pitch)
- [x] Sneak to dive faster; hop out at ledges
- [x] Sneak edge-guard no longer applies underwater
- [x] Dolphin's grace speed boost
- [ ] Underwater bubbles, depth darkening, muffled ambience

## Biomes & world generation
(new decoration needs a generator version bump so existing worlds don't seam)
- [ ] Decoration uses one biome sample per chunk → bare strips by rivers, flowers on beach sand
- [ ] Oceans are empty (kelp/seagrass, sand/gravel patches, shipwrecks)
- [ ] Rivers never get sugar cane
- [ ] Snowy tundra featureless; mountains bland; swamps have no standing water / lily pads
- [ ] Desert wells/fossils; lava pools + obsidian in deep caves
