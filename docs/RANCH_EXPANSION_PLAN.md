# Ranch expansion: plan

A plan for turning BlockVerse's animals and farming from "things you can do"
into a ranch you build, run and grow. It builds on what's there (feeding,
breeding, leads, troughs, harvesters, horses and camels, pets, the kept-animal
stash) and on an audit of the current mechanics (fixed: pens keep their
animals, hazard-aware herding, fence-proof breeding, foal inheritance, trough
coverage, sleep catch-up).

## Goals

- **Your animals are yours.** Nothing you've penned, named or bred vanishes,
  wanders off for good or forgets who it belongs to, in either dimension.
- **A ranch is a place.** Pens, barns, stables and coops are recognised, and
  animals know where home is.
- **Animals are individuals.** Traits are inherited, visible and worth
  breeding for.
- **Products have depth and a use.** Milk, eggs, wool, leather and the rest
  feed into cooking, crafting and trade, not just a stack in a chest.
- **The farm keeps running.** Growth and production carry on while you're
  away or asleep, within limits, so a ranch rewards planning rather than
  standing guard.
- **It stays light.** It must run on a Chromebook, so it relies on the stash,
  timestamps and catch-up, not on simulating hundreds of animals each frame.

## Phase 1: foundations (persistence, time, identity)

*Done:* the world clock (`core/clock.js`, saved as `worldMeta.clock`, chunks stamped with the clock when saved and caught up on load), stable animal ids, `born` and `parents`, name tags with floating names, the sneak inspect card (`entities/inspect.js`) and the milk cooldown. Ownership stays the `persistent` flag, which every route above already sets.

1. **Ranch ownership model** (`entities/mob.js`, `entityManager.js`)
   - Replace `persistent` with `owner: 'player' | null` plus `home: {x,y,z}`, set by:
     - feeding, milking, shearing, a lead, a name tag;
     - being born to owned parents;
     - being inside a pen (see 2).
   - Owned animals never despawn: they are stashed and saved like kept animals today.
   - Wild animals behave as now.
   - Migrate old saves: `persistent: true` becomes `owner: 'player'`.
2. **Pens and buildings** (new `world/ranch.js`)
   - When an animal is stashed or a fence changes, flood-fill (bounded at 32×32) from its cell to decide whether it's enclosed by fences, gates and walls.
   - Record the enclosure on the animal as `home`, together with a cheap hash of the enclosure.
   - A roofed enclosure counts as a barn or coop, which gives shelter (Phase 3).
3. **World-time clock** (`game.js`)
   - Keep `worldMeta.clock` in seconds of game time, advanced while playing and by sleep.
   - Store absolute deadlines in timers (`growAt`, `eggAt`, `woolAt`, `milkAt`, `breedAt`) instead of countdowns.
   - On chunk load or unstash, apply `clock - lastSeen`, capped at 2 in-game days, to crops, saplings, furnaces, babies and products.
   - This fixes growth while away, eggs piling up, and stash freeze.
4. **Name tags** (item: paper + string)
   - Name an animal: the name shows on hover and in notices ("Bessie had a calf").
   - A named animal is owned.
5. **Inspect** (sneak + use with an empty hand)
   - A card showing species, age, owner, health, breeding cooldown, traits, product timers and mood.

### Step 2 (done)

Pens (`world/ranch.js`): a bounded flood fill over the ground an animal can walk, hemmed in by fences, closed gates, walls, troughs, closed doors and drops of more than three blocks, and needing something built on its edge. Pens are cached for ten seconds and dropped on any nearby edit. A penned animal is kept and gets a `home`. Mood (saved) comes from room per animal, food, water (a pond or a water trough: a trough with a bucket of water in it), shelter at night or in rain, and monsters nearby. It scales wool regrowth, egg laying, the milk cooldown and babies' growth, and stops breeding below 25.

## Phase 2: breeding and genetics

1. **Traits per species** (in `saveExtra`/`loadExtra`)
   - Horses: gallop, jump, health, coat, markings.
   - Sheep: wool colour, fleece yield.
   - Cows: milk yield.
   - Chickens: laying rate.
   - Pigs: litter size.
   - Goats: horn shape, temperament.
   - Ducks: plumage.
2. **Inheritance** (generalise `inherit` from `Horse`)
   - Each trait comes from one parent or the mean of both, plus a small mutation.
   - Rare mutations give visible variants: piebald horses, black sheep, golden hens.
3. **Breeding feedback**
   - Hearts and an "in love" timer on the inspect card.
   - A "bred" ledger entry, with a family tree of two generations on the card.
4. **Wool colours and dyes**
   - Dyes from flowers (poppy is red, dandelion yellow), plus new flowers by biome.
   - Dyed sheep pass their colour on.
   - Coloured wool and carpet blocks (the tint is procedural, so cheap).

