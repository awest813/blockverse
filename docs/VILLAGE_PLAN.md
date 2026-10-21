# NPC villages: plan

A plan for villages: places in the world with houses, fields, a square and
people who live there, work, trade and remember you. Villages build on what
the game already has:

- the deterministic structure planner (`world/structures.js`);
- generator versioning (`LATEST_GEN`, the byte-identical checks for
  generators 1–10);
- the world clock and catch-up (`core/clock.js`);
- pens and pathing (`world/ranch.js`, `world/pathing.js`);
- the travelling trader's NPC, visit record and trade panel
  (`entities/trader.js`, `ui/ranchPanel.js`);
- coins and the market's prices (`world/market.js`);
- the kept-animal stash (`entities/entityManager.js`).

The gap list has "Villages, villagers and trading" open, and the ranch plan
names a village as the market's eventual home.

## Goals

- **A village is a place you find.** It sits naturally in its biome (oak in
  the plains, spruce in the snow, sandstone in the desert, birch in the
  birch woods, stilts by the shore), has a name, and is worth walking to.
- **Villagers are people, not vending machines.** Each has a name, a home,
  a job and a day: up at dawn, at work, in the square at noon, home at dusk.
- **Trade has depth.** Each trade connects to the ranch and to cooking:
  villagers buy what you grow and make, and sell what you can't easily get.
  Prices follow supply and how the village feels about you.
- **The village remembers.** Your standing, deals, deaths, helped requests
  and new residents persist, in both directions.
- **It stays light.** Villagers far away cost nothing: like stashed
  animals, they are records with timestamps, not simulated bodies.
- **Worlds stay safe.** Generators 1–11 stay byte-identical. Villages arrive
  with generator 12, so old worlds keep their terrain and only new worlds
  (or new chunks in a world on generator 12) get them.

## The hard part: structures bigger than a chunk

Every structure before villages (temples, wells, shrines, dungeons) fits
inside one 16×16 chunk and is built when that chunk is generated. A village is about 64–112 blocks across, spanning 4–7
chunks a side. The way through already exists for trees: a feature's world
position is known from the seed alone, and each chunk builds only the part
of it inside its own bounds. Villages work the same way, one level up.

1. **Region grid.** Split the world into 24×24-chunk regions (384 blocks).
   - Each region has at most one village candidate: a deterministic spot
     from `coordRng(seed, rx, rz, VILLAGE_SALT)`, kept at least 6 chunks in
     from the region's edge so neighbouring villages never touch.
   - Expect about one village per 2–3 regions after siting fails, so a
     village is roughly every 600–900 blocks. That's a good walk without
     being rare.
2. **Siting.** A pure function of the seed, cached like `structurePlan`.
   - Use `gen.columnAt` and `biomeOf` to sample a 9×9 grid of heights and
     biomes around the candidate.
   - It needs:
     - a village biome (plains, forest, birch forest, desert, snowy tundra,
       snowy forest, or a beach next to land);
     - a spread of at most 6 blocks over the core;
     - no water over most of the core;
     - no mountains.
   - The result is a style (by biome) and a base height.
3. **Layout (the "site plan").** Also pure and cached. Each village's plan is
   a list of pieces with world-space boxes: roads, plots and props.
   - **The square:** a well or fountain, a market stall, a bell post and
     lanterns.
   - **Roads:** two to four main roads leaving the square, bending a little
     with the terrain, with side lanes.
   - **Plots:** placed along the roads, each with a building template chosen
     from a weighted list by the village's size and style, rotated to face
     the road.
   - **Terrain:** each plot has one floor height, the median of its corner
     heights.
     - Foundation blocks fill down to the ground, at most 4 blocks; a plot
       that would need more is dropped.
     - Up to 6 blocks of air are cleared above, trimming hillsides.
   - Roads follow the ground. A step of more than one block becomes a short
     stair, and a road leg that needs more is dropped.
