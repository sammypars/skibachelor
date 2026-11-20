// Mt. Bachelor map data.
//
// Everything here is read off the official trail map (reference/trail-map.webp,
// 726 x 544 px). Positions are trail-map pixel coordinates [u, v]; the
// projection in ../world/projection.js turns them into 3D world positions.
// Elevations are in feet (real-world values where known).
//
// To "dial in" the map: nudge a pixel coordinate or an elevation here and
// reload. Nothing else needs to change.

export const FT = 0.3048;

export const TRAIL_MAP = {
  src: './reference/trail-map.webp',
  width: 726,
  height: 544,
};

// The trail map is painted looking roughly south at the mountain from the
// north: east is on the left, west on the right, the summit near the top.
// These numbers describe that painted "camera" so pixels can be unprojected.
export const PROJECTION = {
  summitPx: [348, 72],
  summitElevFt: 9065,
  pxPerMeter: 0.142, // horizontal scale at the summit's depth
  viewPitchDeg: 35, // how steeply the painter looks down on the mountain
  perspFar: 0.8, // scale factor at the top edge of the map
  perspNear: 1.25, // scale factor at the bottom edge of the map
};

// type: 'express' = detachable high-speed quad, 'fixed' = fixed-grip chair
export const LIFTS = [
  {
    id: 'pine-marten',
    name: 'Pine Marten Express',
    type: 'express',
    bottomPx: [360, 442],
    topPx: [386, 251],
    bottomFt: 6330,
    topFt: 7775,
  },
  {
    id: 'summit',
    name: 'Summit Express',
    type: 'express',
    bottomPx: [238, 246],
    topPx: [318, 88],
    bottomFt: 7620,
    topFt: 9000,
  },
  {
    id: 'red',
    name: 'Red Chair',
    type: 'fixed',
    color: '#c8262c',
    bottomPx: [381, 449],
    topPx: [402, 311],
    bottomFt: 6320,
    topFt: 7050,
  },
  {
    id: 'skyliner',
    name: 'Skyliner Express',
    type: 'express',
    bottomPx: [235, 449],
    topPx: [318, 256],
    bottomFt: 6200,
    topFt: 7640,
  },
  {
    id: 'little-pine',
    name: 'Little Pine',
    type: 'fixed',
    bottomPx: [332, 436],
    topPx: [304, 391],
    bottomFt: 6330,
    topFt: 6560,
  },
  {
    id: 'sunrise',
    name: 'Sunrise Express',
    type: 'express',
    bottomPx: [152, 342],
    topPx: [230, 230],
    bottomFt: 6400,
    topFt: 7400,
  },
  {
    id: 'rainbow',
    name: 'Rainbow',
    type: 'fixed',
    bottomPx: [104, 325],
    topPx: [180, 240],
    bottomFt: 6250,
    topFt: 7080,
  },
  {
    id: 'cloudchaser',
    name: 'Cloudchaser Express',
    type: 'express',
    bottomPx: [19, 270],
    topPx: [242, 134],
    bottomFt: 6250,
    topFt: 8050,
  },
  {
    id: 'outback',
    name: 'Outback Express',
    type: 'express',
    bottomPx: [592, 391],
    topPx: [405, 239],
    bottomFt: 5850,
    topFt: 7700,
  },
  {
    id: 'northwest',
    name: 'Northwest Express',
    type: 'express',
    bottomPx: [703, 360],
    topPx: [451, 158],
    bottomFt: 6150,
    topFt: 8350,
  },
];

