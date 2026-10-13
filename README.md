# Keep

A top-down pixel-art castle-building siege game. Build a castle, put your subjects to work, and keep your King alive through 10 enemy assaults.

## Play

Open `index.html` in a modern browser. No build step or server is needed. To start a specific map, add `?seed=12345`.

Each game starts on a large **1024×1024 survey map** so you can scout many possible sites. When you place the Keep, the playable realm shrinks to the **256×256** area centred on it; enemy entry points are then chosen on that realm's edges. Keep sites within 128 tiles of the survey map's edge are not allowed (a white dashed line on the map and minimap marks the limit) so the realm is always a full 256×256. A dashed box shows the realm you would get while hovering. Clicking a site opens a **Confirm Keep placement** window (Enter confirms, Esc cancels).

The **☰ Menu** button pauses the game. Under **Settings** it shows the map seed, with Copy and **Save Seed** (with an optional name). Saved maps are kept in the browser. You can replay them from Settings or from the title screen.

**Customize map ▸** on the title screen opens sliders for a custom, still procedurally generated map: Water (lakes and rivers), Mountains, Trees, Rock patches, Mine sites, Beasts, and Enemy difficulty (army size and enemy toughness). Each slider goes up to 1000% (above 500%, mountains grow more slowly so there is always open land for a Keep). At 100% each slider gives the standard map. A small starter grove and rock patch are always kept. Custom settings are carried in the URL (`?seed=1&opts=water150.beasts0`), shown under Settings, and saved along with saved seeds. To reuse slider settings with any seed, type a name under the sliders and press **Save settings**. Saved settings are listed with a summary: **Load** applies them, ✕ deletes them, and the ones in use are marked. Saving under an existing name overwrites it. They are stored in the browser's localStorage (`keep.mapPresets`).

Alerts appear one at a time in the centre of the top bar. Repeats are counted (×N), and the number waiting is shown (+N).

## Rules