4. **Building it.** Generation calls `buildVillageSlice(gen, blocks, cx,
   cz, holder)`.
   - It looks up the village (if any) whose bounds overlap this chunk, then
     builds every piece clipped to the chunk, much as `applyFeature` clips a
     tree.
   - Block entities (chests, pots, beds) are returned as `[index, entity]`
     pairs, as `buildStructure` does today, and only the chunk that holds
     the block makes its entity.
   - The order is the same in every chunk (terrain, then roads, then
     buildings, then props), so a building cut by a chunk border joins up
     exactly.
5. **Keeping clear.**
   - `nearStructure` grows a village check, so trees, plants and fossils
     don't grow on roads or in houses.
   - Single-chunk structures (temples, wells, shrines) within a village's
     bounds stand down; the village wins.
   - Caves under a village are still carved, but foundations fill any
     opening right under a building.
6. **Cost.** Planning one village is a few hundred `columnAt` calls,
   cached per generator (the worker pool has one per thread). Building a
   chunk's slice is a loop over at most about 12 pieces. The goal is
   under 1 ms extra per village chunk in the worker.

### New blocks

These are kept few, and most double as decoration for players:

- **Path block:** a slightly sunken, trodden grass or dirt. Shovels make it
  from grass.
- **Bell:** rings to call villagers to the square, and at a raid (Phase 5).
  It is used as decoration and as a meeting point.
- **Lectern:** the librarian's workstation. It holds a book, and later a
  map of the area.
- **Barrel:** storage (a chest that sits as a block), and the fisher's
  workstation.
- **Smoker / bakery oven:** a small brick oven that cooks food twice as
  fast as a furnace but nothing else. It is the cook's workstation.
- **Wattle wall and thatch** (style blocks for plains houses), **painted
  planks** (from dyes), **sandstone steps**, and **lanterns on posts**
  (a shape of the existing lantern).

Existing blocks do the rest: beds, doors, glass panes, fences and gates,
slabs and stairs, hay bales, the composter, cooking pot, churn, cheese press,
beehive, market stall, furnace, bookshelves, signs and farmland with water.

## Phase 1: villages in the world (no people yet)

1. **The framework above:** region grid, siting, site plan, clipped
   building, and keep-clear. Generator 12 only; add a `cmp11` check that
   generator 11 stays byte-identical.
2. **Templates:** about 10 per style, written as compact layers (a string
   per row and a legend), so a style can swap its materials:
   - small house (1 bed), family house (2–3 beds), farmhouse with a field;
   - smithy (furnace and a chest of loot);
   - bakery or kitchen (cooking pot over a campfire, oven);
   - library (bookshelves, lectern);
   - dairy (churn, cheese press, a pen);
   - apiary (beehives and flowers);
   - fisher's hut (barrel, on the shore when there is one);
   - stable (hay, troughs);
   - a meeting hall in bigger villages.
3. **Fields and pens:**
   - Fields are tilled and watered strips of wheat, carrots, potatoes or
     beetroot (rice by water), planted at random growth stages.
   - Pens hold a few animals that belong to the village (`owner: 'village:<id>'`).
     They're kept like your own but aren't yours: leading one away is theft
     (Phase 4).
4. **Loot:** a chest in the smithy and some houses, with small, practical
   loot that suits the style (bread, seeds, iron, a saddle now and then).
   The village's chests are marked as the village's.
5. **Names and discovery:**
   - Each village has a generated name ("Ashford", "Pinecombe",
     "Sandwell"), built from style-based syllables and the seed.
   - Walking into one shows "Entering Ashford" over the hotbar.
   - A `/locate village` chat command (creative and cheats only) points to
     the nearest one.
6. **Spawn:** a new world on generator 12 prefers a spawn point within
   about 200 blocks of a village when one is close enough. It never
   insists.

### Step 1 (done)

