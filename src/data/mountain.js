// Mt. Bachelor map data.
//
// The ground is real elevation data and the lifts, runs, buildings, roads,
// parking, Nordic trails and lakes are real OpenStreetMap geometry, baked by
// tools/fetch-geo.mjs into src/data/geo/. This file adds what that data does
// not say: lift types and colors, labels, building styles, and how the
// painted trail map lines up.
//
// World axes (meters): +x = west, +z = north, +y = elevation above sea level.
// The summit is at x = 0, z = 0.

export const FT = 0.3048;

export const GEO = {
  origin: [-121.6886387, 43.9792838], // summit [lon, lat]
  terrain: {
    minX: -5200, // east edge (world +x is west)
    minZ: -3800, // south edge
    size: 10400,
    // Grid points per side, 7.5 m apart: bare-earth lidar (2009-2011 Oregon
    // Lidar Consortium, Deschutes; via NOAA Digital Coast), baked by
    // tools/bake-lidar.py.
    n: 1388,
    offset: 1000, // stored as uint16: h = offset + value * step
    step: 0.05,
  },
  // Fine lidar relief over the ski area (12 ft source pixels) that the 7.5 m
  // grid can't carry: detail.png, lit by the terrain shader.
  detail: {
    minX: -3800,
    minZ: -2400,
    size: 6800,
    n: 2048,
    scale: 0.025, // m per grey level, 128 = none
  },
  // Tree cover over the ski area, classified from USGS aerial imagery (public
  // domain): 0 = open ground, 255 = solid canopy. 4 m cells.
  trees: {
    minX: -3800,
    minZ: -2400,
    size: 6800,
    n: 1700,
  },
  // Real terrain around the map out to the horizon volcanoes: a detailed
  // ring (Broken Top, the Three Sisters) and a coarse one to Mt. Jefferson
  // and Diamond Peak. Zoom = Terrarium tile level sampled.
  region: {
    mid: { minX: -22000, minZ: -18000, size: 44000, n: 734, zoom: 11 },
    far: { minX: -70000, minZ: -70000, size: 160000, n: 641, zoom: 9 },
  },
};

export const TRAIL_MAP = {
  src: './reference/trail-map.webp',
  width: 726,
  height: 544,
};

// Chairlifts, matched to OpenStreetMap by `osm` name (bottom terminal is the
// first point of the line). type: 'express' = detachable, 'fixed' =
// fixed-grip.
export const LIFTS = [
  // terminal: the real terminal design (see render/lifts.js). pod =
  // Doppelmayr Uni-G rounded canopy, cld = Doppelmayr CLD-260 box canopy,
  // dline = Doppelmayr D-Line, enclosed = 1980s terminal buildings,
  // fixed = fixed-grip bullwheel. seats = chair size.
  { id: 'pine-marten', name: 'Pine Marten Express', osm: 'Pine Marten Express', type: 'express', terminal: 'pod', seats: 4 },
  { id: 'summit', name: 'Summit Express', osm: 'Summit Express', type: 'express', terminal: 'enclosed', seats: 4 },
  { id: 'red', name: 'Red Chair', osm: 'Red Chair', type: 'fixed', terminal: 'fixed', seats: 3, color: '#c8262c' },
  { id: 'skyliner', name: 'Skyliner Express', osm: 'Skyliner Express', type: 'express', terminal: 'dline', seats: 6 },
  { id: 'little-pine', name: 'Little Pine', osm: 'Little Pine', type: 'fixed', terminal: 'fixed', seats: 3 },
  { id: 'sunrise', name: 'Sunrise Express', osm: 'Sunrise Express', type: 'express', terminal: 'cld', seats: 4 },
  { id: 'rainbow', name: 'Rainbow', osm: 'Rainbow Chair', type: 'fixed', terminal: 'fixed', seats: 3 },
  { id: 'alpenglow', name: 'Alpenglow', osm: 'Alpenglow', type: 'fixed', terminal: 'fixed', seats: 3 },
  { id: 'early-riser', name: 'Early Riser', osm: 'Early Riser', type: 'fixed', terminal: 'fixed', seats: 2 },
  { id: 'cloudchaser', name: 'Cloudchaser Express', osm: 'Cloudchaser', type: 'express', terminal: 'pod', seats: 4 },
  { id: 'outback', name: 'Outback Express', osm: 'Outback Express', type: 'express', terminal: 'cld', seats: 4 },
  { id: 'northwest', name: 'Northwest Express', osm: 'Northwest Express', type: 'express', terminal: 'cld', seats: 4 },
];

