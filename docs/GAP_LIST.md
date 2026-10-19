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
- [x] Ice can be collected with a pickaxe (broken any other way it melts to water)
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
- [x] Mob part boxes share geometry by size; the boxes a mob never moves or recolours merge into one vertex-coloured mesh (mob draw calls 234 → 96)
- [x] Greedy meshing (~25% fewer terrain triangles); chunk changes the world makes itself rebuild lazily, one a frame
- [x] Slabs, stairs and other shaped blocks get smooth per-corner light from the cells around them
- [x] Water drifts gently (animated texture)

## Saving & stability
- [x] Furnace, chest and campfire changes mark their chunk for saving (taking items out could duplicate them after a reload)
- [x] Chunks and the world entry save in one transaction; a failed save is retried and reported
- [x] Saves when the tab is hidden (phones close background tabs without warning)
- [x] Items on the cursor or in the crafting grid are saved with the inventory
- [x] Items on the ground (your things after a death) are saved and come back
- [x] A world saved on the death screen loads with you respawned (it used to soft-lock)
- [x] One renderer for the page: quitting and loading worlds no longer leaks GPU textures; the block highlight and particles are freed
- [x] A hidden tab keeps furnaces, crops and the like going but stops drawing (the player, mobs and the clock wait)
- [x] Natural cane/cactus growth no longer makes untouched chunks save
- [x] Doors and gates won't shut on you; ladders, signs and torches fall with their support (and in explosions)
- [x] Only changed chunks (and ones with growing/burning/smelting things) are written each save — loaded saved chunks used to be rewritten every 20 s
- [x] Chunks unloaded before they were saved wait in memory and go out with the next save (it used to be a separate, unchecked write)
- [x] Save & Quit waits for the save ("Saving world…") and reports a failure; a "Saving…" note shows during autosaves
- [x] One tab per world (Web Locks); rename/delete refuse while it's open elsewhere
- [x] Damaged chunks regenerate, unknown or broken item stacks are dropped, a bad saved position falls back to the spawn point; imports are checked chunk by chunk; export errors are reported

## Chromebooks
- [x] Resolution setting (Auto / Full / 75% / 50%); Auto steps down under 75% of the target frame rate and back up with headroom; starts at 1× on low-end hardware
- [x] Frame rate limit (Off / 60 / 30)
- [x] First run on low-end hardware (≤4 cores or ≤4 GB) defaults to render distance 6
- [x] Touchpad scroll accumulates (~60px per hotbar step); sideways swipes ignored
- [x] Pick block key (R) for touchpads without a middle button; screenshot rebindable
- [x] Search/Meta keys can't be bound; top-row Back/Forward suppressed in game
- [x] ChromeOS hints: Search + top row for F-keys, two-finger click, Ctrl+Space layout switching


## Playthrough findings (newcomer, min-maxer, builder, chaos)
- [x] Dying with the inventory open left the window on the death screen and lost the cursor stack — it now closes first, so everything drops
- [x] Autosave counted game time (capped per frame), so a slow device saved every minute or more; it's wall-clock now (every 10 s, 3 s after a chunk unloads)
- [x] Saves also on `pagehide`
- [x] Thumb controls bled through the pause/settings/death screens (and sat under "Done"); hidden behind menus, restored on resume; hotbar and bars recede
- [x] "Inventory & crafting" hint ran off the screen at a large GUI scale on laptops (horizontal scroll); it moves above the hotbar when room is tight
- Checked, no problems: create → play → craft by clicking → die → respawn → reload; furnace/chest/cursor/bucket/drop/explosion item conservation; save mid-smelt; 961-block build identical after reload and after export → delete → import; resize, tab hide/show, key mashing, repeated quit/play