Generator 12 (`world/villages.js`):
- Regions are 24 chunks a side, and 70% of them try for a village. About 19% end up with one, roughly one every 870 blocks.
- Siting and the layout come from the seed alone: the square, two to four roads, and plots on alternate sides of each road, each with an odd width, a door facing the road, a step out to it and a levelled floor.
- Each chunk builds its slice column by column.
- Orientations (doors, stairs) come out of generation in a new `meta` array.
- There are four styles (oak, birch, spruce, sand) and seven buildings (house, family house, smithy, kitchen, library, farm, stable). Each village has a name, and an "Entering …" banner shows as you walk in.
- Shovels make dirt paths.
- Checks:
  - generators 1–11 are byte-identical (`cmp9`, `cmp10`, `cmp11`);
  - village chunks match across three load orders (140/140);
  - planning costs 0.2 ms a region, and generating a village chunk about 5.7 ms in Node.

Also done:
- the spawn nudge: a new world with a village within 300 blocks starts about 30 blocks outside it;
- no surface monster spawns inside a village's footprint, a little earlier than Phase 5.

Fixed in generator 13 (generator 12 villages are left as they were, so
existing worlds don't grow seams): a road stops at a drop or rise of more
than two blocks instead of running out over it; a plot is only built where
its door step is within a block of the road and beside it (some doors were
two blocks up, and a few past the road's end); the well shaft is lined down
to its foot, so it never opens on a cave; smithies' open fronts no longer
hold two hanging window panes. The "Entering …" banner follows the roads and
buildings rather than the box round them, and night spawns are kept off the
far side of the roads too.

From Phase 3, early: the travelling trader comes to the stall on the square
of a village you're in or near (within about 96 blocks of its centre) when
there's no stall of your own close by.

Still to come from Phase 1: the bell, lectern, barrel and oven blocks, `/locate village`, and village-owned animals in the pens.

### Step 1 was shippable on its own

Villages without villagers are still worth finding (shelter, beds, loot,
fields to harvest). They let the generator settle and be tested on its own:
- determinism across chunk orders and worker counts;
- chunk-border seams, checked by building the same village in different
  load orders and diffing;
- byte-identical older generators.

## Phase 2: villagers

### Step 3 and the start of step 4 (done)

`entities/villagers.js` and `world/villageTrade.js`:
- **The record** (`worldMeta.villages[id]`): made the first time you come
  within 40 blocks of a village, from its plan: one resident a bed (the
  second bed of a family house is a child's about half the time), each
  grown-up given a free workplace (a smithy, kitchen, library, farm or
  stable), then the fields, else no job. Checked once a session on load
  (names, beds and workplaces must be real; at most 16 residents and 64
  villages).
- **Present or away:** bodies within 40 blocks of a village's bounds, gone
  past 56; they come back where the schedule says (in bed, at work, on the
  square, at home), not where they were.
- **The day:** asleep 0.53–0.98, home at dusk and dawn and in the rain,
  work in the morning and afternoon, the square at noon; each resident a
  little early or late. Children play on the square and grow up after
  three days into a free job.
- **Getting around:** routes come from the plan, not a search: out of the
  building (doors and the stable's gate opened and shut behind), along
  the roads, round the well on a ring three blocks out, in at the next
  door. The last few cells use the existing A*; a villager stuck for 8 s
  hops on when you're not watching. A check over 49 villages (16,296
  routes) found every waypoint standable and no leg too long or steep.
- **Talk and trade:** use one for a speech bubble by job, time, weather
  and recent losses, and (a grown-up with a trade, by day; sneak to just
  talk) its trades: five job tables, offers with uses that refill over a
  day, levels at 20/60/150 coins traded (Novice to Master) adding offers,
  buying at a fifth over the market with a per-village glut. No sale price
  is under what the thing fetches anywhere (stall customers, the trader's
  wants, another village).
- A farmer reaps and replants ripe crops by it. A villager hit runs off;
  one killed is gone, and mourned for two days.

Not yet: shepherds, butchers, beekeepers and fishers (no buildings for
them), kids following you about, rain shelter under the nearest roof
(they go home), the market stall per village, the trader's visits moving
to the square for good, and standing (Phase 4).


1. **`Villager` mob** (`entities/villager.js`):
   - **Model:** a humanoid like the trader's, with style-based clothes and
     profession details (smith's apron, farmer's hat, librarian's
     spectacles, cook's cap). The kids are half-size.
   - **Movement:** they don't despawn, aren't counted against spawn caps,
     and walk on foot. They open and close doors and avoid edges, water and
     fire.
   - **Faces:** they look at you when near, and nod when you trade.
2. **The village record** (`worldMeta.villages[id]`, where id is the
   region key). It is created the first time any chunk of the village
   loads, with residents rolled from the plan's beds and workstations:
   - name, style, centre and bounds;
   - residents `[{id, name, job, home: bed, work: station, born, mood}]`;
   - standing `{player: number}`;
   - stock, plus the `lastSeen` clock for catch-up.
   - It is separate from chunks, so it survives chunk unloads and edits.
3. **Present or away.** Villagers are bodies only when the player is within
   about 64 blocks of the village centre. Leaving saves their positions and
   state back into the record and removes them, as the stash does.
   Returning re-creates them where the schedule says they'd be by now
   (bed at night, workstation by day, square at noon), not where they were
   left. So "away" costs nothing and still looks right.
4. **The daily schedule.** These are blocks of the world clock, not timers:
   - **Dawn:** wake, leave home.
   - **Morning:** work. Each villager stands at, uses and potters around
     its station:
     - a farmer tends and harvests the fields and replants (real block
       changes, rate-limited);
     - a dairy hand churns;
     - a smith's furnace glows.
   - **Noon:** the square: mingle, chat in pairs.
   - **Afternoon:** work.
   - **Dusk:** home, door closed.
   - **Night:** in bed. Any villager outside walks home.
   - **Rain:** a villager outside shelters under the nearest roof.
5. **Getting around.** The current A* (16 blocks, 200 nodes) is too short
   for a village, so it gets a road graph:
   - the site plan already knows the roads, so a villager takes the road
     graph from door to door;
   - A* covers only the last leg, from the road to the door or the station.
   - Paths are cached per (from-plot, to-plot), and the existing
     few-searches-a-frame budget keeps the cost bounded.
6. **Talking.** Using a villager with an empty hand shows a speech bubble
   from a small phrase table:
   - by job and time of day ("Fine day for haying");
   - by standing ("Oh. It's you.");
   - by events ("We lost Tam to the zombies last night").
7. **Kids** run around the square by day and follow you a little. They grow
   up after a few in-game days, into a free job if there is one.

## Phase 3: trading

1. **Trade panel:** reuses the trader panel (`ranchPanel` 'trader' kind),
   with a villager's name, job, and offers in two columns, *they buy* and
   *they sell*, priced in coins.
2. **Trades by job.** Every job buys something the ranch or the kitchen
   makes, and sells something useful:

   | Job | Buys | Sells |
   |---|---|---|
   | Farmer (composter) | wheat, carrots, potatoes, beetroot, pumpkins | bread, seeds of all kinds, bone meal, a golden carrot (rare) |
   | Shepherd (wool) | wool, mutton | dyed wool, carpets, shears, a bed |
   | Dairy hand (churn) | milk, eggs | butter, cheese, pancakes, cake |
   | Butcher (campfire) | raw meat, coal | cooked meat, leather, a lead |
   | Smith (furnace) | coal, iron ore, gold | iron tools and armour, horse armour, a saddle |
   | Cook (oven) | mushrooms, rice, peppers, fish | stews and soups, pies, fish and chips |
   | Librarian (lectern) | paper, books, feathers | name tags, a ledger, enchant-free "manuals" (recipe hints) |
   | Beekeeper (hive) | flowers, sugar | honey, honeycomb, candles, a beehive |
   | Fisher (barrel) | string, sticks | raw and cooked fish, a fishing rod, kelp |
   | Stable hand (hay) | wheat, hay, apples | saddles, horse armour, a whistle |

3. **Stock and restock.**
   - Each offer has a few uses.
   - Stock comes back over a day of the clock, with catch-up while you're
     away, capped at full.
   - A villager's job level goes up with trade, adding one offer a level
     (up to level 4).
   - Prices sag as you sell lots of one thing. This reuses the market's
     glut model, kept per village, so selling eggs to the farm village
     next door doesn't crash prices here.
4. **The market stall as a hub.** The square's stall is the village
   market:
   - the same prices as your own stall today, but per village;
   - the travelling trader's visits stop at the nearest village's square
     when there is one.
5. **Coins:** coins stay the only money. Villages also accept a few items
   in trade-ins, which pay in coins.

## Phase 4: standing, requests and the law

1. **Standing** (per village, from −100 to 100; it starts at 0):
   - **Up:** trading, finishing requests, killing monsters inside the
     village at night, gifts (by use, with a liked item: each job has
     favourites).
   - **Down:** hitting a villager (a lot), killing one (very much), taking
     from the village's chests or leading off its animals (spotted only if
     a villager can see you), and breaking village blocks (doors, beds,
     fields that aren't ripe).
   - **Effects:** prices (±25%), greetings, and requests. At −50 or below,
     villagers shut their doors on you and the stall won't trade. Standing
     drifts back toward 0 by a point a day.
2. **Requests** (a notice board, a sign in the square):
   - Two or three at a time, drawn from what the village is short of (the
     fields it doesn't have, the jobs it lacks). For example: "Bring 16
     wool", "Bring 4 cheese", or "Clear the cave by the mill", which
     counts kills nearby.
   - Paid in coins and standing, now and then with something rare.
   - They lean on the ranch: a village with no dairy asks for butter and
     cheese.
3. **Ownership rules:** the village's blocks, chests and animals are marked
   in the record (by plot), so only real village property counts. Anything
   you build is yours.

## Phase 5: danger and defence

1. **Night:**
   - Surface monster spawns are blocked inside the village's lit bounds:
     lanterns and torches already stop spawns by light, and the village
     adds a soft cap near the square.
   - Zombies drawn to villagers try doors. They can't open them, but they
     can break one down in hard mode.
   - A villager caught outside runs home.
2. **Guards:** larger villages have one or two guards with spears, who
   patrol the roads at night and fight monsters. Bigger villages may keep
   a dog.
3. **Losses:**
   - A villager killed is gone: the record notes it and the village
     mourns (a line in the chat and the speech table).
   - Beds left empty fill over time, by a villager moving in or a kid
     growing up, if the village has food (fields and pens in use) and
     standing isn't hostile.
4. **Raids (optional, late):** a rare night raid led by a skeleton knight
   or a zombie brute, announced by the bell. Defending it earns a lot of
   standing and a reward. This uses existing mobs and needs no new AI.

## Phase 6: growth and your own village

1. **Villages grow:**
   - A thriving village (high standing, fed, full beds) adds a plot every
     few in-game days, on a free spot along a road.
   - The new building is placed whole, while the player is away from that
     plot, from the same templates.
   - This is capped at the region's bounds and a maximum size.
2. **Recruit to your ranch:**
   - Build a house (an enclosed room with a bed and a door, detected like
     a pen) and a workstation near your ranch.
   - A villager whose standing with you is high and who has no work can be
     invited ("Room for a farmer?").
   - They move in: your ranch becomes a hamlet in the record, with the same
     schedule and trades.
   - Hired hands do one job automatically: a farmer harvests and replants,
     a shepherd shears into a chest, and a dairy hand churns. This
     overlaps with the machines, so they should cost upkeep (coins or food
     a day) and be better at the fiddly parts.
3. **The Scorchlands:**
   - Ash-folk outposts: a hardier people living in charred-brick huts round
     a lava forge.
   - They trade in embers, scorch peppers, ash goat milk and fire-proof
     gear. They're wary of the Overworld at first.
   - Same systems, different style, trade table and phrase table.

## Data and save format

- **`worldMeta.villages`**: `{[id]: {name, style, cx, cz, bounds, created,
  lastSeen, residents: [...], standing, stock, glut, requests, props}}`,
  kept per dimension like `dims[*]`.
- **Each resident**: `{id, name, job, level, xp, home: [x,y,z], work:
  [x,y,z], born, kid, alive, mood, lastTrade}`.
- **Owned village things**: chests, beds and animals carry `owner:
  'village:<id>'`. Pens reuse the ranch's `home`.
- **Migration**: none needed. Worlds on generator 11 or older never make
  villages. Existing worlds that are moved forward keep their generator
  version.
- **Import sanitisation**: as for animals:
  - names are strings (at most 24 characters);
  - numbers are finite and in range;
  - positions are integers inside the village's bounds;
  - at most 40 residents a village and 64 villages a dimension.

## Performance budget

- **Generation:** planning is cached and pure; building is a clipped piece
  loop. The cost is under 1 ms per village chunk in the worker.
- **Villagers:** present only within about 64 blocks of the village, and at
  most 16 bodies a village (kids included). Each one thinks at a reduced
  rate beyond 24 blocks.
- **Pathing:** road-graph routes are cached per plot pair, and A* is used
  only for the last leg, inside the existing per-frame search budget.
- **Catch-up:** returning to a village applies the elapsed clock in O(1)
  per resident (stock, growth, schedule position, field ripeness). Only
  the visible fields are touched, through the existing crop catch-up.
- **Targets:** a full village (16 villagers, 4 guards at night) in view at
  60 fps on a mid laptop and 30 fps on a Chromebook. Loading a village's
  chunks shouldn't add visible stutter, since building happens in the
  workers.

## Testing

- **Generator:**
  - `cmp9` and `cmp10`, plus a new `cmp11`: generators 1–11 stay
    byte-identical.
  - A village seam test: generate a village's chunks in three load orders
    and in one worker and in four. The blocks must match exactly.
  - A siting survey over 200 regions of a few seeds: how many villages,
    by style, how far apart, and how many plots were dropped for slope or
    water.
- **Gameplay:** scripted tests in the style of the ranch tests:
  - find a village, walk in, and see the name;
  - trade each job;
  - restock after a day;
  - finish a request;
  - standing changes after hitting a villager;
  - spend a night (villagers home, no monsters on the square);
  - reload mid-day, and see villagers where the schedule says.
- **Playthroughs:** extend the 100-run harness with a village goal (find
  one, trade for a saddle, sleep in a village bed) and watch for crashes,
  stuck villagers and broken paths.
- **Audit:** after each phase, an independent review of the diff, the same
  as the ranch steps.

## Order of work (each step shippable)

1. **Framework:** regions, siting, the site plan, clipped building,
   keep-clear and the seam tests, with a few placeholder buildings, on
   generator 12 behind the version.
2. **Templates and styles:** all five styles, fields and pens, loot, names,
   the "Entering…" banner, the path block, bell, lectern, barrel and oven,
   and the spawn nudge.
3. **Villagers:** the village record, present-or-away, the schedule, the
   road graph, doors, talk, kids.
4. **Trading:** the panel, the job tables, stock and restock, levels, and
   per-village prices. The trader's visits move to the square.
5. **Standing and requests:** the notice board, ownership, theft.
6. **Night and defence:** spawn rules, guards, losses and refilling beds.
7. **Growth and hired hands.** Raids and ash-folk outposts come last, as
   their own steps.

## Open questions

- **Village density** (settled): the step 1 survey found about 19% of
  regions with a village, about one every 870 blocks.
- **Who sets the price of ranch goods**, the stall or the villages? The
  plan keeps the stall and makes it per village. The alternative is to
  retire the player-built stall once villages exist.
- **Hired hands versus machines.** Both automate the ranch. Hired hands
  should feel personal and cost upkeep; machines are cheap and dumb. Is
  that distinct enough, or should hired hands only do what machines can't
  (sell at market for you, breed for traits)?
- **Generator 11 or 12** (settled): villages are generator 12, so
  generator 11 (plants and berries) shipped on its own.