// Named places. `osm` anchors a lodge to its real building footprint; `base`
// marks base areas (plowed roads and parking are kept near these).
export const LODGES = [
  { id: 'west-village', name: 'West Village Lodge', osm: 'West Village Lodge', base: true },
  { id: 'pine-marten-lodge', name: "Pine Marten Lodge 7,775'", osm: 'Pine Marten Lodge' },
  { id: 'sunrise-lodge', name: 'Sunrise Lodge', osm: 'Sunrise Lodge', base: true },
  { id: 'nordic', name: 'Nordic Center', osm: 'Mt. Bachelor Nordic Center', base: true },
  { id: 'summit-hut', name: "Summit 9,065'", at: [0, 0] },
];

// How to draw real building footprints, by OpenStreetMap name. Buildings not
// listed get a plain shed (or a hut if small). A building can also be made
// of `parts` laid out inside its footprint: dw/dd = share of the footprint's
// length/depth, dx/dz = offset as a share of it (+dz = downhill side).
// Styles: pineMarten, westVillage, sunrise, gateway (the real lodges), and
// generic hall, aframe, wing, shed, garage, hut. deck: the building's front
// (and its deck) faces downhill.
export const BUILDING_STYLES = {
  // Modelled on photos of the real buildings (see render/buildings.js).
  'Pine Marten Lodge': { style: 'pineMarten', h: 22, deck: true },
  'West Village Lodge': { style: 'westVillage', h: 12, deck: true },
  'Sunrise Lodge': { style: 'sunrise', h: 15, deck: true },
  'Mountain Gateway': { style: 'gateway', h: 9, deck: true },
  'Mt. Bachelor Nordic Center': { style: 'hall', h: 8, deck: true },
  'Guest Services': { style: 'shed', h: 7 },
  'Bachelor Butte Administrative Building': { style: 'shed', h: 7 },
  'Junior Racing Center': { style: 'shed', h: 7 },
  'Mt. Bachelor Gravity Sports Yurt #1': { style: 'hut', h: 4.5 },
  'Mt. Bachelor Gravity Sports Yurt #2': { style: 'hut', h: 4.5 },
};

