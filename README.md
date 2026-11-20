# Ski Bachelor

A 3D skiing game set on Mt. Bachelor, Oregon. This first build is the
mountain map: terrain, runs, forest, lifts, lodges, the Nordic Center, and
the surrounding Cascades and lakes. Gameplay comes next.

## Run it

```bash
npm run dev
```

Then open http://localhost:5174. There is no build step. Three.js loads from
a CDN through the import map in `index.html`.

Controls:
- Drag to orbit, right-drag to pan, scroll to zoom
- `1`: trail-map view
- `L`: labels
- `M`: trail map overlay. A yellow dot on the overlay shows where your cursor is.
- **Ride** in the lift list rides a chair to the top. `+`/`−` changes the ride speed and `Esc` hops off.

## How the map is built

Everything is laid out from the official trail map (`reference/trail-map.webp`).

- `src/data/mountain.js` holds every lift, lodge, road, parking lot, Nordic
  loop, lake and distant peak. Lifts and lodges are trail-map pixel
  coordinates plus real elevations in feet. To dial something in, edit a
  number here and reload.
- `src/world/projection.js` turns trail-map pixels into 3D positions. It
  models the painting as an oblique view of the mountain from the north.
- `src/world/world.js` builds the terrain heightfield. It starts from a
  volcano profile fitted to the lift elevations, then bends the terrain so it
  passes exactly through every known elevation. It also carves roads,
  parking, building pads and lake basins, and generates the run network.
- `src/render/*` turns that data into Three.js meshes. This covers terrain
  shading, instanced forest and snow ghosts, lifts with moving chairs, lodge
  complexes, lakes, peaks, sky and clouds.

`npm run check` builds the world in Node and prints every lift's length,
vertical drop and terminal elevations, and where each one lands back on the
trail map.

World axes: `+x` = west, `+z` = north, `+y` = elevation in meters above sea
level. The summit is at `x = 0, z = 0`.