// Base areas and lodges. `size` is the footprint of the whole complex
// (width, depth, height in meters); `buildings` are laid out in local meters
// around the anchor (+z = downhill / north side, -z = uphill / slope side).
// Styles: hall (main lodge, timber + stone, big windows), aframe (glass
// gable front), wing, shed, garage (with snowcats), hut.
export const LODGES = [
  {
    id: 'west-village',
    name: 'West Village Lodge',
    px: [352, 458],
    elevFt: 6300,
    size: [190, 100, 16],
    yawDeg: 8,
    buildings: [
      { style: 'aframe', x: 0, z: 0, w: 54, d: 30, h: 15, deck: -1 },
      { style: 'wing', x: -44, z: 5, w: 30, d: 22, h: 11 },
      { style: 'wing', x: 42, z: 7, w: 28, d: 20, h: 10 },
      { style: 'shed', name: 'Rentals', x: -34, z: 46, w: 24, d: 14, h: 7 },
      { style: 'shed', name: 'Guest services', x: 30, z: 48, w: 18, d: 12, h: 6 },
      { style: 'hut', x: 6, z: 42, w: 7, d: 5, h: 4 },
      { style: 'garage', x: 88, z: 30, w: 30, d: 16, h: 8, yawDeg: 12, snowcats: 3 },
    ],
  },
  {
    id: 'pine-marten-lodge',
    name: "Pine Marten Lodge 7,775'",
    px: [362, 240],
    elevFt: 7775,
    size: [150, 90, 17],
    yawDeg: 0,
    buildings: [
      { style: 'aframe', x: 0, z: 0, w: 46, d: 28, h: 17, deck: 1 },
      { style: 'wing', x: -34, z: -4, w: 24, d: 20, h: 12 },
      { style: 'hall', name: 'Ski patrol', x: 44, z: -22, w: 16, d: 11, h: 7 },
      { style: 'shed', name: 'Lift maintenance', x: -46, z: 30, w: 18, d: 11, h: 6 },
      { style: 'hut', x: 30, z: 30, w: 6, d: 5, h: 4 },
      { style: 'garage', x: 62, z: 18, w: 22, d: 14, h: 7, yawDeg: -8, snowcats: 2 },
    ],
  },
  {
    id: 'sunrise-lodge',
    name: 'Sunrise Lodge',
    px: [146, 360],
    elevFt: 6400,
    size: [150, 90, 13],
    yawDeg: -25,
    buildings: [
      { style: 'hall', x: 0, z: 0, w: 44, d: 24, h: 12, deck: -1 },
      { style: 'wing', x: 32, z: 4, w: 20, d: 16, h: 9 },
      { style: 'shed', name: 'Rentals', x: -30, z: 34, w: 16, d: 11, h: 6 },
      { style: 'garage', x: -62, z: -6, w: 24, d: 14, h: 8, yawDeg: 6, snowcats: 2 },
    ],
  },
  {
    id: 'nordic',
    name: 'Nordic Center',
    px: [430, 478],
    elevFt: 6280,
    size: [60, 40, 9],
    yawDeg: 20,
    buildings: [
      { style: 'hall', x: 0, z: 0, w: 26, d: 15, h: 9, deck: -1 },
      { style: 'shed', name: 'Nordic rentals', x: 22, z: 16, w: 12, d: 9, h: 5 },
      { style: 'hut', x: -18, z: 14, w: 5, d: 4, h: 3.5 },
    ],
  },
  {
    id: 'summit-hut',
    name: "Summit 9,065'",
    px: [348, 72],
    elevFt: 9065,
    size: [8, 6, 5],
    yawDeg: 0,
    buildings: [],
  },
];

// Groomed cross-country loops that leave from the Nordic Center into the
// flatter forest west of West Village. Each is a closed, wobbly loop:
// center offset from the Nordic lodge (meters, +x west, +z north), radii,
// and how much it meanders.
export const NORDIC_TRAILS = [
  { name: 'Short loop', dx: 220, dz: 160, rx: 210, rz: 150, wobble: 40, width: 9 },
  { name: 'Middle loop', dx: 620, dz: 260, rx: 520, rz: 330, wobble: 70, width: 8 },
  { name: 'Long loop', dx: 1150, dz: 380, rx: 900, rz: 520, wobble: 110, width: 7 },
];

// Cascade Lakes Highway, running along the bottom of the trail map.
export const ROADS = [
  {
    id: 'cascade-lakes-hwy',
    width: 11,
    px: [
      [0, 356], [60, 380], [120, 405], [180, 432], [235, 462],
      [290, 492], [340, 515], [400, 535], [440, 544],
    ],
  },
  { id: 'sunrise-access', width: 8, px: [[95, 398], [118, 384], [140, 372]] },
  { id: 'west-village-access', width: 9, px: [[318, 506], [336, 488], [352, 474]] },
];

export const PARKING = [
  { id: 'west-village-lot', px: [372, 486], size: [260, 110], yawDeg: 22 },
  { id: 'west-village-lot-2', px: [300, 472], size: [150, 70], yawDeg: 28 },
  { id: 'sunrise-lot', px: [120, 372], size: [170, 80], yawDeg: 24 },
];

// Landforms that are not part of the main volcanic cone.
export const FEATURES = [
  // Small cinder cone west of West Village ("The Cone" on the map).
  { id: 'cinder-cone', px: [425, 388], elevFt: 6500, height: 55, radius: 210, crater: true },
  // Tumalo Mountain, the forested peak across the highway (bottom-left of map).
  { id: 'tumalo', px: [40, 472], elevFt: 6200, height: 330, radius: 1150, crater: false },
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

export const TREELINE_M = 2400; // about 7,875 ft