### Step 3 (done)

Traits (`entities/traits.js`): milk (cows, goats), temper (goats), laying (chickens), fleece (sheep), litter (pigs). They are rolled once, saved and clamped on load, inherited from one parent or the mean of both, plus a little mutation and a rare standout. Horses keep their own. Rare variants: black sheep and golden hens. Dyes and colours (`items/dyes.js`): nine colours, eight dye items, eight coloured wools and nine carpets. A sheep can be dyed, shears to its colour, and its lambs blend their parents' fleece. The card lists traits and named parents. Still to do: new flowers by biome (a generator change, so it must be gated by version), piebald horses.

## Phase 3: needs, welfare and production

1. **Hunger and happiness** (cheap, ticked by the clock on unstash too)
   - Animals near a stocked trough or grass stay fed. Hungry animals don't breed and produce less.
   - Happiness rises with space (pen area per animal), shelter at night or in rain, and a water block within reach of the pen.
   - It falls with crowding, mud, monsters nearby and lightning.
2. **Products** (block entities or animal timers)
   - **Milk**: a cooldown per cow or goat (`milkAt`). Goat milk is a separate item and cures more.
   - **Eggs**: hens lay in a nest block inside a coop (collected there) instead of dropping eggs anywhere. Duck eggs come from ducks.
   - **Wool**: regrowth depends on happiness; dyed fleece.
   - **Leather**: hide grade depends on age and care; better leather makes better armour and saddles.
   - **Honey**: beehives and bees (new). Bees pollinate crops for a growth bonus; honey and wax are used in cooking and candles.
3. **Dairy and the kitchen** (`items/cookingPot.js` recipes)
   - Churn: milk becomes butter or cream.
   - Cheese press: milk, then time, then cheese (an aged block entity).
   - Use them in new pot recipes and cake variants.

### Step 4 (done)

`world/produce.js` adds the nest (`{eggs, duck}`, meta shows eggs), the churn (`{milk, work}`, six turns a bucket for two butter) and the press (`{batches: [readyAt]}` on the world clock, so it catches up for free). Hens, and kept duck hens, lay into the nearest nest they can walk to within 6 blocks; collectors empty nests. Goat milk is its own item (it heals 4). New food: cheese, cheese sandwich, buttered potato, pancakes. Eggs and milk accept either kind in recipes. Still to do: hide grade and better leather.

## Phase 4: ranch tools and automation

- **Feed and water.** Trough variants: a water trough, which counts for happiness and lets troughs breed animals, and a feed bin that pulls feed from a chest behind it.
- **Collection.**
  - An egg collector under nests.
  - An auto-shearer next to a sheep pen.
  - A milking stall with a milk tank that bottles into buckets.
- **Herding.**
  - A shepherd dog command (whistle item): gather the herd to you, drive them into the pen, or stay.
  - Herds follow a leader animal, so a lead on the leader brings the flock.
- **Stables.**
  - A stable block sets a horse's home; the goat horn or a whistle calls it.
  - Horse armour (leather, iron, gold, diamond, dragon scale).
  - Saddlebags (a chest on a horse or camel); pack animals carry goods between ranch and market.
- **Gates that herds use.** Animals path through an open gate toward home or the trough. This needs pathing (Phase 5).

## Phase 5: movement and pathing

- **Pathfinding.** A small grid A* (16-block radius, at most 200 nodes) on the animal's own floor. Used for tempt, follow, called and returning home. Hazard-aware: no lava, no long drops (the hazard check in `mob.js` already gives the cost).
- **Herd behaviour.**
  - Boids-lite: cohesion toward the herd centre, separation, and the leader's heading.
  - Run it at a reduced rate (every 4th frame) for animals more than 16 blocks away.
- **Leads and portals.**
  - Led animals and a ridden horse come through a portal with you (`swapDimension` already moves pets).
  - Owned animals never get stranded in the wrong dimension: the stash is per dimension.

### Step 5 (done)

`world/pathing.js`: A* over the pen walker's step rules, within 16 blocks and 200 nodes, three searches a frame. `Mob.goTo` walks straight while the way is clear, otherwise follows a path, re-planned every 3 s or when the goal moves. It's used by tempting, the horn, the whistle (come, or sneak for home), herd leaders (owned animals follow a led one of their kind) and the sheepdog (a tamed dog runs out behind the farthest stragglers). Wandering herds drift back toward their centre.

### Step 6 (done)

Horse armour (five materials, cutting 12–44% of damage; dragon scale makes the horse fireproof) shows as barding. Saddlebags (18 slots, a chest on a horse or camel) open in the chest window via `containers.openBags`. Both are saved in `saveExtra` and dropped on death. Led animals and the ridden mount are marked `travel` like pets, moved by `swapDimension`, and placed in front of the arrival portal by `Game.landAnimals`. Still to do: a stable block (pens already give horses a home).

