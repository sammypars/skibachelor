# Ski Bachelor

A 3D skiing game set on Mt. Bachelor, Oregon: the real mountain (terrain,
runs, tree cover, lifts, lodges, the Woodward terrain parks, the half pipe
and a race course on Cliffhanger) and a skier you can ride yourself.

Play it live: https://sammypars.github.io/skibachelor/

## Run it

```bash
npm run dev
```

Then open http://localhost:5174. There is no build step. Three.js loads from
a CDN through the import map in `index.html`.

Controls:
- Drag to orbit, right-drag to pan, scroll to zoom
- `1`: trail-map view
- `L`: labels · `R`: run names
- `M`: trail map overlay. A yellow dot on the overlay shows where your cursor is.
- `F` or **Fly drone**: drone mode. Use `W` `A` `S` `D` to fly, `Space`/`E` to climb, `Q`/`C` to descend, drag to look (arrow keys also turn), `Shift` to boost, scroll to change speed, and `Esc` to land. It eases itself up over rising slopes.
- **Ride** in the lift list rides a chair to the top. `+`/`−` changes the ride speed and `Esc` hops off.
- `K` or **Ski it**: ski from the top of the run nearest the view. **Ski the parks** drops you into Pacific City.

Skiing:
- `A`/`D` (or `←`/`→`): carve on the snow, spin in the air
- `W` (or `↑`): tuck for speed (poles you along on the flats), frontflip in the air
- `S` (or `↓`): brake, backflip in the air. Spin and flip together for a cork.
- `Space`: hold to load, release to pop. Kickers launch you on their own; a loaded pop spins and flips faster.
- `Shift`: grab · `R`: back to your last good spot · `Esc`: stop skiing
- On a phone or tablet, use the on-screen pad and the **POP** button.

Let go of a spin or flip and it carries on to the next full 180 or full
flip, then stops. Land with your skis along your travel (forwards or
switch) and your feet under you, or you crash. The physics: gravity along
the real snow surface (terrain plus the shaped park snow), snow friction,
air drag (half as much in a tuck), ski edges that grip sideways so the skis
carve the velocity round, and a ballistic flight whenever the snow drops
away faster than gravity can follow (`src/ski.js`).

## How the map is built

The mountain is the real one. The ground is real elevation data, and the
lifts, runs, buildings, roads, parking lots, Nordic trails and lakes are real
OpenStreetMap geometry.

- `npm run geo` (`tools/fetch-geo.mjs`) downloads the data and bakes it into
  `src/data/geo/`. `terrain.bin` holds the elevation grid, from USGS 3DEP via
  AWS Terrain Tiles. `region-mid.bin` and `region-far.bin` hold the same
  data at 60 m and 250 m for the land out to the horizon volcanoes.
  `trees.bin` is real tree cover over the ski area, classified from USGS
  aerial imagery (public domain) at 4 m. `osm.json` holds the map features
  in world meters, from © OpenStreetMap contributors (ODbL). The baked files
  are committed, so the game itself needs no network beyond the Three.js
  CDN. Rerun it to pick up OpenStreetMap edits, or bake one part with
  `npm run geo -- osm|terrain|trees|region`.
- `src/data/mountain.js` adds what the data doesn't say:
  - lift types and colors, matched to OpenStreetMap by name
  - lodge labels
  - building styles, by footprint name
  - labels for the surrounding peaks, and lakes beyond the map
  - the terrain parks (`PARKS`): each Woodward park's size rating, lift and
    feature line, from Mt. Bachelor's park guide, plus the parks
    OpenStreetMap lacks (`EXTRA_PARKS`)
  - tie points that line the painted trail map
    (`reference/trail-map.webp`) up with the real lift terminals
- `src/world/world.js` builds the world. It loads the heightfield, places
  lifts on their real terminals, and fits building models into their real
  footprints. It keeps only the roads and lots that are plowed in winter,
  carves lake basins, and works out where the forest stands: the real tree
  cover over the ski area, and cuts along every run, lift line and Nordic
  trail beyond it.
- `src/world/projection.js` fits the painted trail map to the real lift
  positions, for the overlay and cursor dot.
- `src/render/*` turns that data into Three.js meshes.
  - `lifts.js`: each lift's real terminal design (Doppelmayr pod, CLD-260,
    D-Line, Summit's enclosed buildings, fixed-grip bullwheels), towers with
    sheave trains, and chairs sized per lift.
  - `buildings.js`: the lodges modelled on photos of the real buildings.
  - `parks.js`: the terrain parks along their real lines, set up in `PARKS`
    in `mountain.js`. It builds jumps, hips, berms, quarterpipes, the wave
    wall and spine, rails (flat, down, down-flat-down, kinked, rainbow),
    boxes, the battleship, the wallride, log jibs and Peace Park's VW bus,
    plus the 13' half pipe, entry banners and size signs.
  - `race.js`: the GS course on Cliffhanger (`RACE` in `mountain.js`), with
    gates, B-net, the start house and the finish.
  - `people.js`: NPC skiers and snowboarders on the runs, riders on the
    chairs, and a racer in the gates.
  - `region.js`: the real land out to the horizon (Broken Top, the Three
    Sisters, Mt. Jefferson, Diamond Peak), coloured by elevation, slope and
    aspect, with distance haze.
- The rest of `src/render/*` covers terrain shading, the instanced forest
  and snow ghosts, lakes, sky and clouds. `peaks.js` keeps stand-in volcano
  shapes for when the regional data isn't baked.

`npm run check` builds the world in Node. It prints every lift's length,
vertical and terminal elevations, where the lodges land, and how far the
trail-map overlay is off. It also prints the steepest ground next to any lift
terminal, which catches spikes.

World axes: `+x` = west, `+z` = north, `+y` = elevation in meters above sea
level. The summit is at `x = 0, z = 0`.