// Terrain parks, by OpenStreetMap run name. size picks the jump size;
// mix is the order features appear down the park (jumps run down one lane,
// rails and boxes down the other, `lane` meters either side of center).
// Woodward terrain parks, from mtbachelor.com's park guide: size rating, lift
// and the kinds of features each one is known for. Crews rebuild the parks
// many times a season, so the exact feature line is a plausible snapshot.
//
// `line` is the park top to bottom: each row is a set of features side by
// side, given as [type, variant, lateral offset in m (+ = right looking
// downhill)]. Jumps: xs/s/m/l/xl, and xxl (contest gap jumps). Rails: flat, down, dfd (down-flat-down),
// kink, rainbow. Boxes: flat, down, ride-on. 'roof' is a timber A-frame jib.
export const PARKS = {
  'Pacific City': {
    size: 'M/L', lift: 'Skyliner', note: 'First park to open each season',
    line: [
      [['rail', 'flat', -8], ['box', 'flat', 0], ['rail', 'down', 8]],
      [['jump', 'm', -6], ['jump', 'l', 6]],
      [['battleship', 'm', -7], ['roof', 'a', 0], ['wallride', 'r', 7]],
      [['jump', 'm', -6], ['jump', 'l', 6]],
      [['rail', 'dfd', -6], ['box', 'down', 6]],
      [['jump', 'l', 0]],
      [['rail', 'kink', -5], ['rail', 'flat', 5]],
    ],
  },
  'The Point': {
    size: 'L', lift: 'Skyliner', note: 'Biggest jumps and rails on the mountain',
    // Three contest-size gap jumps in a row off a long drop-in, then the big
    // rails and a lower jib and jump section. Built once, not repeated.
    once: true,
    inrun: 58,
    line: [
      [['jump', 'xxl', 0]],
      [['jump', 'xxl', 0]],
      [['jump', 'xxl', 0]],
      [['rail', 'dfd', -7], ['rail', 'kink', 7]],
      [['rail', 'rainbow', -6], ['box', 'down', 6]],
      [['hip', 'r', -4, 'l']],
      [['jump', 'l', -6], ['jump', 'm', 6]],
      [['rail', 'flat', -6], ['battleship', 'm', 0], ['box', 'flat', 6]],
      [['jump', 'l', 0]],
    ],
  },
  'Canon Beach': {
    label: 'Cannon Beach', size: 'M/L', lift: 'Skyliner', note: 'Flowy jump lines, rails and boxes',
    // Up top: three big jumps in a row. Then the flowy lower half.
    once: true,
    inrun: 70,
    line: [
      [['jump', 'xl', 0]],
      [['jump', 'xl', 0]],
      [['jump', 'xl', 0]],
      [['box', 'flat', -6], ['rail', 'down', 6]],
      [['berm', 'r', 2]],
      [['jump', 'm', -2]],
      [['rail', 'flat', -6], ['roof', 'a', 0], ['box', 'down', 6]],
      [['berm', 'l', -2]],
      [['jump', 'l', 0]],
      [['hip', 'r', -4]],
    ],
  },
  Seaside: {
    size: 'M', lift: 'Skyliner', note: 'Medium rails, flowy jumps and hips',
    line: [
      [['rail', 'flat', -6], ['box', 'flat', 6]],
      [['jump', 'm', 0]],
      [['hip', 'l', 5]],
      [['rail', 'down', -7], ['roof', 'a', 0], ['rail', 'dfd', 7]],
      [['jump', 'm', 0]],
      [['hip', 'r', -5]],
    ],
  },
  'Peace Park': {
    size: 'S/M/L', lift: 'Pine Marten', note: 'Transition, creativity, flow and fun (with Danny Davis)',
    line: [
      [['qp', 'up', -7], ['berm', 'r', 6]],
      [['bus', 'vw', -5], ['log', 'log', 7]],
      [['roof', 'a', -4], ['roof', 'a', 4]],
      [['wave', 'r', 2]],
      [['spine', 's', 0]],
      [['berm', 'l', -4], ['jump', 's', 7]],
      [['log', 'log', -6], ['qp', 'up', 6]],
      [['wave', 'l', -2]],
    ],
  },
  'Short Sands': {
    size: 'S/M', lift: 'Sunrise', note: 'Rails, boxes and small to medium jumps',
    line: [
      [['box', 'flat', -5], ['box', 'flat', 5]],
      [['jump', 's', -5], ['jump', 'm', 5]],
      [['rail', 'flat', -5], ['box', 'down', 5]],
      [['jump', 's', -5], ['jump', 'm', 5]],
      [['rail', 'down', 0]],
    ],
  },
  'Rainbow Adventure Zone': {
    label: 'Adventure Zone', size: 'XS', lift: 'Rainbow', note: 'Berms, rolls, small hips and banks',
    line: [
      [['rollers', 'xs', 0]],
      [['berm', 'r', 2]],
      [['hip', 'l', 3, 'xs']],
      [['berm', 'l', -2]],
      [['rollers', 'xs', 0]],
      [['berm', 'r', 2]],
    ],
  },
  'Start Park': {
    size: 'XS', lift: 'Early Riser', note: 'Snow playground; contours control speed',
    line: [
      [['rollers', 'xs', 0]],
      [['berm', 'l', -1]],
      [['box', 'ride-on', 0]],
      [['berm', 'r', 1]],
      [['rollers', 'xs', 0]],
    ],
  },
  'Progression Park': {
    size: 'XS/S', lift: 'Little Pine', note: 'Small rollers and banked turns',
    line: [
      [['rollers', 'xs', 0]],
      [['berm', 'r', 2]],
      [['jump', 'xs', -3], ['box', 'ride-on', 4]],
      [['berm', 'l', -2]],
      [['rollers', 'xs', 0]],
    ],
  },
  // Tree runs with natural whoops (Woodward "Adventure Zones").
  'Dilly Dally Alley': { kind: 'whoops' },
  'Enchanted Forest': { kind: 'whoops' },
  // 13' mini pipe under Pine Marten in West Village.
  Halfpipe: { kind: 'pipe', label: 'Half Pipe', size: 'M', lift: 'Pine Marten', wall: 13 },
};

// Woodward parks not in OpenStreetMap: laid out beside their lift line.
export const EXTRA_PARKS = [
  { name: 'Start Park', lift: 'early-riser', offset: 32, from: 0.08, to: 0.92, width: 30 },
  { name: 'Progression Park', lift: 'little-pine', offset: 34, from: 0.06, to: 0.94, width: 30 },
];

// Race courses on Cliffhanger, top to bottom (fractions of its length): a GS
// on the skier's left and a slalom on the right, side by side, inside one
// B-net corridor with a shared start and finish. Lanes and offsets are
// meters from the run's centerline (+ = right looking downhill).
export const RACE = {
  run: 'Cliffhanger',
  from: 0.03,
  to: 0.96,
  fence: 21,
  gs: { lane: -8, gateSpacing: 27, offset: 5.5 },
  // Slalom: single poles, tighter rhythm, with the odd hairpin and flush.
  slalom: { lane: 9, gateSpacing: 11, offset: 2.6, combos: 9 },
};

// Named high points for labels; snapped to the highest ground within
// `search` meters.
export const LANDMARKS = [{ name: 'Tumalo Mountain', at: [-3680, 2880], search: 300 }];

