# BlockVerse

**An open-source voxel sandbox game that runs entirely in your browser.**

Explore an infinite procedurally generated world. Mine blocks, craft tools, smelt ores, build anything, survive the night. No installs, no accounts, no servers — your worlds are saved locally in your browser.

> 🎮 **[Play it now →](https://awest813.github.io/blockverse/)**

BlockVerse is an original, from-scratch implementation of the classic voxel-sandbox genre, in the spirit of games like Minecraft. It is an unofficial fan project, **not affiliated with, endorsed by, or connected to Mojang or Microsoft** in any way. Every line of code is original, and every in-game texture and sound is **generated procedurally at runtime**: the game itself uses no image or audio files (the only pictures in the repository are the app icons, the link-preview image and the screenshots in this README).

![Plains biome](docs/screenshots/plains.jpg)

| Mining & drops | Mobs | Night |
| --- | --- | --- |
| ![Mining](docs/screenshots/mining.jpg) | ![Sheep](docs/screenshots/sheep.jpg) | ![Night](docs/screenshots/night.jpg) |

---

## Features

### 🌍 Infinite procedural world
- Seed-driven, fully deterministic terrain — the same seed always produces the same world
- **10 biomes**: plains, forest, birch forest, snowy tundra, snowy forest, desert, swamp, mountains, ocean and winding **rivers** (plus beaches), each typically several hundred blocks across with wavy, natural borders; grass, leaves and water take their colour from the climate (deep olive swamps, sun-bleached grass toward the deserts, cool blue-green near the snow); cold water freezes over and cold mountain ranges are snowbound
- Multi-octave gradient-noise terrain with rolling hills, regional mountain ranges with snow caps, erosion-controlled roughness, and flattened swamps
- **Cave systems**: winding spaghetti tunnels and large "cheese" caverns deep underground, with flooded lower depths, mushrooms and mossy patches; tunnels narrow near the surface so hillsides stay intact and never breach the seabed
- **Dungeons**: rare mossy-cobblestone rooms where caves run into them, each with a **monster spawner** (zombies, skeletons or spiders that keep coming until you break the cage) and one or two chests of loot
- **Dungeon mini bosses**: the first time you walk into a dungeon, its guardian wakes, with a health bar across the top of the screen:
  - **Zombie Brute** (zombie cages): huge and slow, hits hard, and winds up a ground slam that throws you back. Drops iron, a golden apple and sometimes a diamond
  - **Bone Archer** (skeleton cages): looses three-arrow volleys and kicks you back out to bow range. Drops a bow, arrows and often a diamond
  - **Brood Mother** (spider cages): hunts in any light and calls spiderlings each time she loses a quarter of her health. Drops string and diamonds
  - Bosses shrug off most knockback, scale with difficulty, never wake in Peaceful or for creative players, and stay beaten once beaten (the cage remembers). Leave one alive and it's waiting when you come back; `/summon zombiebrute`, `bonearcher` or `broodmother` to practise
- **Desert temples**: sandstone pyramids with corner towers; dig through the chiseled square in the hall floor to find a sealed vault of four treasure chests
- **Forest temples**: overgrown, crumbling two-storey ruins in forests and swamps, often with a spider spawner below and a sanctum up on the terrace
- **Shrines**: small pillared pavilions dotted across the land with an offering chest, built from local materials (sandstone in the desert, spruce in the snow)
- Structures keep their distance from each other, and trees grow around them rather than through them
- Shipwrecks full of cargo and crumbling ocean ruins on the sea floor, wells in the desert, and fossils buried deep beneath deserts and swamps
- Kelp forests and seagrass under the sea, lily pads on shallow swamp pools, snow blankets on the tundra, and lava pooling in the deepest caves
- Decoration follows the biome under every tree and flower: river banks are wooded and grassy, sugar cane lines any water's edge, and mossy boulders dot mountains and tundra
- Worlds remember their generator version, so terrain improvements only apply to new worlds and old ones never develop seams. Generator 10 (new worlds) samples every noise channel off its lattice (rivers no longer meet in a grid, and spawns differ from world to world), drops the last single-column biome specks, runs ore veins across chunk borders, adds flower meadows and bushes, keeps desert temples and wells from being crowded out, and clears the ground in front of every temple and shrine door; a new world never starts you inside a tree or on a speck of an island
- **Ores by depth**: coal, iron, gold, redstone, and diamond, each with its own distribution band
- Trees (oak, birch, spruce, and leaning **coconut palms** on warm beaches), cacti, sugar cane, flowers, tall grass, pumpkins, mushrooms — features generate seamlessly across chunk borders
- Chunks (16×128×16) stream in and out around the player; terrain generation runs in a **Web Worker pool** so the main thread never stutters

### 💡 Real voxel lighting
- Two-channel 0–15 light engine: **sky light** and **block light**, flood-filled with BFS across chunk borders
- Incremental relighting when any block is placed or broken — dig into a cave and darkness falls correctly
- Torches, glowstone, and lit furnaces cast light; the day/night cycle modulates sky light in the shader
- **Smooth lighting + per-vertex ambient occlusion** for that soft, grounded look

### ⛏️ Survival gameplay
- Break any block with correct per-block hardness, tool classes (pickaxe / axe / shovel / sword / spear) and five tool tiers (wood, stone, iron, gold, diamond) with durability (worn by real digging, not by crops, flowers or torches)
- Item drops with physics that magnetize toward you and merge into your inventory
- **Crafting**: 2×2 personal grid and a 3×3 crafting table, with shaped (including mirrored) and shapeless recipes — tools, torches, chests, beds, building blocks and more
- **Recipe book** beside every crafting grid: search and categories, shape previews, ghost layouts for recipes you can't make yet, and one-click grid filling
- **Campfire** (sticks, coal/charcoal, logs): cooks up to four foods at once (raw meat and fish, potatoes, eggs, kelp) with no fuel, glows, smokes, and burns anyone standing in it; shovel to put out, torch to relight
- **Cooking pot** (7 bricks): set it over a campfire (or a fire, lava or a lit furnace), fill it with a water bucket and put in two to four foods. It steams and bubbles for half a minute, then you ladle out three or four helpings with bowls: **beef stew**, **chicken soup** (heals too), **fish chowder**, **vegetable soup**, **pumpkin soup**, **coconut curry** and mushroom stew, or a **hearty stew** from anything else (odds and ends go less far: a helping fewer than went in). Hot meals keep the cold out for a couple of minutes (a note beside the hotbar counts down the warmth, and any venom), and an empty-handed look in the pot tells you what's cooking
- **Cake** (three milk buckets, two sugar, an egg and three wheat; the buckets come back): set it down to share and eat it a slice at a time, seven slices, when you're hungry
- **More food**: fry eggs, cook **crab**, roll **sushi** (raw fish and dried kelp), bake **apple pie**, and crack a coconut into a bowl for **coconut milk**, which settles scorpion venom like milk does
- **Smelting guide** beside the furnace that loads ingredients and the right amount of fuel in one click
- Inventory comforts: drag to split stacks across slots, double-click to gather a stack, shift-click quick moves
- Storage blocks (iron, gold, diamond, coal), paper → books → bookshelves, jack o'lanterns, bowls and mushroom stew, charcoal
- First-time **survival tips** that guide you from punching a tree to your first pickaxe, furnace, chest and bed
- **Furnace** with fuel + smelt time, live progress bars, and a lit block state that emits light: smelt iron, gold, glass, stone, bricks, and cook food. Coal and charcoal smelt 8 items, whale oil 16, and a lava bucket 100 (you keep the bucket); the furnace's guide lists every recipe and loads the input and fuel for you
- Health, hunger, saturation & exhaustion, drowning with an air meter, fall damage, starvation — plus food to eat. Well fed (a full bar with saturation to spare), you heal fast
- **Cold**: swimming in icy water chills you fast, and a night out on the snow slowly. Frost creeps in at the edges of the screen; chilled through, you stiffen up, and frozen, it hurts. A fire, torch or lantern close by warms you, as does the day, and each piece of leather armour keeps a fifth of the chill out
- **Chests** (27 slots) for storage; containers spill their contents when broken
- **Beds**: sleep through the night when no monsters are near, and respawn at your bed
- **Saplings** drop from leaves and grow into new trees (palm saplings take to sand); coconuts hang under palm fronds, a filling snack; dead bushes give a stick or two (the desert's only wood), and grass creeps back over bare dirt beside it
- **Farming**: tall grass drops seeds; till grass with a hoe (hoes also cut through leaves and hay), plant wheat on farmland (faster near water), bake bread, and speed things up with bone meal (which also grows grass and flowers). Sugar cane and cactus grow taller over time
- **Farm automation**: carrots and potatoes (rare from tall grass, zombies and chests) grow on farmland alongside wheat. Bake potatoes, and press nine wheat into a **hay bale**. A **sprinkler** (iron around a water bucket, which you get back empty) makes crops within 4 blocks grow about 3.5× faster. A **harvester** (iron, an iron hoe and a chest) reaps ripe crops within 4 blocks, replants them, and puts the harvest in a chest beside it (with no chest, the crops are left where they grew). A **collector** pulls dropped items within 4 blocks into a chest beside it, which suits egg and wool pens. A **composter** turns plants and food scraps into bone meal
- **Building shapes**: ladders you can climb, two-high oak doors and fence gates that open and shut, fences and glass panes that link up, stairs and slabs (oak, cobblestone, stone brick) you can walk up, and signs you can write on
- **Flint and steel** lights fires, TNT and campfires; a **fishing rod** lands fish (and the odd treasure) when the bobber ducks under; snowballs and eggs can be thrown (an egg may hatch a chick); worn tools mend when two are crafted together
- **Whale oil**: burns twice as long as coal, makes 6 torches with a stick, and fuels **lanterns** (iron, glass panes and oil) that stand on a block or hang beneath one
- **Buckets**: scoop up and pour water and lava (lava meeting water turns to obsidian) and milk cows. Water doesn't flow, but a hole dug beside or under it fills in, broken ice melts, dropped items float up, and TNT set off underwater breaks nothing
- **Fire**: lava sets you alight; jump in water (or drink milk) to put it out. Burning mobs show flames
- **Eating takes a moment**: hold use to eat or drink (you slow down while you do); dried kelp is a quick snack
- **Shears** (two iron ingots): shear sheep for 1–3 wool (the fleece grows back) and snip leaves, tall grass and dead bushes to collect them whole
- **Tools** show in their tooltip how fast they dig and, for pickaxes, which ores they can harvest: wood mines stone and coal, stone adds iron, iron adds gold, diamond and redstone, and only diamond takes obsidian. Gold is the fastest of all but only wood-strength, and wears out quickly
- **Weapons with weight**: every weapon recovers between swings (a meter under the crosshair shows it) and spamming only taps. Falling blows land **critical hits**, swords **sweep** mobs beside the target, axes hit hardest but slowest, and **spears** (all five materials) reach further and knock foes back
- **Ancient Blade**: a rare temple-only sword stronger than diamond; **golden apples** (crafted from gold and an apple, or found in temples) restore hunger and four hearts
- **Bow and arrows**: draw to charge, release to fire; arrows are crafted from flint (from gravel), sticks and feathers, and can be picked back up
- **Armour**: leather, iron, gold and diamond helmets, chestplates, leggings and boots, with an armour bar, damage reduction and wear; a chestplate shows on your arm in first person
- **TNT** from gunpowder and sand, lit with a torch — chain reactions included
- Dying drops your inventory where you fell (or keep it — chosen per world); a day counter tracks how long you've survived
- **Creative mode**: flight (double-tap space), instant breaking, a searchable item palette with categories, no damage

### 🐷 Mobs
- **Farm animals** by biome: pigs, sheep, cows (leather, beef) and chickens (feathers, chicken) wander, flee when hit and drop food. Sheep wear a woolly fleece (white, cream or light grey), graze, and bleat when shorn; animals cry out in their own voices when hurt, and the young ones squeak
- **Breeding**: feed two animals their favourite food (wheat for cows and sheep, seeds for chickens, apples for pigs) and they'll have a baby that grows up in a few minutes; animals you've fed are kept and saved with your world instead of wandering off
- **Goats, horses and ducks**: goats live high in the mountains; milk them with a bucket, but hit one (or linger) and it lowers its head and charges, and long drops don't hurt them. Horses roam the plains in herds, each with its own coat, speed and jump. Feed one and climb on with an empty hand: it throws you off until it trusts you. Then a **saddle** (5 leather and an iron ingot) lets you ride it. It goes where you look, gallops when you sprint, jumps fences, and you sneak to get off. Ducks paddle on rivers and swamps with their ducklings in tow, and drop feathers and duck meat to roast. Shorn sheep graze to grow their wool back
- **Pandas, sloths, capybaras and polar bears**: lazy pandas lounge about the forests, sitting down, rolling over and sneezing, and love sugar cane. Sloths creep through forests and swamps at a snail's pace and climb tree trunks to the canopy (falls don't bother them); they like apples. Capybaras gather in groups on river banks and in swamps and float placidly in the water (wheat or sugar cane). Polar bears roam the snow, sometimes with a cub: leave them be and they leave you be, but hit one or get close to a cub and it rears up and swipes. They swim well and eat raw fish
- **Camels, pelicans and seagulls**: camels wander the deserts. Feed one cactus or wheat and climb on until it trusts you, then saddle it: it carries you higher than a horse, slower but steadier, and the goat horn calls camels too. Pelicans stand about on warm beaches, float on the water and dip their pouched bills for fish (raw fish wins them over). Seagulls wheel over the sea, beaches and rivers in noisy flocks, gliding between wing beats. **Crabs** scuttle sideways over the beaches: they pinch back if you hit one, follow kelp, and cook up well (or go into a chowder or curry)
- **Herding**: farm animals follow you while you hold a food they like. A **lead** (string and leather) walks one home: use a fence post to tie it up, use the post again to take the lead back, and pull too hard and it snaps. A charging goat that slams into rock can knock off a **goat horn**, and blowing it brings your horses galloping
- **Animal husbandry**: pigs also eat carrots and potatoes. A **golden carrot** (four gold ingots around a carrot) puts any farm animal in love, or grows a baby up at once. Fill a **trough** with feed (a hay bale counts as nine wheat): it feeds babies that can reach it so they grow faster, and pairs up adults to breed on its own (until 16 of a kind crowd round it)
- **Your ranch**: a **name tag** (paper and string) names an animal: its name floats over it, it's yours for good, and you hear if it dies. Sneak and look at any animal for its card: who owns it, its age (and that it was bred on your ranch), health, whether it's ready to breed, and when its milk, wool or next egg is due. A cow or goat gives one bucket of milk every two minutes. The farm keeps time while you're away: crops and saplings in chunks you left carry on growing when you come back (up to about forty minutes' worth), and kept animals catch up too
- **Pens and happiness**: fence animals in (gates, troughs, walls and doors count, up to 33 blocks across) and the pen is their home: they're kept for good, and their card shows the pen and their mood. Animals are happy with room to roam (about ten blocks each), food (a stocked trough, grass to graze or a recent meal), water (a pond, or a trough you've poured a bucket of water into) and a roof over them at night or in the rain; monsters prowling nearby frighten them. A happy pen gives wool, eggs and milk half as fast again and its young grow up sooner; a cramped, hungry or thirsty one won't breed at all
- **Breeding for traits**: every farm animal has its own gifts, shown on its card: a cow's or goat's milk (how soon it's ready again), a hen's laying, a sheep's fleece (how much wool a shearing gives), a pig's litters (twins) and a goat's temper. Young take after one parent or land between the two, now and then better than either, so a herd improves as you breed the best. Watch for a rare black sheep or golden hen
- **Dyes and coloured wool**: poppies make red dye, dandelions yellow, brown mushrooms brown, coal or charcoal black, a cactus in the furnace green and bone meal white; mix red and yellow for orange, red and white for pink, black and white for grey. Dye wool, or dye a sheep and shear it for coloured wool. Lambs take after their parents' fleece (a red ewe and a white ram have pink lambs). Two wool of a colour make three carpets
- **The henhouse and the dairy**: a **nest** (five wheat) gathers the eggs: hens lay in one within a few blocks they can walk to, and so do your ducks, which lay duck eggs (they cook and bake like hens' eggs). Use the nest to collect them, or set a collector by it. Goats give **goat milk**, which heals as well as cures. A **butter churn** takes milk and, churned by hand, gives butter; a **cheese press** turns a bucket of milk into cheese in five minutes (it ripens while you're away too). Make **cheese sandwiches**, **buttered potatoes** and **pancakes**
- **Herding**: animals find their way round fences and through open gates to the food in your hand, the goat horn or the **shepherd's whistle** (an iron ingot and a stick). Blow the whistle and your animals in earshot come to you; sneak and blow it to send them home to their pens (leave the gate open). A dog of yours runs out to round up the stragglers. Put a lead on one animal and the rest of its herd follows it, and grazing herds stay together
- **Horse gear**: **horse armour** of leather, iron, gold, diamond or dragon scale (four of the material round a wool) turns some of the harm a horse takes, and dragon scale keeps it safe from fire and lava. Strap a chest onto a horse or camel for **saddlebags**: sneak and use it with an empty hand to open them, and shears cut them off. Sneaking with an empty hand on a horse without bags takes off its armour, then its saddle. Animals on your lead and the horse you're riding come through a portal with you
- **Rare finds**: diamonds, golden apples, golden carrots, the ancient sword and diamond gear glint with gold sparkles when dropped, and picking one up plays a chime and shows "Rare find!". Zombies sometimes drop a carrot, potato or iron ingot, and skeletons sometimes drop a worn bow
- Mobs jostle each other and get shoved aside instead of stacking up inside one another
- **Dolphins** play in the open ocean in pods: they swim over to you, leap from the waves and give swimmers near them a burst of speed (feed one a fish and it escorts you). Gentle **manatees** graze in warm rivers, swamps and shallow coasts, drifting up to breathe
- **Wildlife**: foxes (wary of people, hunt chickens), birds that flit between the treetops, fish in any water (they flop and suffocate on land) and whales in the deep ocean (they yield whale oil)
- **Pets**: tame dogs with bones and cats with raw fish. Pets follow you, sit on command, are saved with your world, and catch up if you leave them behind. Dogs fight monsters near you; creepers flee from cats
- **Zombies** spawn in darkness, chase you, hit hard, and burn in the morning sun
- **Skeletons** keep their distance and shoot arrows (and burn in daylight); they drop bones
- **Spiders** are fast and climb walls; they only hunt in the dark unless provoked, and drop string
- **Scorpions** scuttle over desert sand by day and night. They leave you alone unless you come close or hit one, then pinch and sting: the venom turns your hearts green and takes one every second and a half (it won't finish you off) and stops you healing until it wears off or you drink milk
- **Husks** stalk the desert unburnt by the sun, **drowned** rise from the water at night, and the odd fast **baby zombie** turns up
- **Creepers** sneak up, hiss and explode, blasting holes in the terrain; they drop gunpowder
- Monsters need to see you (they remember you for a few seconds round a corner), ignore creative players, knock you back when they hit, work their way around walls, haunt dark caves at any hour, and groan, rattle or hiss as they approach
- **Difficulty** per world — Peaceful, Easy, Normal or Hard — changeable any time with `/difficulty`
- Original box-model creatures with walk animations, knockback, fall damage, and voxel-light-aware shading

### 🔥 The Scorchlands
A second dimension, under a night that never ends: a burnt forest of charred trees and smouldering stumps on rolling ash hills, open ash wastes with lava lakes and spires of charred stone, embers drifting up and ash sifting down under a huge red moon.
- **Getting there**: each kind of dungeon guardian (Zombie Brute, Bone Archer, Brood Mother) drops its own ember and some **charred stone**. The three embers, a diamond and redstone make an **Ember Core**. Build a ring of charred stone 4 wide and 5 tall (the corners are optional) and use the core on it: the opening fills with a glowing portal. Stand in it for a couple of seconds to cross
- **8:1**: a block in the Scorchlands is eight at home. Going through comes out at the portal on the other side nearest the matching point, or builds one there (on a platform if you'd land over lava or water). Break any part of a frame and its portal goes out. Pets following close by come with you
- Its rules: no beds, water boils away, and dying there sends you home to your spawn point
- **Skeleton knights** carry a sword and a shield that turns blows and arrows from the front; it drops while they swing, and enough battering knocks it aside
- **Ruined castles**: a broken curtain wall with a gate and corner towers round a keep, holding a knight cage, two chests of loot and the **Knight Captain**, a boss that charges across the room
- **Ash drakes** circle overhead and spit fireballs that set you alight (fire there never harms a block)
- **The Scorch Dragon** roosts on a mesa crowned with smouldering spires (your first arrival says which way). It wheels round its roost loosing fire and dives at you; hurt to half, it calls its drakes and comes down low to breathe fire. It's back the next time you come
- **Spoils**: dragon scales (from the dragon, and now and then a drake) make **dragon scale armour**, as strong as diamond and turning a fifth of fire and lava damage per piece; the dragon's fang, a scale and a stick make the **Ember Blade**, which sets what it strikes alight. Castles and spires give **scorched bricks** and charred stone to build with
- **Pets of the Scorchlands**: **cinder hounds** roam the burnt forest in ones and twos. Tame one with bones: fire and lava can't hurt it, it guards you like a dog, and its bite sets monsters alight. The dragon (and, rarely, an ash drake) leaves a **drake egg**: set it down and an **ember whelp** hatches, a little drake that flies at your shoulder and spits fire at monsters. Both follow you through portals
- `/dimension scorchlands` (and `overworld`) to go straight there

### 🌗 Living environment
- **Weather**: showers come and go: rain (snow where it's cold, nothing over the desert) greys the sky, closes in the fog and drums on the roof; it puts out fires and anyone burning out in the open, keeps the undead from burning and the farmland wet. `/weather clear|rain`
- Sand and gravel fall when nothing holds them up; leaves cut off from their trunk wither (dropping saplings and apples); chips fly off blocks as you dig; hay, wool and beds break a fall
- Full **day/night cycle** (20 min): a gradient sky dome that glows on the sun's side at sunrise and sunset, a sun and a moon, drifting blocky clouds that take the colour of the hour, and a starfield that wheels overhead at night
- Torchlight is warm and moonlight cool; mobs, dropped items, arrows, sign lettering and your hand are all lit by the voxel light where they stand, so nothing glows in a dark cave
- Distance fog that follows your render-distance setting and blends terrain, mobs and items into the horizon; underwater the sky disappears, the view tints blue, darkens with depth and at night, and bubbles rise from you

### 🖥️ Complete game shell
- Main menu with **multiple worlds**: create (name + text/number seed + game mode), play, rename, delete
- **Saving is automatic** (IndexedDB) every 10 seconds, when the tab is hidden and on quit: changed chunks, chests, furnaces, campfires and cooking pots, growing crops, player state and inventory (even what's on the cursor), pets and kept animals, items on the ground, and the time of day. Each save is a single transaction, so a crash can't leave a chest and your inventory out of step; a failed save is retried and reported
- A world can only be open in one tab at a time (two copies would save over each other); damaged chunks are regenerated rather than crashing the world, and the browser is asked to keep the saves even when space runs low
- Pause menu with a controls cheat sheet, settings (render distance, FOV, resolution (Auto lowers it while frames are slow and restores it when there's headroom), frame rate limit, brightness, master + per-category volume, view bobbing, crosshair style, GUI scale, FPS counter, fullscreen, mouse sensitivity, invert Y, rebindable keys — applied live), death screen, loading screen
- World list with search, sorting, duplicate, export/import (a .json file you can back up or share) and copy-seed; chat with Tab completion and `/summon`
- **Gamepad** and **touch** controls, both covering gameplay, menus and inventories; inventories also work from the keyboard alone, with named slots for screen readers
- HUD: hotbar with icons & durability bars, pixel-art hearts / hunger / air bubbles, crosshair, block-break cracks and selection outline, damage and low-health vignette
- First-person held item (or a bare, sleeved arm) with walk bob, swing and equip animations, lit by the surrounding light; flat items have a pixel of depth, food comes up to your mouth with a bite in step with each chew (and crumbs), and drinks tip up
- **F3 debug overlay**: FPS, position, chunk, biome, light levels, draw calls, triangle count
- **Chat & command console**: `/tp`, `/time set`, `/give`, `/gamemode`, `/seed`, `/heal`, `/rd`, and more

### 🎨 100% procedural assets
- Every block, item, and tool texture is **pixel art drawn by code** into a texture array at startup (mipmap-safe, no bleeding)
- Inventory icons are rendered as tiny isometric cubes from the same tiles
- All sound effects — digging, footsteps per material, hurt (by cause), eating, doors, chests, splashes, UI clicks — are **synthesized live with WebAudio**. The game loads no image or sound files at all.
- Sounds are positional: they fade with distance and pan left/right; a limiter keeps a burst of explosions from clipping, and repeated sounds are throttled. Ambience: fires crackle, lava pops, caves drone, crickets sing on clear nights, and your heart pounds at low health. Audio pauses in a background tab.
- **Music**: now and then a short generative piece drifts in — a soft pad and a wandering pentatonic melody through a long echo; brighter by day, darker at night, low and sparse in caves, and it fades out for boss fights (own volume slider)
- Caves echo; your own block sounds (breaking, placing, doors, buckets) come from the block you're working on; flint and steel, shears, arrows landing, drawing a bow, dropping items, swimming strokes and lava buckets all have their own sounds

---

## Controls

| Input | Action |
| --- | --- |
| **W A S D** | Move |
| **Mouse** | Look |
| **Left click** | Mine block / attack |
| **Right click** | Place block / use (crafting table, furnace) / eat |
| **Space** | Jump / swim up (double-tap in creative: toggle flight) |
| **Ctrl** (either side) / double-tap **W** | Sprint (underwater: swim fast where you look) |
| **Shift** (either side) | Sneak (you won't fall off edges) / fly down / dive |
| **1–9 / mouse wheel** | Select hotbar slot |
| **E** | Inventory (creative: item palette) |
| **Q** | Drop held item (Ctrl+Q: whole stack) |
| **Middle click** / **R** | Pick block |
| **T** or **/** | Chat / command console |
| **F1** | Hide HUD |
| **F2** | Save a screenshot |
| **F3** | Debug overlay |
| **Esc** | Pause |

All keys can be rebound in **Settings → Controls**. **Gamepads** and **touch screens** are supported too (menus and inventories included). Full details in [docs/CONTROLS.md](docs/CONTROLS.md).

## Commands

```
/help                       list commands
/tp <x> <y> <z>             teleport
/time set <day|noon|sunset|night|midnight|0..1>
/give <item> [count]        e.g. /give diamond_pickaxe
/summon <mob>               e.g. /summon camel
/gamemode <survival|creative>
/difficulty <peaceful|easy|normal|hard>
/seed  /spawn  /kill  /heal  /clear
/rd <2-16>                  render distance
/dimension <overworld|scorchlands>
```

---

## Browser support

BlockVerse runs in any current desktop or mobile browser with **WebGL 2**: Chrome, Edge, Firefox and Safari (15.4+), including on Chromebooks, Android phones, iPhones and iPads. If the page says WebGL 2 is missing, turn on hardware acceleration in the browser's settings. Worlds are kept in the browser's IndexedDB storage, so private/incognito windows may not be able to save; use **Export** on the world list to back a world up to a file.

On phones and tablets you can use the browser's **Add to Home Screen** to launch BlockVerse full screen like an app.

> **Back up worlds you care about.** Browsers can clear a site's storage: Safari (on iPhone, iPad and Mac) deletes it for sites you haven't opened in about a week, and a home-screen app on iOS keeps its worlds separately from the same site in a Safari tab. **Export** a world now and then (it downloads one small file) and **Import** it to bring it back.

## Running locally

Requirements: Node.js 20.19+ or 22.12+.

```bash
git clone https://github.com/awest813/blockverse.git
cd blockverse
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # production build into dist/
npm run preview   # serve the production build
```

## Deploying to GitHub Pages

The `main` branch auto-deploys to GitHub Pages via [GitHub Actions](.github/workflows/deploy.yml); pull requests get a build check without deploying.

To host your own copy from a fork:

1. Fork the repository.
2. In the fork, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow from the **Actions** tab). The game is published at `https://<your-user>.github.io/<repo-name>/`.

The build uses relative paths, so it works under any repository name or a custom domain without changes. The only hard-coded addresses are the link-preview tags (`og:url`, `og:image`) in `index.html`; point them at your own site if you want link previews to use it.

## Architecture

```
src/
├── main.js            app shell: menus <-> game lifecycle
├── game.js            Game: loop, camera, day cycle, input wiring, saving
├── core/              constants, seeded RNG, gradient noise, input, AABB physics
├── blocks/            block registry (hardness, tools, drops, light, render kind)
├── items/             item registry, crafting recipes, smelting, furnace logic
├── world/             chunks, streaming world, worker pool, worldgen (and the
│                      Scorchlands' scorchgen), dimensions, portals, lighting, raycast
├── workers/           terrain-generation web worker
├── render/            procedural textures, texture-array atlas, chunk mesher (AO +
│                      smooth light), GLSL3 chunk materials, sky, block highlight
├── player/            player physics/stats/inventory, block interaction
├── entities/          item drops, animals, monsters, bosses, projectiles, AI, spawners
├── ui/                HUD, container screens, chat/commands, menu screens
├── audio/             WebAudio sound synthesis
└── save/              IndexedDB world/chunk/player persistence, settings, one-tab world lock
```

Key design points (full write-up in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

- **Chunks** store blocks as flat `Uint16Array`s with column-contiguous layout; meshes rebuild incrementally with a per-frame time budget, nearest-first.
- **Terrain workers**: a pool of Web Workers generates raw chunk data off-thread and transfers it back zero-copy. Decorations that cross chunk borders (trees) are re-derived deterministically by every chunk they touch, so there are no seams.
- **Lighting** is the classic two-queue BFS: light removal enqueues re-fill sources; skylight propagates downward loss-free at level 15. All updates cross chunk borders.
- **Meshing** emits per-vertex sky/block light with ambient-occlusion, flipping quad diagonals to avoid AO anisotropy; leaves/glass render alpha-tested in the opaque pass, water alpha-blends with a lowered surface.
- **Textures** live in a `DataArrayTexture` (one layer per tile), which makes mipmapping safe — no atlas bleeding at distance.
- **Saves**: only chunks you actually modified are written; everything else regenerates from the seed.

## Performance notes

- Render distance is configurable (2–16 chunks). The default 8 gives ~300–600 draw calls and a few hundred thousand triangles depending on terrain.
- Heavy work (generation) is off-thread; lighting and meshing are time-sliced on the main thread with a per-frame budget.
- If the tab is hidden, a worker-driven ticker keeps furnaces smelting and crops growing (browsers throttle hidden-tab timers); you, the mobs and the clock wait, so nothing can happen to you behind the pause menu.

## Roadmap

Ideas that would fit the engine as it stands:

- Flowing water & lava simulation
- Redstone-style logic circuits
- More structures (villages, strongholds) via the deterministic feature system
- Multiplayer over WebRTC
- Height-4096 worlds with cubic chunks

Contributions are welcome — the codebase is dependency-light (three.js + Vite only) and every module is documented.

## License & IP

- Code: [MIT](LICENSE).
- All textures, models, and sounds are procedurally generated originals created for this project, and are covered by the same MIT license.
- BlockVerse is an original work inspired by the voxel-sandbox genre. It is **not** affiliated with, endorsed by, or connected to Mojang, Microsoft, or *Minecraft*. No assets, code, or other material from *Minecraft* are used.

## Chromebooks and low-end laptops

- **Auto resolution** starts at 1× on machines with few cores or little memory and adapts to the frame rate; a 30 FPS limit saves battery
- First run on such a machine uses a render distance of 6
- Two-finger touchpad scrolling steps the hotbar smoothly (a mouse wheel notch is still one slot)
- **Pick block** has a key (R) as well as middle click; screenshot, debug and hide-HUD are rebindable, since F-keys need Search + the top row
- The top-row Back / Forward keys don't navigate away mid-game; the Search key can't be bound (it opens the launcher)

