# BlockVerse gap list

Collected from audits of biomes, mobs, hostile mobs, crafting, survival
mechanics, swimming and the in-game + launcher UI. `[x]` = done,
`[ ]` = open. Roughly most important first within each section.

## UI / UX
- [x] **Touch: containers couldn't be closed** — every container window has a ✕ (44px on touch), and a tap outside closes on touch
- [x] Phones: HUD never shrinks below 85% on touch; thumb buttons are 44px+ (menus still use the auto GUI scale)
- [x] Settings panel no longer clipped on short screens
- [x] Debug overlay and chat no longer overlap in touch mode
- [x] Inventory / recipe-book hints follow key bindings and input type (touch, gamepad); loading tips use real bindings
- [x] Ctrl+W mid-game: the world saves and the browser asks before leaving (sprint stays on Ctrl)
- [x] Empty world list leads with a big Create New World button
- [x] Esc from in-game Settings returns to the pause menu
- [x] Chat and toasts fade behind menus and containers
- [x] Keybind conflicts say what they clash with, inline
- [x] Death screen: readable title, "Save & Quit to Title" like the pause menu
- [x] Focus rings for creative tabs, recipes, slots; reduced motion covers pulses and toasts
- [x] Furnace flame is a pixel icon (touch glyphs still ▦ / …)
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
- [x] Shears: shear sheep (fleece regrows), snip leaves / tall grass / dead bushes whole
- [ ] Bucket, flint & steel, fishing rod
- [ ] Ladders, doors, fences, slabs/stairs, glass panes, signs
- [x] Sugar cane and cactus grow (up to 3 tall) near the player
- [ ] Tool repair in the crafting grid

## Mobs & animals
- [x] **Dolphins** (ocean pods, follow swimmers, leap, speed boost; feed fish to escort you)
- [x] **Manatees** (warm rivers/swamps/coasts, surface to breathe; feed wheat or sugar cane)
- [x] Fed farm animals are kept: stashed when far away, saved with the world
- [x] Breeding: wheat (cow, sheep), seeds (chicken), apple (pig) → babies that grow up
- [x] Land mobs climb out of water at banks instead of bobbing forever
- [x] Swimmers and birds turn away from walls
- [x] Melee hits pets only while sneaking
- [x] Passive animals make (quiet) sounds; dolphins click, whales sing
- [ ] Birds roost at night; whales drop nothing
- [x] Mobs push each other apart, and the player shoves through them
- [x] Sheep shearing / wool regrowth
- [ ] Milk, eggs

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
- [x] Bubbles rise while underwater; water darkens with depth and at night
- [ ] Muffled underwater ambience

## Biomes & world generation
(new decoration needs a generator version bump so existing worlds don't seam)
- [x] (gen v4) Decoration per 8×8 quadrant with per-feature biome checks: trees and grass along rivers, no flowers on sand
- [ ] Oceans are empty (kelp/seagrass, sand/gravel patches, shipwrecks)
- [x] (gen v4) Sugar cane grows wherever low ground touches water
- [x] (gen v4) Sparse spruce on the tundra, mossy boulders on mountains/tundra, more mountain spruce, more desert dead bushes
- [ ] Swamps have no standing water / lily pads
- [ ] Desert wells/fossils; lava pools + obsidian in deep caves