// Where each lift's terminals sit on the painted trail map (pixels), used to
// fit the trail-map overlay to the real world.
export const TRAIL_MAP_TIES = [
  { lift: 'pine-marten', bottomPx: [360, 442], topPx: [386, 251] },
  { lift: 'summit', bottomPx: [238, 246], topPx: [318, 88] },
  { lift: 'red', bottomPx: [381, 449], topPx: [402, 311] },
  { lift: 'skyliner', bottomPx: [235, 449], topPx: [318, 256] },
  { lift: 'little-pine', bottomPx: [332, 436], topPx: [304, 391] },
  { lift: 'sunrise', bottomPx: [152, 342], topPx: [230, 230] },
  { lift: 'rainbow', bottomPx: [104, 325], topPx: [180, 240] },
  { lift: 'cloudchaser', bottomPx: [19, 270], topPx: [242, 134] },
  { lift: 'outback', bottomPx: [592, 391], topPx: [405, 239] },
  { lift: 'northwest', bottomPx: [703, 360], topPx: [451, 158] },
];

// Surrounding Cascade peaks, placed by real latitude/longitude relative to
// the summit (1 km = 1000 units). World axes: +x = west, +z = north.
// shape: 'cone' (symmetric volcano), 'jagged' (eroded, like Broken Top),
// 'shield' (broad and gentle), 'butte' (small forested cinder cone).
export const DISTANT_PEAKS = [
  { name: 'Broken Top', x: 800, z: 11500, elevFt: 9175, radius: 3800, shape: 'jagged' },
  { name: 'South Sister', x: 6400, z: 13800, elevFt: 10358, radius: 5200, shape: 'cone' },
  { name: 'Middle Sister', x: 7500, z: 18900, elevFt: 10047, radius: 4200, shape: 'cone' },
  { name: 'North Sister', x: 6700, z: 20800, elevFt: 10085, radius: 4200, shape: 'jagged' },
  { name: 'Mt. Washington', x: 12000, z: 39000, elevFt: 7795, radius: 3200, shape: 'jagged' },
  { name: 'Three Fingered Jack', x: 12400, z: 55500, elevFt: 7841, radius: 3600, shape: 'jagged' },
  { name: 'Mt. Jefferson', x: 8900, z: 77000, elevFt: 10497, radius: 7500, shape: 'cone' },
  { name: 'Black Crater', x: 6800, z: 33600, elevFt: 7251, radius: 3000, shape: 'shield' },
  { name: 'Ball Butte', x: -400, z: 9300, elevFt: 7807, radius: 1800, shape: 'butte' },
  { name: 'Kwolh Butte', x: -5600, z: 6600, elevFt: 6200, radius: 1300, shape: 'butte' },
  { name: 'Sheridan Mountain', x: 3300, z: -6500, elevFt: 6570, radius: 1500, shape: 'butte' },
  { name: 'Maiden Peak', x: 25800, z: -39000, elevFt: 7818, radius: 5000, shape: 'shield' },
  { name: 'Diamond Peak', x: 36800, z: -51000, elevFt: 8744, radius: 6000, shape: 'jagged' },
  { name: 'Paulina Peak', x: -35000, z: -32000, elevFt: 7984, radius: 9000, shape: 'shield' },
];

// Cascade Lakes, by real position relative to the summit. In winter these
// are mostly frozen at the edges. size = [length, width] in meters.
export const LAKES = [
  { name: 'Sparks Lake', x: 3800, z: 4100, size: [1700, 900], yawDeg: -30, elevFt: 5430 },
  { name: 'Todd Lake', x: -400, z: 5600, size: [480, 330], yawDeg: 15, elevFt: 6150 },
  { name: 'Devils Lake', x: 6200, z: 6000, size: [420, 260], yawDeg: 40, elevFt: 5450 },
  { name: 'Green Lakes', x: 3800, z: 11700, size: [500, 300], yawDeg: 0, elevFt: 6500 },
  { name: 'Elk Lake', x: 9400, z: -300, size: [1900, 1100], yawDeg: 10, elevFt: 4884 },
  { name: 'Hosmer Lake', x: 7900, z: -2700, size: [2300, 380], yawDeg: 15, elevFt: 4966 },
  { name: 'Lava Lake', x: 6200, z: -7300, size: [1300, 900], yawDeg: -20, elevFt: 4750 },
  { name: 'Little Lava Lake', x: 5500, z: -7900, size: [600, 400], yawDeg: 0, elevFt: 4750 },
  { name: 'Cultus Lake', x: 11800, z: -15900, size: [3400, 1300], yawDeg: 35, elevFt: 4690 },
  { name: 'Crane Prairie Reservoir', x: 2000, z: -20500, size: [5200, 3000], yawDeg: 0, elevFt: 4450 },
];

export const TREELINE_M = 2380; // about 7,800 ft: open snow above Pine Marten Lodge