- On the title screen choose your ruler: **King or Queen** (the choice only changes the sprite and wording, and is remembered).
- First, survey the map and **click to place your Keep**. A suggested site is marked, and you can't build on water, mountains or next to a beast lair.
- Before placing the Keep you can **⛰ Shape land**: click, or drag a box over many tiles, to turn up to 40 water or mountain tiles into grassland (for example, to connect a perfect site to the mainland). The box previews in green, or red past the budget. Click or drag over shaped tiles again to undo them; Esc stops shaping.
- Rivers rise below mountains and always run downhill along the drainage to a lake or the map edge; they never climb over ridges or peaks.
- **Nothing is built instantly.** Placing a structure marks out a construction site (resources are paid up front); **Builders** (top of the job table) walk there and build it over time, shown by scaffolding and a progress bar. You start with 20 subjects: 3 Builders, 3 Archers and 3 Light infantry, with the rest unassigned. **Farms, quarries, mines and bloomeries** are instead built by the Farmers, Quarry workers, Miners and Smelters you assign to them, who then start work there. Select a queued site (or a wall waiting for battlements) and press **Cancel build** or Delete to drop it from the queue with a full refund. Builders work through sites in the order you placed them, and several can work on one site at once (one per free square beside it), building it faster. Builders prefer construction during the build phase and repairs during a siege. Builders can work from any square beside a job, diagonals included, or stand on a finished battlement next to it. They climb up from the nearest point of the wall-walk, so a battlement in the middle of a thick wall can still be built.
- **Work order never strands anyone.** If finishing a wall would shut off another queued job, a marked trench or a subject, builders leave it for last. Before closing an enclosure they wait for anyone inside to walk out, and they never work from the side that would be shut in. Ditchers likewise never flood a trench that cuts off other marked tiles or construction sites unless nothing else is left to dig.
- **Subjects never get stuck.** A subject cut off from the Keep (walled in, stranded by water, or caught inside a structure) climbs over the works, swims, or scrambles over rock to get back.
- The build menu has five tabs: Resources, Terrain, Village (houses, tents, research, stables and bridges), Storage (Food, Lumber, Stone and Metal Storage; each adds 800 food, lumber or stone; Lumber Storage also adds 400 processed lumber, and Metal Storage adds 300 iron ore and 300 iron) and Defenses (barracks, walls, battlements, gates, drawbridges, catapults and trebuchets).
- Archers posted on battlements stay on the walls through build phases as well as sieges.
- The **Keep** is a hollow hall: your ruler sits on the **throne** in the middle, and the only way in is the **Keep door** in the south wall. Enemies must batter the door down to reach the throne. Builders repair the door, and a battered-down door is rehung (weakened) at the start of the next build phase.
- Each round has a **10-minute build phase** followed by a **siege** lasting 6–10 minutes. Red arrows on the map edge and minimap show where enemies will enter. During a siege the enemy army appears on the minimap as pulsing red markers (larger for siege engines). Hold the pointer over a unit, structure, build item or job for 2 seconds to see its details. While a build tool is active a gold banner at the bottom shows it; right-click or Esc cancels.
- During a siege you can still build walls, gates, battlements, siege weapons, houses and tents, and train soldiers. Farms, quarries, mines and bloomeries can only be built in the build phase.
- Enemies march in **formations** based on medieval practice. Battles form up with infantry in front, knights behind them, archers at the rear and cavalry on the wings. Each battle halts out of bowshot, then the foot storm the walls under archer cover while the cavalry waits for a breach. Siege engines advance in a guarded train, rams and towers come with escorts, and boats raid across moats.
- Enemies raid anything left **outside your walls**, including farms, quarries, mines and bloomeries, and their catapults target them too. Inside the castle they attack homes, units and castle structures. Raided farms, quarries, mines, bloomeries and lumber mills lose health and can be destroyed; Builders repair them.
- **Moats** stop enemies from simply wading in. A host facing a moat it can't get round halts and brings **engineers** and **boats**. Engineers build covered bridges (they take reduced damage while working, but catapults, stones and tentacle monsters can smash the bridge and drown anyone on it) or slowly shovel the moat full of dirt. Covered bridges are burnt after each siege.
- **Ditchers** are dispatched to the nearest marked tiles they can actually reach, and never dig a tile that would flood or trap a worker or cut the Keep off.
- **Food Storage** (Y) raises the food cap by 800 (the Keep holds 800). Food over the cap spoils, shown as food/cap in the top bar.
- **Stables** (J) let you raise horses (40 food, 10 lumber each, up to 4 per Stables). Give horses to any job with the horse column (− / +) of the Subjects table, which appears once you have Stables: riders move 1.6× faster, and Knights become **Mounted Knights** (more health, harder hits, much faster). A horse goes back to the stables when its rider changes job, and dies with its rider. Lose your Stables and the extra horses run off.
- **Builders** keep repairing walls inside the castle during sieges. Builders already working on castle works that may be built during a siege (walls, gates, battlements, engines, houses…) carry on when the recall sounds instead of sheltering.
- **All to Keep** (toolbar) calls everyone — workers, builders and soldiers, wherever they are — into the Keep. Press **Release all** to send them back out.
- Woodcutters, quarry workers and miners carry their loads back to the Keep (8 stone or 12 ore per trip) before the resources count. Woodcutters fell the trees nearest the Keep first, one woodcutter per tree. Trenches are marked out and then dug over time by **Ditchers**.
- **Medical tents** with **Medics** heal injured subjects. More tents and more medics heal faster.
- Soldiers (archers, light infantry, knights) can only be trained once you have a **Barracks** (N). Each barracks adds 6 to a separate soldier cap, and new soldiers muster beside a random barracks.
- A subject who moves between a civil job and a soldier job must wait one full round before starting the new role.
- **Beasts**: giant spiders lurk in forests and trolls lurk by mountains. Dire wolves den in forests in packs of 3–4. They are fast, chase far, and when one finds prey the whole pack joins in. Wyverns nest on mountain peaks. They fly over walls, water and rock, and can snatch archers off battlements, but any archer in range shoots back. They attack anyone, friend or foe, who comes near. Each roams within a territory around its lair (a faint red circle, highlighted when you hover the beast). Wall one in and it may guard your castle, but it may also eat your builders.
  - Each beast is male (blue ♂) or female (pink ♀). When a male and female of the same kind come within reach of each other (a ♥ shows), they produce a young every 2 minutes. The young is smaller, with about a third of the health and bite, and grows up after 2 minutes. A newly grown beast can't breed until after the next siege. Each lair holds at most 6 beasts (8 for a wolf den). Starting wolf packs can't breed until after the first siege.
