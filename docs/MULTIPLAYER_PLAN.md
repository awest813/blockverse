# Multiplayer Plan — Host PC as the Server

Status: **proposal** · Scope: audit of the current single-player engine and a
phased plan for a multiplayer mode in which one player's PC runs the
authoritative server and friends connect to it.

---

## 1. TL;DR

- Today every system assumes **one local player, one browser tab, and full
  authority on the client**. Nothing is networked, and simulation is tangled
  with rendering (mobs read a shader uniform; entities own three.js meshes).
- A browser tab **cannot accept inbound connections**. "The host PC is the
  server" therefore means one of two things:
  1. **Node host process (recommended first):** the host runs
     `npm run host`. A Node process serves the game client over HTTP and a
     WebSocket on the same port. Friends open `http://<host-ip>:25570`; the
     host plays at `http://localhost:25570`. No third-party services.
  2. **Browser listen-server (optional, later):** the server runs in a Web
     Worker inside the host's tab, and friends connect over WebRTC. No
     install, but it needs a signaling relay and STUN/TURN, so it is not purely
     "host PC only".
- The core move is the same either way: split the game into a **headless
  authoritative `Server`** (world, players, entities, furnaces, time,
  commands, persistence) and a **render-only client**, talking through a
  `Transport` interface. Single-player then runs that same server in-process,
  so there is one gameplay code path, not two.
- **Bandwidth trick:** worldgen is deterministic from the seed, so clients
  generate pristine terrain themselves. The server sends only a hash per
  pristine chunk (to catch cross-engine float drift) and the full data only
  for **modified** chunks. Joining costs kilobytes, not ~20 MB.

---

## 2. Audit of the current codebase

### 2.1 What already helps

| Asset | Why it matters for multiplayer |
| --- | --- |
| `src/world/worldgen.js` is pure (no DOM/three) | Runs unchanged in Node, workers and the browser; clients can regenerate terrain from the seed. |
| Deterministic seeded RNG (`src/core/rng.js`), cross-chunk features derived from `(seed, cx, cz)` | Chunk content is reproducible anywhere, which makes "seed + diffs" chunk sync possible. |
| `src/world/light.js`, `src/core/physics.js`, `src/world/raycast.js`, `src/blocks/blocks.js`, `src/items/*.js` are headless | Server can run lighting (for mob-spawn darkness), collision, reach checks, recipes and smelting as-is. |
| `World.setBlock()` is the single mutation choke point (`src/world/world.js:76`) | One place to emit "block changed" events or route through the server. |
| Only *modified* chunks are persisted (`src/save/store.js`) | The same "modified" flag tells the server which chunks must be sent in full. |
| Chat renders with `textContent` (`src/ui/chat.js`) | Already XSS-safe for untrusted remote text. |
| `World` takes `loadChunk` / `onChunkEvicted` hooks | A natural seam for a "chunk source" abstraction (local gen vs. server). |

### 2.2 Blockers: single-player assumptions

