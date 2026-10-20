import * as THREE from './vendor/three.module.js';

/** Indexed terrain mesh so adjacent cells share vertices (smooth town ground, no triangle grid). */
export function buildTerrainGeometry(mesh, point, ground) {
  if (!mesh?.vertices?.length || !mesh.triangles?.length) return null;
  const bedByVertex = new Float32Array(mesh.vertices.length);
  bedByVertex.fill(Number.NaN);
  mesh.triangles.forEach((tri, ti) => {
    tri.forEach((vi, j) => {
      const bed = mesh.vertex_bed_m?.[ti]?.[j];
      if (!Number.isFinite(bed)) return;
      bedByVertex[vi] = Number.isFinite(bedByVertex[vi]) ? (bedByVertex[vi] + bed) * 0.5 : bed;
    });
  });
  const positions = new Float32Array(mesh.vertices.length * 3);
  mesh.vertices.forEach(([x, y], vi) => {
    const bed = Number.isFinite(bedByVertex[vi]) ? bedByVertex[vi] : ground(x, y);
    const q = point(x, y, bed);
    positions[vi * 3] = q.x;
    positions[vi * 3 + 1] = q.y;
    positions[vi * 3 + 2] = q.z;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(mesh.triangles.flat());
  geometry.computeVertexNormals();
  return geometry;
}

/** Flat water patches per hydrodynamic cell (avoids spiky blue prisms). */
export function buildFloodGeometry(mesh, field, point, minDepth = 0.01) {
  if (!mesh?.triangles?.length || !field?.depth_m?.length) return null;
  const positions = [];
  const indices = [];
  let base = 0;
  mesh.triangles.forEach((tri, i) => {
    if (field.depth_m[i] < minDepth) return;
    const stage = field.stage_m[i];
    tri.forEach(vi => {
      const [x, y] = mesh.vertices[vi];
      const q = point(x, y, stage);
      positions.push(q.x, q.y, q.z);
    });
    indices.push(base, base + 1, base + 2);
    base += 3;
  });
  if (!indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const riverCenterY = y => 1200 + 120 * Math.sin(y / 400);

export function buildRiverGeometry(point, ground, { yMin = 200, yMax = 1800, step = 48, halfWidthM = 88 } = {}) {
  const segments = Math.max(2, Math.ceil((yMax - yMin) / step));
  const vertices = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const y = yMin + (i / segments) * (yMax - yMin);
    const cx = riverCenterY(y);
    const z = ground(cx, y) - 0.35;
    const left = point(cx - halfWidthM, y, z);
    const right = point(cx + halfWidthM, y, z);
    vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const _axis = new THREE.Vector3(1, 0, 0);
const _dir = new THREE.Vector3();

export function buildRoadRibbon(from, to, deck, width, lift, point, ground) {
  const z0 = deck ?? ground(from[0], from[1]);
  const z1 = deck ?? ground(to[0], to[1]);
  const a = point(from[0], from[1], z0 + lift);
  const b = point(to[0], to[1], z1 + lift);
  _dir.subVectors(b, a);
  const length = _dir.length();
  if (length < 1e-5) return null;
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, 0.07, width), new THREE.MeshStandardMaterial({ color: 0x1e2d3a, roughness: 0.88 }));
  mesh.position.copy(mid);
  mesh.position.y += 0.035;
  mesh.quaternion.setFromUnitVectors(_axis, _dir.normalize());
  mesh.receiveShadow = true;
  return mesh;
}
