import * as THREE from 'three';

// Each lake: a snowy shoreline, a band of shelf ice, then open water.
function ring(outline, cx, cz, scale) {
  const shape = new THREE.Shape(
    outline.map((p) => new THREE.Vector2((p.x - cx) * scale, -(p.z - cz) * scale)),
  );
  const geo = new THREE.ShapeGeometry(shape, 2);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export function buildLakes(world, envMap) {
  const group = new THREE.Group();
  const shoreMat = new THREE.MeshStandardMaterial({ color: 0xf2f6fa, roughness: 0.95 });
  const iceMat = new THREE.MeshStandardMaterial({
    color: 0xcfe3ee,
    roughness: 0.35,
    metalness: 0.05,
    envMap,
    envMapIntensity: 0.6,
  });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1e4a66,
    roughness: 0.06,
    metalness: 0.2,
    envMap,
    envMapIntensity: 1.1,
  });
  for (const lake of world.lakes) {
    const { x, z, outline, level } = lake;
    const add = (scale, mat, dy) => {
      const m = new THREE.Mesh(ring(outline, x, z, scale), mat);
      m.position.set(x, level + dy, z);
      m.receiveShadow = true;
      group.add(m);
    };
    add(1.14, shoreMat, -0.1);
    add(1.0, iceMat, 0.15);
    add(0.84, waterMat, 0.3);
  }
  return group;
}