| # | Where | Problem | Required change |
| --- | --- | --- | --- |
| B1 | `src/game.js:49`, all of `Game` | Exactly one `Player`. Input, camera, HUD and simulation all reference `this.player`. | Separate *local player* (client) from *server players* (`Map<id, ServerPlayer>`). |
| B2 | `src/entities/entityManager.js:31`, `mob.js:70,79,83`, `mobs.js:126`, `itemDrop.js:59,78` | Every entity's `update(dt, player)` takes a single player: despawn distance, chase target, item magnet and pickup. | Pass the player set, target the nearest living player, and despawn only when far from **all** players. |
| B3 | `src/entities/mobSpawner.js:18` | Spawns around one player with global caps. | Spawn around each player; caps per player (deduped when players are close). |
| B4 | `src/entities/mob.js:134`, `mobs.js:130` | **Simulation reads a render uniform** (`world.materials.uniforms.uDay`) for zombie burning and tint. | Put `dayFactor` on the world/time model. Only the view layer reads uniforms. |
| B5 | `mob.js`, `itemDrop.js` | Entities create three.js meshes and materials in their constructors, so the sim can't run headless. | Split into `MobSim`/`DropSim` (pure state + AI) and `MobView`/`DropView` (meshes, animation, light tint). |
| B6 | `src/world/world.js` | `World` mixes chunk storage, streaming around **one** position, lighting, meshing and three.js materials. | Split into `WorldData` (headless: chunks, blocks, block entities, light) and `ClientWorld` (meshing, materials, `group`). Server streaming is driven by the **union of players' view areas**. |
| B7 | `src/player/interaction.js:107-200` | Breaking and placing mutate the world directly; drops are rolled locally. | Client sends intents (`dig`, `place`, `use`) and may predict. The server validates, applies, rolls drops and broadcasts. |
| B8 | `src/game.js:77` | Melee hit detection and damage happen on the client. | Client sends `attack(entityId)`. The server re-checks reach and line of sight, then applies damage and knockback. |
| B9 | `src/player/player.js:148-240` | Health, hunger, air, fall damage, drowning and death all run in the client's `Player.update`. | Move the survival model to a shared `PlayerStats` that runs on the server from the reported movement stream. The client only displays it. |
| B10 | `src/ui/containers.js:365+` | Crafting grid, cursor stack, inventory and **furnace state** are mutated directly by UI click handlers. Two players at one furnace would race. | Move the click logic into a pure, shared `inventoryOps` module. The server owns "windows"; the client sends `windowClick` and predicts with the same function. |
| B11 | `src/items/furnace.js` via `src/game.js:283` | Furnaces tick inside the client loop. | Tick on the server and push progress to the players viewing that furnace. |
| B12 | `src/game.js:100,266` | Time of day is advanced locally and keeps running while paused. | Server-owned clock, broadcast periodically; clients extrapolate between updates. |
| B13 | `src/ui/chat.js` | `/tp`, `/give`, `/gamemode`, `/time`, `/kill` mutate local state with no permissions. Chat only echoes `<you>`. | Commands become server-side with an op permission. Chat is broadcast. |
| B14 | `src/save/store.js:49`, `src/game.js:140,408` | `playerData` is a single blob on the world record. | Per-player records keyed by a stable player id. Migrate an existing `playerData` to the host's id. |
| B15 | `src/main.js:112` | Respawn is local. | `respawn` request; the server resets stats and teleports. |
| B16 | — | No avatar for other players. | Box-model `PlayerView` (same technique as `Zombie`), a name-tag sprite, a Tab player list, and interpolation. |
| B17 | `src/audio/sfx.js` | Sounds are non-positional and triggered only by local actions. | Server emits `sound{name, pos}` for others' actions; the client attenuates by distance. |

### 2.3 Pre-existing bugs worth fixing first

1. **Chunk-load leak can freeze the player.** `GenPool.prune()`
   (`src/world/genPool.js:50`) drops queued jobs, but their promises never
   settle. `World.requestChunk` stays stuck at `await this.pool.generate(...)`,
   its `finally` never runs, and the key stays in `pendingGen` forever
   (`world.js:206,249`). `requestMissing` then skips that chunk permanently.
   If you move fast and come back, you get holes. Walking into one freezes the
   player, because `Player.update` returns early on unloaded chunks. A server
   that streams for several players would hit this constantly. Fix: resolve
   pruned jobs with `null` (or reject) and clear `pendingGen`.
2. **Sim depends on the renderer** (B4). This has to be fixed before the sim
   can run headless.