## Dungeon mini bosses
- [x] Zombie Brute / Bone Archer / Brood Mother guard zombie / skeleton / spider dungeons (buried cages only — not surface temples); woken at runtime, so every existing world gets them without a generator change
- [x] Boss health bar (name + bar, top centre; moves under the touch buttons on phones)
- [x] Special attacks: telegraphed ground slam, three-arrow volley + kick, spiderling waves at 75/50/25% health (spiderlings drop nothing)
- [x] Knockback resistance, difficulty-scaled health, leashed to their room, despawn past 64 blocks and return at full health; never in Peaceful or for creative players
- [x] The cage remembers 'awake' / 'defeated' (saved with the chunk); guaranteed loot; roar on waking, fanfare on defeat; death messages; /summon support

## Audio pass 2
- [x] Generative music (day / night / cave moods, fades for boss fights, Music slider; nothing while muted)
- [x] Cave echo (feedback-delay send, faded in when there's no sky above you)
- [x] Block sounds positioned at the targeted block (panning)
- [x] New sounds: ignite (flint and steel), shear, arrow thunk, bow draw, item drop, swim strokes, lava bucket gloop; lava meeting water sizzles instead of splashing
- [x] Muted volume builds no audio nodes


## Farming, automation and husbandry
- [x] Carrots and potatoes (4 growth stages each, replanted from the vegetable); baked potato; golden carrot; hay bale (9 wheat, reversible)
- [x] Sprinkler (crops within 4 blocks grow ~3.5× faster), harvester (reaps ripe crops, replants, fills an adjacent chest), collector (vacuums drops into an adjacent chest), composter (scraps → bone meal); all saved with the chunk
- [x] Trough: holds feed (a hay bale goes in as 9 wheat), grows babies and pairs up adults within 6 blocks
- [x] Pigs eat carrots/potatoes; a golden carrot breeds any farm animal or grows a baby up at once
- [x] Aiming a vegetable at farmland plants it instead of eating it, even when hungry
- [x] Rare loot: glinting drops plus a pickup chime and label; rare zombie (carrot, potato, iron) and skeleton (worn bow) drops; chests in newly generated worlds (generator v8) can hold carrots, potatoes and golden carrots. Older worlds' generation is unchanged
- [x] Audit: a hay bale only goes into a trough with room for all nine wheat (a nearly full trough used to take part of it for free)
- [x] Audit: picking your own thrown, dropped or death-pile diamonds back up isn't announced as a rare find (saved with the drop)
- [x] Audit: a new sprinkler hurries crops already growing, not just their next stage; a harvester with no chest leaves crops where they grew instead of inside the block above it
- [x] Audit: a trough stops pairing animals once 16 of a kind crowd round it; food a trough or composter won't take says why instead of doing nothing

## Playthroughs 2 (10 runs: 3 newcomer, 3 min-maxer, 2 builder, 2 chaos)
- [x] New farming tips: carrots & potatoes, hay & troughs, farm machines (the old Farming tip only mentioned seeds)
- [x] Offering an animal the wrong food says what it eats ("Pigs eat apple, carrot or potato") instead of doing nothing
- [x] A trough only feeds animals that can walk to it: it used to reach through a fence and make wild animals outside the pen "kept"
- [x] The crowding limit counts the whole pen and caps the pairs fed per round, so a pen holds at 16 of a kind (one round could pair 7 couples and overshoot to 21)
- Checked, no problems: item conservation through harvester (chest full), collector (chest full, worn tools), trough (break, explosion), composter (~10.7 wheat per bone meal); owned drops across reload; boss loot, rare-find announcement and "stays beaten" across reload; generator-8 chests (19 loaded: 9 carrot, 9 potato, 1 golden carrot stacks); pens cap at the crowding limit; a 192-crop farm identical after save & quit and export → delete → import, and still harvesting; a 13-animal ranch grew to 60 and every animal came back after unloading and reloading; every item used on every new block and 1200 random actions without an error or an inconsistent state; tab hide/show, four viewports, 200 random taps, 300 random keys, five quick quit/plays on a phone

## Goats, horses, ducks (and sheep)
- [x] Goat (mountains, snowy tundra; rocky ground): milkable, leaps about, ignores drops up to 9 blocks; hit one and it charges (telegraphed head-down wind-up, knockback, 2 damage), and now and then one charges anyway. Leather and mutton
- [x] Horse (plains, birch forest; herds of 2-3): six coats, its own top speed (7.5-11 m/s) and jump (1.5-2.6 blocks). Feeding calms it; climbing on with an empty hand gives it a chance to trust you (thrown off otherwise, calmer next time). Saddle (5 leather + iron ingot) to ride: it faces where you look, sprint to gallop, jump, sneak to get off; no squeezing under low roofs with a rider; your horse isn't a target from the saddle or without a sneak. Golden apples/carrots breed tamed horses; foals grow on wheat, apples and hay. Coat, gifts, owner and saddle saved
- [x] Duck (rivers, swamps, plains; flocks): float half-under the surface, walk into water instead of turning back; drakes and hens look different (saved); feathers and raw duck, roast duck from a furnace or campfire
- [x] Farm babies of every kind follow a grown-up of their kind
- [x] Sheep: a shorn sheep grazes (grass to dirt) and grows its wool back at once
- [x] Tips for wild horses and goats; quack, bleat, whinny and hoofbeat sounds; touch/gamepad sneak toggles are let go when you get off a horse

## Animals audit: mechanics and tools
- [x] Baby animals growing up against a fence were popped on top of it by the collision fix-up and walked out of the pen (1 animal in ~4 twenty-minute ranch runs); a grown-up now slides sideways into room, or waits a moment. 6/6 traced runs, no escapes
- [x] Feeding a horse a hay bale did nothing (wrong id); horses list what they eat when offered the wrong food
- [x] Every horse clears a fence (jump 1.8-2.7 blocks; older saves are raised); goat leaps (1.4) don't clear fences
- [x] A saddled horse of yours can be mounted with anything but food in hand; no climbing on without headroom (a rider's head would push the horse up through a low roof)
- [x] Luring: farm animals follow a player holding a food they like (within 10 blocks)
- [x] Lead (2 from 3 string + leather): lead a farm animal (not pets or monsters), tie it to a fence post, take the lead back from the post, snaps past 12 blocks or if the post goes; drawn as a rope; ties are saved; climbing onto a leashed horse gives the lead back
- [x] Goat horn: knocked off a goat charging into rock (the goat shows it, saved); blowing it calls your horses within 64 blocks
- [x] Audit: dungeon bosses had a `leash()` method (stay near the cage) that collided with the new lead code: every frame of a boss fight threw, which stalled the game loop (the music never faded). Renamed to `stayHome()`; a check now runs a boss beside the lead code
- [x] Audit: riding a horse off a cliff hurts the rider too; a lead doesn't snap when its fence post's chunk isn't loaded; ropes take the light around them (dark at night); only goats spawn on bare mountain stone; no placing a solid block inside an animal (it was squeezed out upward); a horse called by a horn keeps cantering until it reaches you
- [x] Audit: "every horse clears a fence" only held at a gallop; jump raised to 2.1-2.9 blocks so it holds at a trot too (older saves raised). A lead now pulls an animal along at the holder's pace (a sprint used to snap it: the tug was overwritten by the animal's own steering). A horse that comes when called waits for you for 20 seconds

## UI/UX pass 3 (laptop, Chromebook 125%, 1024x600, phone)
- [x] Automatic tour of every screen on four devices with layout checks (sideways scroll, clipped text, off-screen controls, tap-target sizes): laptop, Chromebook and 1024x600 clean
- [x] Phones: Auto GUI scale shrank every menu to 60% to fit the inventory; menus that need less room (title, world list, pause, death, dialogs) now grow back toward full size (per-screen fit, re-fitted when content changes or the window resizes)
- [x] Touch screens: buttons at least ~36px, settings toggles/tabs ~30px with spaced rows, enlarged tap areas for recipe-book tabs and "copy seed" (coarse-pointer media query, so the title screen gets it too); taller chat box
- [x] "Saving…" covered the touch Pause button; it sits below the top buttons on touch
- [x] Tooltips (items and recipes) say what the less obvious things are for: lead, goat horn, saddle, golden carrot, bone meal, seeds, carrots, potatoes, shears, bucket, hay bale, trough, composter, sprinkler, harvester, collector

## Title screen
- [x] Play is the big green button, beside Create New World; the selected world's actions (Rename, Duplicate, Export, Delete) on their own row, then Import and Settings (seven small buttons used to wrap 3/3/1 on a phone)
- [x] Long world names are cut short with "…" (full name on hover) instead of running under the play button and out of the list; accents aren't clipped; world details wrap
- [x] Search box, sort menu and list line up (460px)
- [x] The footer sits under the buttons instead of pinned to the window's foot (it covered the list on 1024x600 and touched the buttons on a phone)
- [x] A rotating splash line under the title ("Now with horses!", "Mind the goat!"…), with a gentle pulse that respects reduced motion
- Checked: no worlds / one / eight with search and no-match; laptop, Chromebook, 1024x600, landscape and portrait phone; keyboard focus lands on Create (no worlds) or the selected world

## The Scorchlands: 100 scripted playthroughs
A bot played new worlds from the first tree to the dragon and home (95 runs: 91 complete, the rest stopped by the bot's own aim or the batch's time limit; no game errors)
- [x] Castle gates stood over 2-5 block drops (5 of 15 castles): a causeway now runs from the gate to the land, and rubble stays off the way to the keep
- [x] The roost's stair ended in mid-air: it now goes down the side where the land meets it
- [x] Burning was the second-biggest source of damage (no water to put it out there): fireballs burn for a second; knights, the Knight Captain and the dragon hit a little softer
- [x] Dying in the Scorchlands, or reloading on its death screen, wakes you at home by your bed; arrivals never land inside a castle, the roost or a build

## Compared with other open-source voxel games (Luanti/Minetest Game, VoxeLibre, ClassiCube…)
- [x] Weather: showers come and go (rain, snow where it's cold, none over deserts); grey skies, closer fog, the sound of rain; rain puts out fires and burning players, stops the undead burning and keeps farmland wet; `/weather`
- [x] Sand and gravel fall when nothing holds them up (and stack when they land)
- [x] Leaves cut off from their trunk wither and drop saplings and apples (placed leaves stay)
- [x] Chips fly off blocks as you dig them, and a burst when one breaks
- [x] Farmland: jumping on it tramples it (and the crop); bare farmland with no water or sprinkler near dries back to dirt
- [x] Hay bales, wool and beds break a fall (80% less damage)
- [x] Sprinting widens the view a touch (off with view bobbing)
- [x] Dropped items blink for their last ten seconds before vanishing
- [ ] Flowing water and lava (sources and flowing levels; waterfalls, irrigation, lava traps)
- [ ] Experience and enchanting-like progression past diamond and dragon gear
- [x] Villages (generator 12): square, roads, houses, smithy, kitchen, library, fields, stable; no night spawns; a start in sight of one
- [ ] Villagers and trading with them (planned: docs/VILLAGE_PLAN.md)
- [ ] Boats; minecarts and rails
- [ ] Redstone-lite: levers, buttons, pressure plates, wire, lamps, powered doors (and switching farm machines)
- [ ] Fire spreading to flammable blocks (with a switch)
- [x] Dyes, coloured wool and carpets; flowers make dyes
- [ ] Coloured glass
- [ ] Building set: stairs, slabs, doors and fences in every wood; walls; trapdoors; sideways logs; wall torches
- [ ] Maps, compass and clock; item frames, armour stands, paintings; third-person view
- [x] Crops, saplings, hives and kept animals catch up when a chunk loads (up to two days)
- [ ] Furnaces catch up while away
- [ ] Papercuts: chest sort / quick-stack, sleep blocked by named monsters, crops needing light, a corner coordinate readout, /setblock and /fill