- You **lose** if your King or Queen is slain or captured, all subjects are gone, or every structure is destroyed. You **win** by surviving 10 sieges.
- There must always be a way out of the castle: a gap, a gate (2×1, placed into an existing wall), an **Iron Gate** (same footprint, costs 60 iron plus lumber and stone, but over three times as strong), or a drawbridge. Select any gate to rotate it with the ⟳ button. Subjects shelter in the keep during sieges. Subjects never walk across water or through walls; they go round, or through gates, bridges and lowered drawbridges.
- Select a drawbridge to raise or lower it whenever you like (or all of them at once). It can't be raised while enemies are standing on it (raising all skips those sections). Drawbridges lower automatically after each siege. A drawbridge can be built on dry land; a trench is dug beneath it automatically. Drag to build a drawbridge up to 2 wide × 3 long; adjacent sections join into one bridge. It always hinges at the end nearest a gate and pulls up toward it. Square bridges can be rotated. The **Raise/Lower bridges** button in the top bar raises or lowers all of them.
- Houses set the **subject cap** (shown as subjects/cap in the top bar). They bring in new subjects when there is spare housing and food. If you are over the cap, a homeless subject leaves every 30 seconds.
- When food runs out, one subject starves every 30 seconds until you have food again.
- **Lumber Mill** (7) must stand beside a flowing river; its water wheel turns with the current. Millers turn 2 lumber into 1 processed lumber, which trebuchets (and future advanced structures) require. Rivers show their direction of flow. Every realm has at least one river: if the 256×256 area around your Keep has none, one is carved through it, away from the Keep site.
- Walls, gates and bridges can run diagonally; diagonal walls seal the castle and carry battlements.
- Dig trenches. A trench that touches a lake or river floods and becomes a moat. A trench dug into a lake or the sea takes on that water's colour. Ditchers can stand on marked ground that is still dry, and they plan the digging order so no marked tile is cut off. A strip of land is dug from its tip back to the shore. Tentacle monsters (lakes) and **crocodiles** (rivers) may swim into a connected moat. Both attack anyone, friend or foe, in the water, including boats. Tentacles also grab units right at the water's edge. Neither can reach units on bridges or drawbridges; crocodiles swim underneath them, showing only as a dark shape. Your people keep one tile back from the shore near a tentacle monster unless there's no other way.
- **Fill with Soil** (L) marks trench or water tiles. Ditchers fill them in with dirt, working inward from the shore. Filled ground grasses over after about 4 minutes. Felled trees leave stumps that sprout saplings after about 5 minutes and become trees again about 5 minutes later, unless something is built there.
- Terrain work is hungry work: marking a trench costs 2 food per tile, filling costs 3, and demolishing a structure eats 3 food (you can always sell, even with none). Workers at a sold building become unassigned. Cancelling a planned tile refunds its food.
- **Explosives Research** (U) lets you train **Demolition** crews and use **Plant Explosives** (P). On open ground, a charge becomes a buried trap that blows up the first enemies to step near it. On a mountain or rock-patch tile, a charge blasts nearby mountain and rock into open dirt and gives 10 stone per tile.
- **High ground** extends range: every level a shooter stands above its target adds 12% range (up to +48%), and a wall counts as two extra levels. Archers on battlements outrange archers on the ground. This works for enemy archers, ballistas and siege engines too. There is no penalty for shooting uphill.
- **Siege engines on the walls**: place a catapult on any finished battlement, or a trebuchet on a 2×2 block of battlements (a thick wall). Builders haul it up, and it then fires from the walls with the height bonus; the range ring shows its boosted reach. Click the wall to see the engine. Before it's finished, Cancel gives a full refund; once built, Demolish takes it down for a half refund and leaves the wall standing. If a wall under it, or its battlements, is destroyed, the engine crashes down and is lost.
- Catapults have a minimum range of 3 tiles and trebuchets 8 tiles, and enemy siege engines have minimums too. The dead zone is shown as a red inner ring.
- Ordinary enemies can't damage stone walls, but they can break gates. Bridges and drawbridges can't be destroyed by enemies; a raised drawbridge simply blocks them. Rams, catapults and trebuchets can breach walls. Ladders, siege towers and boats get around them.
- Mounted knights can't climb ladders, but they can use siege towers. Ladders have hit points: archers on nearby battlements shove them down, and infantry and knights hack at them from inside. Anyone still climbing falls.
- **Command soldiers**: click a soldier, or drag a box to select every soldier inside it (Shift adds or removes). Right-click the map to send them to attack there: they go after siege engines first, then any enemy near the spot, and hold that ground until you click **Return to duty**. Archers given an order leave their battlements. Orders end when a siege is over.
- After winning, choose **Endless mode** to keep playing ever-larger sieges.
- Click a battlement and choose **Assign archer** to station a free archer there (it climbs up from any walkable tile beside the wall, inside or outside). Click a manned battlement and choose **Unassign archer** to send it away; that battlement then stays empty until you assign one again.

## Controls

| Input | Action |
|---|---|
| Left click / drag | Build (walls, gates, bridges and trenches drag diagonally, then straight; hold Shift for an L corner) · select · box-select soldiers |
| Right click | Cancel tool · send selected soldiers to attack · right/middle drag pans |
| WASD / arrows | Pan |
| Wheel, trackpad pinch, + / − | Smooth zoom |
| V | Rotate gate (gates also auto-align to the wall under the cursor) |
| God button | Toggle god mode for testing: invincible, unlimited resources |
| Hotkeys (H, E, N, F, Q, M, O, W, B, G, D, R, C, T, X, L, Z, U, P, Y, J) | Pick a building/tool |
| Delete / Backspace | Cancel the selected queued build (full refund) |
| Esc | Cancel · close the menu |
| Space | Pause |
| 1, 2, 3 | Game speed |
| K / Home | Centre on the King |
| Jobs table − / + | Assign subjects (Shift = ×5) |

## Code

Plain `<script>` files share a global `K` namespace. All art is generated procedurally.

- `js/map.js`: map generation
- `js/world.js`: placement, pathing and flow fields
- `js/game.js`: phases and economy
- `js/units.js`: friendly AI and combat
- `js/menu.js`: pause menu, settings and saved seeds
- `js/enemies.js`: enemies, monsters and projectiles
- `js/army.js`: enemy army planning, formations and squad tactics
- `js/beasts.js`: spiders and trolls
- `js/sprites.js`, `js/render.js`: art and rendering
- `js/ui.js`: interface and input
- `js/defs.js`: balance numbers
