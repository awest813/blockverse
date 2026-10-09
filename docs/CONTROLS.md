# Controls & Commands

All keyboard controls below are defaults. Rebind them in **Settings → Controls**
(click a key, press the new one; Esc cancels). Conflicting bindings are shown in
red, and **Reset Keys** restores the defaults. Esc and 1–9 can't be rebound.
The same tab has mouse sensitivity and **Invert mouse Y**.

## Controller

Any standard gamepad (Xbox, PlayStation, most Bluetooth pads) works as soon as
you press a button.

| Button | In game | In menus / inventories |
| --- | --- | --- |
| Left stick | Move (click: sprint) | Move the highlight |
| Right stick | Look (click: toggle sneak) | — |
| RT / LT | Mine / attack · Place / use | — |
| A | Jump (double-tap in creative: fly) | Select / pick up |
| B | Drop item | Back / close |
| X | Pick block | Split a stack (right click) |
| Y | Inventory | Close inventory |
| LB / RB | Hotbar | Switch settings tabs · RB: quick move |
| D-pad | ←/→ hotbar, ↑ hide HUD | Move the highlight |
| Start | Pause | Back |
| Back / View | Chat | — |

## Touch (phones and tablets)

Touch controls appear automatically on the first touch.

| Gesture | Action |
| --- | --- |
| Left stick | Move — push all the way forward to sprint |
| Drag anywhere else | Look around |
| Tap | Use / place, or hit a mob in reach |
| Touch and hold | Mine |
| ⤒ | Jump (double-tap in creative: fly) |
| Sneak / Drop | Toggle sneaking · drop the held item |
| ▦ / … / II | Inventory · chat · pause |
| Hotbar | Tap a slot to select it |
| Inventory | Tap to pick up / place · touch and hold to split |

## Keyboard & mouse: movement

| Input | Action |
| --- | --- |
| W / A / S / D | Walk |
| Mouse | Look around (click the game once to capture the mouse) |
| Space | Jump; hold to swim upward in water |
| Ctrl, or double-tap W | Sprint until you stop moving forward (needs food > 3 drumsticks) |
| Shift (hold) | Sneak — slower, and you cannot walk off block edges |
| Space ×2 (creative) | Toggle flight; Space/Shift to fly up/down |

## Interaction

| Input | Action |
| --- | --- |
| Left click (hold) | Mine the targeted block — crack overlay shows progress |
| Left click | Attack a mob |
| Right click | Place the held block |
| Right click on crafting table / furnace | Open it (sneak to place a block against it instead) |
| Right click with food | Eat |
| Right click grass/dirt with a hoe | Till it into farmland |
| Right click farmland with seeds | Plant wheat |
| Right click a crop or sapling with bone meal | Make it grow |
| Right click with armour | Wear it (swaps with what you have on) |
| Hold right click with a bow | Draw (longer = stronger, meter under the crosshair); release to shoot. Needs arrows in survival |
| Right click a dog with a bone / a cat with raw fish | Try to tame it (about 1 in 3 per item) |
| Right click your pet | Sit / follow |
| Right click TNT while holding a torch | Light the fuse — run! |
| Q | Drop one of the held item (Ctrl+Q: the whole stack) |
| Middle click | Pick block: select the targeted block in your hotbar (creative: get a stack) |
| 1–9 / mouse wheel | Select hotbar slot |

## Screens

| Input | Action |
| --- | --- |
| E | Open/close inventory (survival: with 2×2 crafting; creative: item palette) |
| Esc | Close screen / pause menu |
| T or / | Open chat (/ pre-fills a command) |
| F1 | Hide the HUD |
| F3 | Debug overlay |

### Recipe book

- Shown beside the crafting grid in your inventory and at a crafting table (toggle with "Hide recipes")
- Green: you can make it now — click to fill the grid, Shift-click for as many as you can afford
- "3×3": you have the ingredients but need a crafting table
- Grey: hover to see what's missing; click to see the layout as faint "ghost" items in the grid (red outline = you have none of that ingredient)
- Tabs (All, Gear, Blocks, Food, Items) and a search box — searching an ingredient ("planks") finds everything made from it
- Hovering any recipe shows a miniature of its shape

### Furnace

- The smelting guide beside the furnace lists everything that can be smelted; click one to load your whole stack plus just enough of your best fuel
- Logs smelt into charcoal, a fuel as good as coal

### Creative item palette

- Category tabs (All, Blocks, Plants, Gear, Food, Items) and a search box
- Drop a carried stack on the red ✕ slot to destroy it

### Inventory mouse rules

- Left click: pick up / swap / merge a stack
- Right click: place a single item, or split half of a stack
- Shift+click: quick-move between areas (into furnace slots, hotbar ↔ backpack)
- Shift+click a craft result: craft as many as fit into your inventory
- Click outside the window: throw the cursor stack on the ground
- Drag a carried stack across slots: split it evenly between them (right-drag: one item per slot)
- Double-click a stack: gather every matching item onto the cursor
- 1–9 while hovering a slot: swap it with that hotbar slot
- Q while hovering a slot: drop one item (Ctrl+Q: the whole stack)

## Mining rules

- Each block has a hardness and an optional preferred tool class.
- Better tool tiers mine faster; some blocks need a minimum tier to drop
  anything (iron needs stone+, gold/diamond/redstone need iron+, obsidian
  needs diamond).
- Tools lose 1 durability per block or hit; the bar under the icon shows wear.

## Commands

Open chat with `T` or `/`, then:

| Command | Effect |
| --- | --- |
| `/help` | List commands |
| `/tp <x> <y> <z>` | Teleport |
| `/time set <day\|noon\|sunset\|night\|midnight\|0..1>` | Set time of day |
| `/give <item> [count]` | Give items — names like `oak_planks`, `diamond_pickaxe`, `torch` |
| `/gamemode <survival\|creative>` | Switch mode |
| `/seed` | Show the world seed |
| `/spawn` | Return to spawn |
| `/heal` | Refill health, hunger, air |
| `/kill` | Give up |
| `/clear` | Empty your inventory |
| `/rd <2-16>` | Set render distance |