### Step 7 (done)

Beehives (`hive {bees, honey, work, at}` in `world/produce.js`) gain bees by day when there are two or more flowers within 5 blocks. Honey comes from bee-seconds of world clock, so it catches up after being unloaded. Bees are cosmetic fliers (`entities/bees.js`), not saved. Crops within 4 blocks of a hive with bees grow 1.3 times as fast. New crops: beetroot (seeds from tall grass), pumpkin stems (a fruiting family that sets pumpkins beside them, which harvesters pick), and Scorch peppers (from charred leaves, plantable only in the Scorchlands, where ash can be hoed). New food: beetroot soup, spicy stew (`wards`: half fire damage), honey and honey bread. Still to do: berries and rice (they need a gated generator), melons, honeycomb and candles.

## Phase 6: economy

- **A market**: a trader cart that visits the spawn village or your ranch sign weekly and buys products at prices that drift with supply. A village with villagers can replace it later.
- **A ranch ledger**: a book item listing every owned animal (species, name, where it was last seen, dimension), production totals, and money earned.
- **Ribbons and fairs** (optional): a weekly fair scores your best horse, sheep and cow by traits for prizes such as rare dyes, saddles and seeds.

## Farming depth (runs alongside the phases)

- **Farmland moisture.** Dry farmland grows slowly; wet farmland, watered by a water block, sprinkler or rain, grows faster. Trampling and drying are already in.
- **Light.** Crops need light level 9 or more to grow, which makes torches and glowstone part of greenhouse design.
- **New crops.**
  - Pumpkin and melon stems.
  - Beetroot (soup and dye).
  - Cocoa on jungle-ish trees.
  - Berries as bushes in snowy forests.
  - Rice in shallow water.
  - Scorch peppers, which grow only in the Scorchlands (a ranch reason to go there; a spicy stew warms you and gives fire protection).
- **Seasons** (optional, behind a world setting): crops prefer seasons; snow in winter in temperate biomes.
- **Crop quality.** Care (water, fertiliser such as bone meal or compost, light) raises the chance of a "fine" harvest worth more at market.
- **Watering can** for early game before sprinklers.

## The Scorchlands' ranch

- **Cinder hounds** (done) breed with cooked meat and guard Scorchlands outposts.
- **Ember whelps** (done) grow into rideable drakes after a long time and a lot of feeding. That gives flight in the Scorchlands only, with a fuel of charcoal.
- **Ash goats**: a hardy Scorchlands goat whose milk resists fire.
- **Scorch peppers** (above).

## Data and save format

- **Animals**: `worldMeta.animals` (and `dims[*].animals`) entries get:
  - `owner`
  - `name`
  - `home`
  - `traits {...}`
  - deadlines (`growAt`, `breedAt`, `woolAt`, `eggAt`, `milkAt`)
  - `born` (clock)
  - `parents` (ids)
- Every animal gets a stable `id` (a random base36 string) for the ledger and family trees.
- **New block entities**: `nest {eggs}`, `churn {milk, t}`, `press {milk, t}`, `hive {bees, honey}`, `stall {milk}`, `bin {slots}`.
- **Migration**: old entries load with defaults (`owner: 'player'` when `persistent`, traits rolled once and then saved).
- **Import sanitisation**: names (string, at most 24 characters), traits (finite numbers within each species' range), deadlines (finite).

## Performance budget

- Animals in the stash cost nothing per frame. On unstash, apply clock catch-up in O(1) per animal.
- Pen detection runs only on stash, on fence edits nearby, or once a minute per loaded pen, bounded at 32×32.
- Pathing is limited to a few animals per frame (a round-robin queue), at most 200 nodes each.
- Herd steering runs at a reduced rate beyond 16 blocks.
- Target: 150 owned animals in loaded chunks at a steady 60 fps on a mid laptop and 30 fps on a Chromebook.

## Order of work (each step shippable)

1. Ownership, name tags, the inspect card, the world clock and catch-up. This is the base for everything else.
2. Pens and homes, the water trough, and happiness basics.
3. Traits and inheritance for all species, sheep colours, and dyes.
4. Products: nests and egg collection, milk cooldowns, the churn and press, dairy recipes.
5. Pathing and herding (whistle, dog, leader).
6. Stables, horse armour, saddlebags, and led animals and mounts through portals.
7. Bees and honey, and new crops (stems, beetroot, berries, rice, Scorch peppers).
8. The market and ledger, then fairs.

Each step includes a playtest with the scripted playthrough harness, extended with ranch goals (start a pen, breed three generations, run a dairy, sell at market), and an audit pass.
