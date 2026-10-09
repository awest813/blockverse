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
- [x] Volume sliders for blocks / creatures / player & menus, brightness, view bobbing, F2 screenshots
- [x] Crosshair options (plus, big plus, dot, off)
- [x] World list search and sort, duplicate, export/import (.json), copy seed
- [x] Chat: Tab completes commands, items and mobs (with hints); /summon; a Send button on touch
- [x] Loading screen: Cancel button, and a note when it's taking a while

## Crafting & items
- [x] Shift-click craft output duplicated items when the inventory was nearly full
- [x] Shift-click furnace output lost/duplicated the remainder
- [x] Torches accept charcoal
- [x] Mossy cobblestone recipe used an unobtainable item (now cobble + seeds); clay block recipe
- [x] Recipe book counts mixed plank types (2 oak + 2 birch = table)
- [x] Smelting guide auto-fuel no longer burns coal blocks / chests / bookshelves
- [x] Ice can be collected
- [x] Bone meal on grass grows tall grass and flowers
- [x] Obsidian (pour water onto lava, or lava next to water); snowballs from snow, snowy grass and snow layers → snow blocks
- [x] Shears: shear sheep (fleece regrows), snip leaves / tall grass / dead bushes whole
- [x] Buckets: scoop and pour water and lava, milk cows (milk puts out fire)
- [x] Flint and steel (fire that burns out; lights TNT and campfires), fishing rod (cast, wait for the bite, reel in)
- [x] Ladders (climbable), oak doors (two-high, open/close), fences (connect, 1.5 high), oak/cobblestone/stone-brick slabs (two make a block; walk up them)
- [x] Stairs (oak, cobblestone, stone brick; upside-down too), glass panes (connect), fence gates (open/close), signs (standing or on walls, editable text)
- [x] Sugar cane and cactus grow (up to 3 tall) near the player
- [x] Tool repair: two worn tools of a kind mend into one (+5% bonus)

## Mobs & animals
- [x] **Dolphins** (ocean pods, follow swimmers, leap, speed boost; feed fish to escort you)
- [x] **Manatees** (warm rivers/swamps/coasts, surface to breathe; feed wheat or sugar cane)
- [x] Fed farm animals are kept: stashed when far away, saved with the world
- [x] Breeding: wheat (cow, sheep), seeds (chicken), apple (pig) → babies that grow up
- [x] Land mobs climb out of water at banks instead of bobbing forever
- [x] Swimmers and birds turn away from walls
- [x] Melee hits pets only while sneaking
- [x] Passive animals make (quiet) sounds; dolphins click, whales sing
- [x] Birds roost on the ground at night
- [x] Whales drop whale oil (long-burning fuel, torches, hanging or standing lanterns) — no meat: they're not a food source
- [x] Mobs push each other apart, and the player shoves through them
- [x] Sheep shearing / wool regrowth
- [x] Milk
- [x] Eggs: hens lay them; throw them (sometimes a chick hatches), or bake pumpkin pie (pumpkin + sugar + egg); snowballs throw too

## Hostile mobs
- [x] No melee hits through block corners (line of sight required)
- [x] No spawning on tree canopies
- [x] A lit creeper fuse ignores creative players
- [x] Zombies/skeletons don't burn while standing in water
- [x] Skeletons lead moving targets
- [x] Hostile cap scales with difficulty (easy 5 / normal 8 / hard 12)
- [x] Burning mobs show flames; burning zombies set you alight
- [x] Undead burning in the sun head for shade
- [x] Husks (desert, sun-proof, hits make you hungry), drowned (swim after you, spawn in water at night, zombies drown into them), baby zombies (fast)
- [x] Arrows slow right down in water

## Survival mechanics
- [x] Starvation floor by difficulty (easy 5 hearts, normal ½, hard none)
- [x] Peaceful regenerates health and hunger
- [x] Respawn resets exhaustion / regen / air timers
- [x] No sprint hunger drain in shallow water
- [x] Burning state: lava sets you on fire, water/milk put it out, flames on screen
- [x] Eating and drinking take time (hold use; touch: one tap), and slow you down
- [x] Per-food saturation (cooked meat keeps you full longest); rotten flesh and raw chicken can upset your stomach
- [x] Mining is slower underwater and in mid-air

## Swimming
- [x] Sprint-swimming in the look direction (dive/climb with pitch)
- [x] Sneak to dive faster; hop out at ledges
- [x] Sneak edge-guard no longer applies underwater
- [x] Dolphin's grace speed boost
- [x] Bubbles rise while underwater; water darkens with depth and at night
- [x] Sound muffles underwater, with a low hum

## Biomes & world generation
(new decoration needs a generator version bump so existing worlds don't seam)
- [x] (gen v4) Decoration per 8×8 quadrant with per-feature biome checks: trees and grass along rivers, no flowers on sand
- [x] (gen v5) Kelp forests and seagrass in oceans and rivers
- [x] (gen v6) Shipwrecks with cargo chests
- [x] (gen v6) Ocean ruins: broken stone-brick walls with a chest
- [x] (gen v4) Sugar cane grows wherever low ground touches water
- [x] (gen v4) Sparse spruce on the tundra, mossy boulders on mountains/tundra, more mountain spruce, more desert dead bushes
- [x] (gen v5) Shallow swamp pools with lily pads and seagrass
- [x] (gen v5) Lava floods the deepest caves; snow layers on the tundra, snowfields on high peaks
- [x] (gen v6) Desert wells
- [x] (gen v6) Fossils of bone blocks buried under deserts and swamps (bone blocks craft from bone meal)

## Rendering & audio
- [x] Fog colour converted to the screen's colour space (it was darker than the sky, near-black at night)
- [x] Mobs, drops, arrows, sign text and the hand lit with the terrain's light curve (they glowed at night)
- [x] Scene fog for mobs, items and particles; no sky, sun or clouds underwater
- [x] Gradient sky dome with a dusk glow on the sun's side; warm torchlight, cool moonlight; stars wheel; clouds tinted by time of day, fading at the edge
- [x] East/west block faces were mirrored
- [x] Transparent texels no longer darken leaf/flower/glass edges in the distance
- [x] Dirty-chunk queue drops unloaded chunks; light queue sorted once a frame; chunk work keeps a budget on slow frames
- [x] Audio: limiter, positional falloff and stereo panning, per-sound throttles, background-tab suspend, ambience (fire, lava, caves, crickets, heartbeat), door/chest/sizzle/burp sounds
- [x] Mesher reads the 3×3 neighbour chunks directly with precomputed offsets (same output, ~2× faster rebuilds)
- [ ] One material per mob part: bake colours into vertex colours, one material per mob
- [ ] Slabs, stairs and other shaped blocks are lit flat (no smooth light / AO)
- [x] Water drifts gently (animated texture)

## Saving & stability
- [x] Furnace, chest and campfire changes mark their chunk for saving (taking items out could duplicate them after a reload)
- [x] Chunks and the world entry save in one transaction; a failed save is retried and reported
- [x] Saves when the tab is hidden (phones close background tabs without warning)
- [x] Items on the cursor or in the crafting grid are saved with the inventory
- [x] Items on the ground (your things after a death) are saved and come back
- [x] A world saved on the death screen loads with you respawned (it used to soft-lock)
- [x] One renderer for the page: quitting and loading worlds no longer leaks GPU textures; the block highlight and particles are freed
- [x] A hidden tab keeps the world ticking but stops drawing
- [x] Natural cane/cactus growth no longer makes untouched chunks save
- [x] Doors and gates won't shut on you; ladders, signs and torches fall with their support (and in explosions)
