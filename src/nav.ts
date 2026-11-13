import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const CAR_CLEARANCE = 2; // m either side of an edge that must be free
const NODE_CLEARANCE = 3; // m around a node that must be open ground

/** Waypoint graph for bots (spec §10). */
export class NavGraph {
  constructor(
    readonly nodes: THREE.Vector3[],
    readonly edges: number[][],
  ) {}

  /** Cut a rectangle out of the graph (bridge destroyed, floor collapsed). Nodes stay but are unreachable. */
  removeArea(minX: number, maxX: number, minZ: number, maxZ: number) {
    const gone = new Set<number>();
    this.nodes.forEach((n, i) => {
      if (n.x >= minX && n.x <= maxX && n.z >= minZ && n.z <= maxZ) gone.add(i);
    });
    this.edges.forEach((e, i) => {
      this.edges[i] = gone.has(i) ? [] : e.filter((j) => !gone.has(j));
    });
    this.dead = new Set([...this.dead, ...gone]);
  }

  private dead = new Set<number>();

  /** Nodes still connected to the world (excludes collapsed / destroyed areas). */
  liveNodes() {
    return this.nodes.filter((_, i) => !this.dead.has(i));
  }

  nearest(p: THREE.Vector3) {
    let best = 0;
    let bestD = Infinity;
    this.nodes.forEach((n, i) => {
      const d = n.distanceToSquared(p);
      if (d < bestD && !this.dead.has(i)) [best, bestD] = [i, d];
    });
    return best;
  }

  /** A* from the node nearest `from` to the node nearest `to`. Returns waypoints (excluding start). */
  path(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    const start = this.nearest(from);
    const goal = this.nearest(to);
    const g = new Map<number, number>([[start, 0]]);
    const came = new Map<number, number>();
    const h = (i: number) => this.nodes[i].distanceTo(this.nodes[goal]);
    const open = new Set([start]);
    const f = new Map<number, number>([[start, h(start)]]);
    while (open.size) {
      // ponytail: linear scan of the open set; fine for a few hundred nodes, use a heap past ~2k.
      let cur = -1;
      for (const i of open) if (cur < 0 || f.get(i)! < f.get(cur)!) cur = i;
      if (cur === goal) {
        const out: THREE.Vector3[] = [];
        for (let i = goal; i !== start; i = came.get(i)!) out.unshift(this.nodes[i]);
        return out;
      }
      open.delete(cur);
      for (const n of this.edges[cur]) {
        const cost = g.get(cur)! + this.nodes[cur].distanceTo(this.nodes[n]);
        if (cost >= (g.get(n) ?? Infinity)) continue;
        came.set(n, cur);
        g.set(n, cost);
        f.set(n, cost + h(n));
        open.add(n);
      }
    }
    return [this.nodes[goal]]; // disconnected: head straight for it
  }
}

/**
 * Auto-generate a grid graph from the collision world. Each cell gets one node on its top
 * surface (so platforms, ramps and bridges are walkable levels) when the ground around it is
 * flat-ish and open; edges join neighbours whose car-height line is clear (a ramp passes, a
 * cliff face does not). Call before any vehicles exist.
 * ponytail: auto grid for greybox arenas; Blender-authored `nav_N` empties can replace it in M5.
 */
export function buildGridNav(world: RAPIER.World, halfSize: number, spacing: number, height = 1) {
  const nodes: THREE.Vector3[] = [];
  const index = new Map<string, number>();
  const steps = Math.floor(halfSize / spacing);
  world.step(); // static colliders become queryable after a step
  const top = (x: number, z: number) => {
    const hit = world.castRayAndGetNormal(new RAPIER.Ray({ x, y: 80, z }, { x: 0, y: -1, z: 0 }), 200, true);
    return hit ? { y: 80 - hit.timeOfImpact, flat: hit.normal.y > 0.8 } : null;
  };
  for (let ix = -steps; ix <= steps; ix++) {
    for (let iz = -steps; iz <= steps; iz++) {
      const [x, z] = [ix * spacing, iz * spacing];
      const t = top(x, z);
      if (!t || !t.flat || t.y < -5) continue; // pit or wall top
      // Open ground nearby: no crate/prop/wall edge within clearance (surface height ~same).
      const c = NODE_CLEARANCE;
      const open = [[c, 0], [-c, 0], [0, c], [0, -c]].every(([dx, dz]) => {
        const n = top(x + dx, z + dz);
        return n && Math.abs(n.y - t.y) < 1.2;
      });
      if (!open) continue;
      index.set(`${ix},${iz}`, nodes.length);
      nodes.push(new THREE.Vector3(x, t.y + height, z));
    }
  }
  const edges: number[][] = nodes.map(() => []);
  for (const [key, i] of index) {
    const [ix, iz] = key.split(',').map(Number);
    for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const j = index.get(`${ix + dx},${iz + dz}`);
      if (j === undefined) continue;
      const a = nodes[i];
      const dir = nodes[j].clone().sub(a);
      const len = dir.length();
      dir.normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(CAR_CLEARANCE);
      const blocked = [0, 1, -1].some((k) => world.castRay(new RAPIER.Ray(a.clone().addScaledVector(side, k), dir), len, true));
      if (blocked) continue;
      edges[i].push(j);
      edges[j].push(i);
    }
  }
  return new NavGraph(nodes, edges);
}
