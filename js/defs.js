'use strict';
// Game data: structures, jobs, unit stats and wave composition.
(function () {
  K.BUILD_TIME = 300;
  K.RECALL_TIME = 20;
  K.ROUNDS = 10;
  K.DEFENSE_TIME = [360, 360, 420, 420, 480, 480, 540, 540, 600, 600];

  K.SDEF = {
    keep: { name: 'Keep', w: 3, h: 3, hp: 3000, cost: {}, stone: true, housing: 16, store: { food: 400, lumber: 400, plank: 100, stone: 400, ore: 150, iron: 150 }, desc: 'Home of your King. Shelters subjects during sieges.' },
    house: { name: 'House', w: 2, h: 2, hp: 250, cost: { lumber: 30, stone: 10 }, housing: 6, cat: 'village', key: 'h', desc: 'Raises your subject cap by 6. New people arrive while you are under the cap and have food.' },
    barracks: { name: 'Barracks', w: 3, h: 2, hp: 600, cost: { lumber: 60, stone: 40 }, soldiers: 6, cat: 'units', key: 'n', desc: 'Required to train soldiers. Each barracks raises your soldier cap by 6. New soldiers muster at a random barracks.' },
    tent: { name: 'Medical Tent', w: 2, h: 2, hp: 200, cost: { lumber: 40, stone: 10 }, slots: 2, cat: 'village', key: 'e', desc: 'Medics heal wounded subjects and soldiers. More tents and medics heal faster.' },
    explosives: { name: 'Explosives Research', w: 2, h: 2, hp: 300, cost: { lumber: 80, stone: 60, iron: 20 }, cat: 'village', key: 'u', desc: 'Black-powder workshop. Lets you train Demolition crews and plant explosives: traps for the enemy, or charges that blast mountains into stone and open ground.' },
    stables: { name: 'Stables', w: 3, h: 2, hp: 320, cost: { lumber: 70, stone: 20 }, horses: 4, cat: 'village', key: 'j', desc: 'Raise horses (up to 4 per Stables). Horses speed up any job, and turn Knights into Mounted Knights. Manage them from the Stables panel.' },
    granary: { name: 'Food Storage', w: 2, h: 2, hp: 260, cost: { lumber: 40, stone: 20 }, store: { food: 400 }, cat: 'storage', key: 'y', desc: 'A granary and smokehouse. Raises the most food you can hold by 400 (the Keep holds 400). Food beyond the cap spoils.' },
    lumberyard: { name: 'Lumber Storage', w: 2, h: 2, hp: 240, cost: { lumber: 30, stone: 10 }, store: { lumber: 400, plank: 200 }, cat: 'storage', key: '4', desc: 'A covered timber yard. Raises the most lumber you can hold by 400 and processed lumber by 200 (the Keep holds 400 lumber and 100 processed lumber). Any surplus is lost.' },
    stoneyard: { name: 'Stone Storage', w: 2, h: 2, hp: 320, cost: { lumber: 40 }, store: { stone: 400 }, cat: 'storage', key: '5', desc: 'A walled stone yard. Raises the most stone you can hold by 400 (the Keep holds 400). Stone beyond the cap is lost.' },
    metalstore: { name: 'Metal Storage', w: 2, h: 2, hp: 360, cost: { lumber: 30, stone: 40 }, store: { ore: 150, iron: 150 }, cat: 'storage', key: '6', desc: 'A locked strongroom for raw ore and iron. Raises the most iron ore and iron you can each hold by 150 (the Keep holds 150 of each). Any surplus is lost.' },
    farm: { name: 'Farm', w: 3, h: 3, hp: 150, cost: { lumber: 40 }, slots: 3, walkable: true, rule: 'grass', eco: true, cat: 'resources', key: 'f', desc: 'Farmers grow food. Must be built on grassland.' },
    quarry: { name: 'Stone Quarry', w: 2, h: 2, hp: 220, cost: { lumber: 40 }, slots: 3, rule: 'rock', eco: true, cat: 'resources', key: 'q', desc: 'Quarry workers cut stone. Must be built on a rock patch.' },
    mine: { name: 'Mine', w: 2, h: 2, hp: 300, cost: { lumber: 50, stone: 20 }, slots: 3, rule: 'mine', eco: true, cat: 'resources', key: 'm', desc: 'Miners dig iron ore. Must be built on a mountain mine site.' },
    bloomery: { name: 'Bloomery', w: 2, h: 2, hp: 300, cost: { lumber: 30, stone: 40 }, slots: 2, eco: true, cat: 'resources', key: 'o', desc: 'Smelters turn 2 iron ore + 1 lumber (fuel) into 1 iron.' },
    lumbermill: { name: 'Lumber Mill', w: 2, h: 2, hp: 300, cost: { lumber: 60, stone: 30 }, slots: 2, rule: 'river', eco: true, cat: 'resources', key: '7', desc: 'A water-powered sawmill. Millers turn 2 lumber into 1 processed lumber, needed for trebuchets and advanced works. Must be built beside a flowing river to turn its water wheel. Processed lumber is kept in Lumber Storage.' },
    wall: { name: 'Stone Wall', w: 1, h: 1, hp: 600, cost: { stone: 6 }, stone: true, drag: true, cat: 'defense', key: 'w', desc: 'Only siege engines can break stone walls. Drag to build a line.' },
    battlement: { name: 'Battlement', w: 1, h: 1, cost: { stone: 4 }, upgrade: true, drag: true, cat: 'defense', key: 'b', desc: 'Upgrade a wall: archers fight from the top, protected and with extra range.' },
    gate: { name: 'Gate', w: 2, h: 1, hp: 1400, cost: { lumber: 25, iron: 8 }, rotates: true, cat: 'defense', key: 'g', desc: 'A 2-wide gatehouse. Subjects pass, enemies must break it. Can replace wall sections; turns to match the wall (V rotates).' },
    drawbridge: { name: 'Drawbridge', w: 1, h: 1, hp: 1100, cost: { lumber: 25, iron: 5 }, rule: 'water', drag: true, cat: 'defense', key: 'd', desc: 'Built over water, a trench, or dry land (a trench is dug beneath it automatically). Drag to build up to 2 wide × 3 long; touching sections join into one bridge, hinged on the end nearest a gate. Select it to rotate it, or raise or lower it (or use the Bridges button in the top bar); it lowers itself after each siege so your people can go to work.' },
    bridge: { name: 'Bridge', w: 1, h: 1, hp: 140, cost: { lumber: 10 }, rule: 'water', walkable: true, drag: true, cat: 'defense', key: 'r', desc: 'A simple wooden crossing over water. Always open — to everyone.' },
    catapult: { name: 'Catapult', w: 1, h: 1, hp: 160, cost: { lumber: 60 }, range: 10, minRange: 3, reload: 4, ammo: 1, dmg: 45, splash: 1.3, cat: 'units', key: 'c', desc: 'Hurls stones (1 stone per shot) at enemies 3–10 tiles away. Cannot hit anything closer.' },
    trebuchet: { name: 'Trebuchet', w: 2, h: 2, hp: 260, cost: { lumber: 80, plank: 40, iron: 30 }, range: 18, minRange: 8, reload: 7, ammo: 2, dmg: 85, splash: 1.7, cat: 'units', key: 't', desc: 'Long range siege engine (2 stones per shot). Hits enemies 8–18 tiles away — useless against anything closer.' },
    keepdoor: { name: 'Keep door', w: 1, h: 1, hp: 900, cost: {}, desc: 'The great oak door of your Keep. Enemies must batter it down to reach the throne. Builders repair it.' },
    site: { name: 'Construction site', w: 1, h: 1, hp: 1, cost: {}, desc: 'Under construction.' },
    trench: { name: 'Dig Trench', w: 1, h: 1, cost: { food: 2 }, drag: true, terrain: true, cat: 'terrain', key: 'x', desc: 'Hard labour: 2 food per tile. Mark ground for Ditchers to excavate. Trenches touching a lake or river fill with water — a moat!' },
    fill: { name: 'Fill with Soil', w: 1, h: 1, cost: { food: 3 }, drag: true, terrain: true, cat: 'terrain', key: 'l', desc: 'Hard labour: 3 food per tile. Mark a trench, moat, river or lake tile for Ditchers to fill with earth. Water is filled from the shore inward.' },
    charge: { name: 'Plant Explosives', w: 1, h: 1, cost: { iron: 4, lumber: 4, food: 2 }, drag: true, charge: true, cat: 'terrain', key: 'p', desc: 'Needs Explosives Research. On open ground: a buried trap that blows up the first enemies to step near it. On a mountain tile: a blasting charge that clears the rock (+10 stone per tile). Demolition crews plant them.' },
    demolish: { name: 'Demolish', w: 1, h: 1, cost: { food: 3 }, tool: true, cat: 'terrain', key: 'z', desc: 'Remove any structure at any time (50% refund; the labour eats 3 food). Its workers become unassigned. Also cancels planned digging, filling or explosives.' },
  };

  K.LADDER_HP = 90;

  // Seconds of labour to finish each structure (one worker = 1 s of work per second).
  K.BUILD_SECS = { wall: 4, battlement: 4, bridge: 6, drawbridge: 8, house: 12, gate: 12, farm: 10, tent: 10, quarry: 15, granary: 15, lumberyard: 12, stoneyard: 12, metalstore: 15, catapult: 15, mine: 20, bloomery: 20, lumbermill: 20, explosives: 20, stables: 20, barracks: 25, trebuchet: 30 };

  // Footprint of a structure, swapping width and height when rotated.
  K.dims = function (type, rot) {
    const d = K.SDEF[type];
    return rot && d.rotates ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
  };

  K.JOBS = [
    { id: 'repair', name: 'Builders', icon: 'repair', desc: 'Build what you place (except farms, quarries, mines, bloomeries and lumber mills, which their own workers build), then repair damaged structures (repairs use stone).' },
    { id: 'wood', name: 'Woodcutters', icon: 'lumber', desc: 'Chop trees for lumber.' },
    { id: 'stone', name: 'Quarry workers', icon: 'stone', where: 'quarry', desc: 'Cut stone at quarries and carry 8-stone loads to the Keep.' },
    { id: 'ore', name: 'Miners', icon: 'ore', where: 'mine', desc: 'Dig iron ore at mines and carry 7-ore loads to the Keep.' },
    { id: 'smelt', name: 'Smelters', icon: 'iron', where: 'bloomery', desc: 'Smelt ore into iron.' },
    { id: 'mill', name: 'Millers', icon: 'plank', where: 'lumbermill', desc: 'Saw 2 lumber into 1 processed lumber at a Lumber Mill.' },
    { id: 'farm', name: 'Farmers', icon: 'food', where: 'farm', desc: 'Grow food on farms.' },
    { id: 'dig', name: 'Ditchers', icon: 'dig', desc: 'Dig the trenches you have marked.' },
    { id: 'medic', name: 'Medics', icon: 'medic', where: 'tent', desc: 'Heal wounded subjects and soldiers at Medical Tents.' },
    { id: 'demo', name: 'Demolition', icon: 'demo', needs: 'explosives', desc: 'Plant the explosives you have marked: traps on open ground, blasting charges on mountains.' },
    { id: 'archer', name: 'Archers', icon: 'archer', soldier: true, cost: { lumber: 10 }, desc: 'Shoot from battlements. Trained at a Barracks.' },
    { id: 'infantry', name: 'Light Infantry', icon: 'infantry', soldier: true, cost: { iron: 8 }, desc: 'Fight enemies inside the castle. Trained at a Barracks.' },
    { id: 'knight', name: 'Knights', icon: 'knight', soldier: true, cost: { iron: 20, food: 15 }, desc: 'Heavily armoured defenders. Trained at a Barracks.' },
  ];
  K.JOB = Object.fromEntries(K.JOBS.map((j) => [j.id, j]));
  // Resource buildings are raised by the workers assigned to them, not by Builders.
  K.SELF_BUILD = { farm: 'farm', quarry: 'stone', mine: 'ore', bloomery: 'smelt', lumbermill: 'mill' };
  K.selfBuilt = (s) => s.type === 'site' && !!K.SELF_BUILD[s.final];

  K.HORSE = { cost: { food: 40, lumber: 10 }, speed: 1.6 };
  K.RATES = { farm: 0.32, stone: 0.28, ore: 0.16, smeltTime: 5, millTime: 5, eat: 0.018, chopTime: 7, chopYield: 11, digTime: 6, heal: 1.4, plantTime: 4, fuse: 3, trapDmg: 130, trapR: 2, blastR: 1.5, blastStone: 10, loadTime: 20, stoneLoad: 8, oreLoad: 7 };

  K.UDEF = {
    king: { name: 'King', hp: 450, dmg: 20, range: 1.4, cd: 1, speed: 1.7, armor: 0.3 },
    subject: { name: 'Subject', hp: 45, dmg: 3, range: 1.2, cd: 1.3, speed: 3.5 },
    archer: { name: 'Archer', hp: 60, dmg: 14, range: 8, cd: 1.2, speed: 1.9, ranged: true },
    infantry: { name: 'Light Infantry', hp: 120, dmg: 12, range: 1.35, cd: 1, speed: 2.0, armor: 0.15 },
    knight: { name: 'Knight', hp: 230, dmg: 22, range: 1.45, cd: 1.1, speed: 1.7, armor: 0.35 },
    cavalry: { name: 'Mounted Knight', hp: 300, dmg: 28, range: 1.6, cd: 1.1, speed: 2.9, armor: 0.35 },

    e_infantry: { name: 'Infantry', hp: 70, dmg: 9, range: 1.35, cd: 1.1, speed: 1.9, cls: 'foot' },
    e_archer: { name: 'Archer', hp: 45, dmg: 7, range: 7.5, cd: 1.7, speed: 1.8, ranged: true, cls: 'foot' },
    e_knight: { name: 'Knight', hp: 140, dmg: 15, range: 1.45, cd: 1.2, speed: 1.6, armor: 0.3, cls: 'foot' },
    e_cavalry: { name: 'Mounted Knight', hp: 170, dmg: 18, range: 1.6, cd: 1.3, speed: 2.7, armor: 0.25, cls: 'horse', big: true },
    e_ladder: { name: 'Ladder Squad', hp: 75, dmg: 9, range: 1.35, cd: 1.1, speed: 1.6, cls: 'ladder' },
    e_engineer: { name: 'Engineer', hp: 90, dmg: 6, range: 1.3, cd: 1.4, speed: 1.6, armor: 0.2, cls: 'foot', engineer: true },
    e_boat: { name: 'Boat Raider', hp: 75, dmg: 9, range: 1.35, cd: 1.1, speed: 1.7, cls: 'boat' },
    e_ram: { name: 'Battering Ram', hp: 480, dmg: 90, range: 1.5, cd: 2.4, speed: 0.95, armor: 0.5, cls: 'foot', siege: 'ram', big: true },
    e_tower: { name: 'Siege Tower', hp: 650, dmg: 0, range: 0, cd: 1, speed: 0.8, armor: 0.5, cls: 'ladder', siege: 'tower', big: true },
    e_catapult: { name: 'Catapult', hp: 170, dmg: 55, range: 12, cd: 5, speed: 0.9, cls: 'foot', siege: 'catapult', splash: 1.3, minRange: 4, big: true },
    e_ballista: { name: 'Ballista', hp: 130, dmg: 40, range: 14, cd: 3.5, speed: 0.95, cls: 'foot', siege: 'ballista', big: true },
    e_trebuchet: { name: 'Trebuchet', hp: 230, dmg: 110, range: 20, cd: 8, speed: 0.7, cls: 'foot', siege: 'trebuchet', splash: 1.7, minRange: 9, big: true },
  };

  // Returns a list of enemy unit types for defensive round n (1..10).
  // enemy engineers: seconds to build one covered-bridge tile / fill one moat tile (the player digs a tile in 6 s)
  K.ENG = { bridge: 16, fill: 50, bridgeHp: 240 };

  K.waveComp = function (n, rand, diff) {
    const d = diff || 1;
    const list = [];
    const add = (t, c) => { c = d === 1 ? c : Math.round(c * d); for (let i = 0; i < c; i++) list.push(t); };
    const core = Math.round((12 + n * 9 + Math.floor(n * n * 1.1)) * d);
    const w = { e_infantry: 40, e_archer: 26, e_knight: 10 + n * 2.5, e_cavalry: 4 + n * 2.5 };
    const tot = Object.values(w).reduce((a, b) => a + b, 0);
    for (let i = 0; i < core; i++) {
      let r = rand() * tot;
      for (const k in w) { r -= w[k]; if (r <= 0) { list.push(k); break; } }
    }
    if (n >= 2) add('e_ladder', 2 + n);
    if (n >= 3) add('e_boat', n);
    if (n >= 3) add('e_ram', 1 + Math.floor(n / 3));
    if (n >= 4) add('e_catapult', Math.floor((n - 2) / 2));
    if (n >= 5) add('e_tower', Math.floor((n - 3) / 2));
    if (n >= 5) add('e_ballista', Math.floor((n - 3) / 2));
    if (n >= 7) add('e_trebuchet', n - 6);
    return list;
  };
})();