3. **The lockfile pins `registry.npmmirror.com`** (64 entries in
   `package-lock.json`). `npm ci` fails anywhere that mirror is unreachable
   (it failed in this audit's environment). Regenerate the lockfile against
   `registry.npmjs.org`, which matters once the host needs a server dependency.
4. **No automated tests.** Multiplayer needs at least determinism, codec and
   inventory-op tests (see §8).

### 2.4 Platform constraints that shape the design

- **Browsers can't listen on sockets.** A pure "Open to LAN" button is
  impossible without a Node process or WebRTC.
- **Mixed content.** The public build is served over HTTPS (GitHub Pages),
  and an HTTPS page cannot open `ws://192.168.x.x`. So the client must be
  loaded *from the host* over plain HTTP, or the host needs TLS (`wss://`, for
  example through a tunnel like `cloudflared` or Tailscale HTTPS).
- **`http://<lan-ip>` is not a secure context.** `crypto.randomUUID()` is
  unavailable there; use `crypto.getRandomValues()` for player ids. Verify that
  every API the client uses works without a secure context (pointer lock,
  IndexedDB, workers, WebAudio, and `CompressionStream`, falling back to
  RLE-only if it is missing).
- **Float determinism across JS engines.** Worldgen uses `Math.pow`
  (`src/world/worldgen.js:48`), which is not guaranteed to round identically in
  V8, SpiderMonkey and JavaScriptCore. Results are floored, so drift is rare,
  but a Firefox client could disagree with a Node server at a height threshold.
  This is why the per-chunk hash check exists (§5.3).
- **Hidden-tab throttling** only matters for the browser-host option. The
  existing worker ticker (`src/game.js:131`) is a template for that.

---

## 3. Architecture decision

### Option A: Node host process (recommended for v1)

```
 Host PC                                          Friend PCs
┌──────────────────────────────────────────┐     ┌─────────────────────┐
│ node server/host.js  (port 25570)        │     │ Browser             │
│  ├─ HTTP: serves dist/ (the client)      │◄────┤ http://HOST:25570   │
│  ├─ WS /ws: protocol                     │◄────┤  ClientGame         │
│  ├─ Server (headless sim, 20 TPS)        │     └─────────────────────┘
│  ├─ worker_threads gen pool (worldgen.js)│
│  └─ FileStore  ./worlds/<name>/          │     ┌─────────────────────┐
└──────────────────────────────────────────┘◄────┤ Host's own browser  │
                                                 │ http://localhost:…  │
                                                 └─────────────────────┘
```

- **Pros:** truly "host PC is the server". No signaling, STUN or TURN. Same
  origin, so no mixed-content or CORS problems. File persistence. A real
  fixed-rate tick that background throttling can't touch. The same build
  can run as a headless dedicated server.
- **Cons:** the host needs Node ≥ 20 and must allow the port through the OS
  firewall. Internet play needs port forwarding or a VPN or tunnel (Tailscale,
  ZeroTier, playit.gg, cloudflared). The only new dependency is `ws`, and it is
  server-only.

### Option B: Browser listen-server over WebRTC (later, optional)

The server runs in a Web Worker in the host's tab, and remote clients connect
over `RTCDataChannel`s.

- **Pros:** no install, works from the GitHub Pages build, and existing
  IndexedDB worlds can be hosted directly.
- **Cons:** it needs a signaling path (a copy-paste invite code or a small
  relay) and STUN, plus TURN for symmetric NATs. Throughput depends on the
  host's tab staying alive. It is harder to debug.

**Recommendation:** build the server/client split so that it is
transport-agnostic, ship **Option A** first, and keep Option B as Phase 5. The
`Transport` interface below makes B an add-on rather than a rewrite.

### 3.1 Target module layout

```
src/
├── shared/                 # runs in browser, worker and Node; no DOM, no three
│   ├── protocol.js         # message ids, PROTOCOL_VERSION, encode/decode
│   ├── codec.js            # binary helpers, chunk RLE + deflate, chunk hash
│   ├── inventoryOps.js     # pure clickSlot/takeOutput/quickMove (from containers.js)
│   ├── playerStats.js      # hunger/health/air/fall model (from player.js)
│   └── validate.js         # reach, speed, placement checks
├── server/
│   ├── server.js           # Server: tick loop, sessions, routing
│   ├── serverWorld.js      # WorldData + interest-based streaming + gen source
│   ├── serverPlayer.js     # per-connection state, view set, window, perms
│   ├── entities/           # MobSim, DropSim, spawner (from src/entities)
│   ├── commands.js         # server-side commands + op checks
│   ├── store/              # PersistenceAdapter: IdbStore (browser), FileStore (Node)
│   └── host.js             # Node entry: HTTP static + WS + CLI flags
├── net/
│   ├── transport.js        # interface: send(msg), onMessage, close
│   ├── localTransport.js   # in-process pair (single-player)
│   ├── wsTransport.js      # WebSocket client
│   └── rtcTransport.js     # (Phase 5)
├── world/  (WorldData + ClientWorld split)
├── entities/ (views only: MobView, DropView, PlayerView)
└── ...existing render/ui/audio
```

### 3.2 Authority model (trusted-friends default, configurable)

| Concern | Authority | Notes |
| --- | --- | --- |
| Movement | **Client**, server-checked | Client runs the existing physics for zero-latency feel. The server rejects impossible deltas (speed cap per mode, no flying in survival, no ending inside solid blocks) and sends a `teleport` correction. |
| Blocks | **Server** | Client predicts, server confirms or reverts. |
| Break timing | Server-validated | Server computes `breakTime` with the same formula and accepts `finishDig` if elapsed ≥ 70% of it. |
| Health, hunger, air, death | **Server** | Derived from the reported movement stream and server-side water checks. |
| Inventory and containers | **Server** | Client predicts with the shared `inventoryOps` and reconciles by `actionId`. |
| Mobs and drops | **Server** | Clients interpolate snapshots. |
| Time, weather | **Server** | |
| Chat and commands | **Server** | `/give`, `/gamemode`, `/tp` and `/time` are op-only. |

---

## 4. Protocol (v1)

JSON text frames for low-rate control messages and binary frames for chunks
and high-rate entity or movement batches. Every message has a numeric `t`
(type). The handshake carries `PROTOCOL_VERSION`, and a mismatch is rejected
with a readable message.

**Client → Server**

| Msg | Payload | Rate |
| --- | --- | --- |
| `hello` | `protocol, playerId, name, password?, viewDistance` | once |
| `move` | `seq, x, y, z, yaw, pitch, flags(onGround, sneak, sprint, fly, inWater)` | 20 Hz |
| `dig` | `phase(start/abort/finish), x, y, z` | on input |
| `place` | `x, y, z, face, slot` | ≤ ~5/s |
| `use` | `x, y, z` (crafting table / furnace) | on input |
| `attack` | `entityId` | on input |
| `heldSlot` | `slot` | on change |
| `drop` | `slot, count` | on input |
| `eat` | `slot` | on input |
| `windowClick` | `windowId, slot, button, shift, actionId` | on input |
| `windowClose` | `windowId` | on input |
| `chat` | `text` (≤ 256 chars) | rate-limited |
| `respawn` | — | on input |
| `chunkResync` | `cx, cz` (hash mismatch) | rare |

**Server → Client**

| Msg | Payload |
| --- | --- |
| `welcome` | `entityId, seed, time, mode, spawn, playerState, serverInfo` |
| `chunk` | `cx, cz, kind: 'seed'|'full', hash, data?, blockEntities?` |
| `unloadChunk` | `cx, cz` |
| `blocks` | batched `[x, y, z, id, meta]` changes |
| `entitySpawn` / `entityDespawn` | `id, kind, pos, yaw, extra` |
| `entityMoves` | binary batch `id, x, y, z, yaw, flags` at 10–20 Hz |
| `entityEvent` | `id, hurt|death|swing` |
| `playerList` | add, remove, ping |
| `stats` | `health, hunger, saturation, air, mode` |
| `inventory` | full or per-slot |
| `windowOpen` / `windowItems` / `windowProgress` | furnace and crafting windows |
| `time` | `t` (every ~5 s) |
| `teleport` | `x, y, z` (correction or command) |
| `sound` | `name, x, y, z, block?` |
| `chat` | `from, text, color` |
| `kick` | `reason` |

---

## 5. Key subsystems in detail

### 5.1 Server tick

- Fixed **20 TPS** loop (`setInterval` with an accumulator; `dt = 0.05`),
  replacing the variable `dt` of the render loop for anything authoritative.
- Order per tick: drain the inbound queues, then players (stats from movement),
  entities, spawner, furnaces, time, chunk streaming (union of view sets) and
  outbound flush (batched block changes and entity deltas).

### 5.2 Interest management and streaming

- Each `ServerPlayer` has a view set: chunks within `min(clientViewDist,
  serverViewDist)`. The server's loaded set is the union of those plus a
  margin, and it evicts (saving modified chunks) when no player needs a chunk.
- A separate, smaller **simulation distance** (e.g. 6 chunks) controls where
  mobs think and furnaces tick, which keeps server CPU bounded.
- Reuse the `GenPool` design, but fix the prune bug (§2.3) and add a Node
  variant on `worker_threads`.

### 5.3 Chunk sync with seed generation and diffs

1. When a chunk enters a player's view, the server sends `chunk{kind:'seed',
   hash}` if it is unmodified, or `chunk{kind:'full', data}` if it is
   modified. `data` is the `Uint16Array` blocks plus meta, RLE'd and then
   deflated.
2. For `seed` chunks, the client generates the chunk with its own worker pool,
   computes the same hash (e.g. FNV-1a over `blocks`), and on mismatch sends
   `chunkResync`. The server answers with `full`.
3. A `blocks` change for a chunk the client hasn't finished building is
   **buffered** and applied after the chunk lands. This avoids a lost-update
   race.
4. The client always computes light and meshes locally (light is a
   deterministic function of blocks), so the server never sends light.

### 5.4 Prediction and reconciliation

- **Blocks:** apply the local change immediately. If the server rejects it, it
  sends the authoritative `blocks` entry for that cell, which overwrites the
  prediction.
- **Inventory:** the client applies `inventoryOps` locally and tags the action
  with `actionId`. The server answers with an ack or with authoritative
  `windowItems`.
- **Remote entities:** render about 100 ms in the past and interpolate between
  snapshots. Animate walking from velocity.

### 5.5 Persistence

- `PersistenceAdapter` interface: `loadWorldMeta`, `saveWorldMeta`,
  `loadChunk`, `saveChunk`, `loadPlayer(id)` and `savePlayer(id, data)`.
  - `IdbStore` wraps today's `SaveStore` and adds a `players` object store
    (DB_VERSION 2 migration; the old `playerData` becomes the local player's
    record).
  - `FileStore` (Node) writes `worlds/<name>/world.json`,
    `players/<id>.json` and `chunks/<cx>.<cz>.bin`, using atomic write and
    rename. It autosaves every 20 s and on `SIGINT`/`SIGTERM`.
- **Import/export:** "Export world" in the single-player menu produces a
  `.bvworld` file (JSON manifest plus chunk blobs), and
  `npm run host -- --import my.bvworld` loads it. This lets players host the
  worlds they already have.

### 5.6 Identity, permissions and safety

- The player id is 16 random bytes from `crypto.getRandomValues`, stored in
  `localStorage`, plus a display name (`^[A-Za-z0-9_]{3,16}$`, unique per
  server). There are no accounts. An optional server `--password` protects the
  session.
- **Op:** the host is op. That means connections from loopback, or whoever
  presents the op token printed in the host console. Add `/op`, `/deop`,
  `/kick`, `/list` and `/msg`.
- **Validate every inbound message:** type, finite numbers, integer ranges
  (block ids, slots, chunk coordinates), reach ≤ `REACH_DISTANCE + 1`, and
  placement rules (reuse `Interaction.useOrPlace` checks in `validate.js`).
- **Limits:** a maximum inbound frame size (e.g. 16 KB), per-type rate limits
  (chat 1/s with a burst of 5, dig/place about 20/s), an idle timeout, and a
  max-players cap.
- The WebSocket server checks `Origin` so that it only accepts the page it
  serves, unless `--allow-any-origin` is passed.

### 5.7 Client UX

- Main menu: **Singleplayer** (current list) | **Multiplayer**.
- Multiplayer screen: an address field and a name field, plus a recent-servers
  list in `localStorage`. When the page itself is served by a host (detected
  via `GET /api/info`), show a one-click **"Join <server name>"**.
- In-game: name tags, a Tab player list with ping, join and leave messages in
  chat, and a "Disconnected: <reason>" screen with a reconnect button.
- **Pause does not pause the world** in multiplayer. It only releases input.

### 5.8 Host UX (`npm run host`)

```
npm run host -- --world myworld --port 25570 [--seed 1234] [--password pw]
                --view-distance 8 --max-players 8 [--import file.bvworld]
```

On start, the host prints the LAN URLs (enumerated from
`os.networkInterfaces()`), the op token and a firewall hint. It builds
`dist/` first if it is missing. In development, Vite proxies `/ws` to the host
(`server.proxy['/ws'] = { target: 'ws://localhost:25570', ws: true }`), and
`vite --host` exposes the dev server on the LAN.

### 5.9 Bandwidth estimates (8 players, LAN)

- Join: about 361 chunks × ~16 B of `seed` messages, plus modified chunks at
  ~1–6 KB each after RLE and deflate. That is tens to hundreds of KB, versus
  ~23 MB raw.
- Steady state, per client: moves from 7 other players × 20 Hz × ~30 B is
  about 4 KB/s. Twenty mobs × 10 Hz × ~20 B is about 4 KB/s. Block changes are
  negligible. **Under 15 KB/s per client** easily fits on a LAN or residential
  uplink.

---

## 6. Phased implementation plan

Each phase leaves the game shippable. Sizes are relative (S < M < L).

### Phase 0: Groundwork (S)
- [ ] Fix the `GenPool.prune` promise leak (§2.3-1).
- [ ] Decouple the sim from the renderer: `world.time` and `world.dayFactor()`
      replace `materials.uniforms.uDay` reads in `mob.js` and `mobs.js`.
- [ ] Regenerate `package-lock.json` against `registry.npmjs.org`.
- [ ] Add `node --test` with tests for worldgen determinism (chunk hashes for
      a seed grid), the RNG and recipes.

### Phase 1: In-process client/server split (L, the bulk of the work)
- [ ] Create `src/shared/` (`protocol`, `codec`, `inventoryOps`,
      `playerStats`, `validate`) by extracting the pure logic from
      `containers.js`, `player.js` and `interaction.js`.
- [ ] Split `World` into `WorldData` and `ClientWorld`, with a `ChunkSource`
      interface (local generation for the server, server-fed for the client).
- [ ] Split entities into Sim (server) and View (client) classes. Make the
      AI multi-player aware (B2 and B3).
- [ ] Build the `Server`: 20 TPS loop, sessions, intents, furnaces, time,
      commands and `IdbStore`.
- [ ] Refactor `Game` into `ClientGame`: it sends intents, applies server
      messages and keeps local physics, prediction, rendering, HUD and audio.
- [ ] Add a `LocalTransport` with an optional artificial latency and jitter
      knob (`?lag=120`) so that ordering and prediction bugs show up in
      single-player.
- [ ] **Exit criterion:** single-player plays identically through the server
      path; old saves load (`playerData` migrated); no direct world or
      inventory mutation remains in client code.

### Phase 2: Node host and LAN multiplayer (M)
- [ ] `server/host.js`: HTTP static server for `dist/`, `ws` on `/ws`, CLI
      flags, `FileStore` and the `worker_threads` gen pool.
- [ ] `wsTransport` client, the Multiplayer menu, `/api/info` auto-join and
      the disconnect screen.
- [ ] `PlayerView` (box model, name tag, interpolation), Tab list, join and
      leave messages, positional sounds.
- [ ] Seed-plus-hash chunk sync with the buffering rules from §5.3.
- [ ] **Exit criterion:** two machines on a LAN can build together. Blocks,
      mobs, drops, furnaces, chat and day/night all stay in sync. The world
      persists on the host.

### Phase 3: Hardening (M)
- [ ] Full inbound validation, rate limits, max frame size, idle timeouts and
      the protocol-version handshake.
- [ ] Permissions (op token, `/op`, `/kick`, `/list`, `/msg`) and an optional
      password.
- [ ] Movement sanity checks with `teleport` corrections, and break-time
      validation.
- [ ] Reconnect flow: resume the same player id and restore state.
- [ ] Binary codecs for `move` and `entityMoves`, and chunk RLE plus deflate.

### Phase 4: World portability and docs (S)
- [ ] `.bvworld` export and import in both directions (single-player ⇄ host).
- [ ] `docs/MULTIPLAYER.md` for players: hosting, firewall, port forwarding,
      Tailscale or tunnel recipes, and troubleshooting.
- [ ] README updates (the "no servers" claim becomes "no servers *needed*").

### Phase 5 (optional): Zero-install browser hosting (M–L)
- [ ] Run `Server` in a Web Worker on the host tab (the Phase 1 code
      unchanged, with `IdbStore`).
- [ ] `rtcTransport` over `RTCDataChannel` (reliable and ordered for control
      messages; an unordered channel for moves).
- [ ] Signaling: a copy-paste invite or answer code first, and optionally a
      tiny relay later. STUN by default, with a configurable TURN server.

---

## 7. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Phase 1 refactor regresses single-player | High | Do it behind the in-process transport, keep the exit criterion strict, use the latency knob and test with a headless bot. |
| Cross-engine worldgen drift (`Math.pow`) | Ghost blocks or desync | Per-chunk hash check and full resend. Longer term, replace `Math.pow` with a deterministic approximation. |
| Server CPU with several players spread apart | Lag | Separate simulation distance, a time-budgeted light and gen queue, and a `--view-distance` cap. |
| Host firewall and NAT friction | Friends can't connect | Print LAN URLs and a firewall hint, and document Tailscale or tunnels. Phase 5 for zero-config. |
| Mixed content (HTTPS Pages to `ws://`) | Pages build can't join a LAN host | Clients load the game from the host. Note this in the UI when an `https:` page tries a `ws://` address. |
| Cheating by modified clients | Griefing | Server authority for world and inventory, validation, op-gated commands, password, kick. |
| Two players at one furnace or container | Duplication | Furnace state is server-only, and all viewers get the same `windowItems`. |

---

## 8. Test strategy

- **Unit tests** (`node --test`): codec round-trips, `inventoryOps` (no item
  creation or loss across every click type), `playerStats`, validation edge
  cases and the chunk hash.
- **Determinism:** generate a 16×16 chunk grid for fixed seeds in Node and in
  Chromium (Playwright; Chromium is available), and compare hashes in CI.
- **Headless bot client** (Node): N bots connect, walk, dig and place, and the
  test asserts that the server and all bots converge on the same block hashes.
  This doubles as a load test.
- **Two-context Playwright test:** context A places a block; assert that it
  appears in context B within 500 ms.

---

## 9. Open questions for the maintainer

1. **Is installing Node on the host acceptable for v1** (Option A), or is
   zero-install browser hosting (Option B) a hard requirement?
2. **Trust model:** friends-only (lighter validation) or public servers?
3. **Target player count:** this plan sizes for 2–8.
4. Should single-player worlds be **hostable as-is** (that needs `.bvworld`
   export, Phase 4) or is "new world on the host" enough for v1?
5. Is a **headless dedicated server** (no host player) wanted? Option A
   supports it for free.
