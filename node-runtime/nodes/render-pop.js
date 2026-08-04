// render-pop.js — ENTITY-LEVEL provenance: one render node draws a POPULATION of
// parts (like pentarch's ship = many part-entities in ONE field), and each part
// stamps ITS OWN owner into the buffer. So a click resolves to the SPECIFIC part
// (part #3, a GUN) → its source — not just "the ship field". This is the depth
// pentarch needs: click a ship part → its code, exactly.
//
// The model: each part is a NODE (registered → gets a PROV idx). render.pop marches
// the part list; the nearest/topmost part owns the pixel and stamps its node idx.
// In the live engine this is the population buffer + a per-entity owner write.

// build a "ship": a spine of parts, each a node with kind + cost + the code that grew it.
export function shipParts(register) {
  const KINDS = [
    { kind: 'HULL',  col: [110, 120, 140], cost: 2, code: 'grow.hull · pentagon(r=26)' },
    { kind: 'ARMOR', col: [150, 150, 160], cost: 3, code: 'grow.armor · pentagon(r=24)' },
    { kind: 'GUN',   col: [200, 90, 70],   cost: 5, code: 'grow.gun · turret + barrel' },
    { kind: 'ENGINE',col: [90, 170, 200],  cost: 4, code: 'grow.engine · jet + gyro' },
    { kind: 'CORE',  col: [220, 190, 120], cost: 1, code: 'grow.core · the helm' },
  ];
  // 7 parts laid out as a little ship; each REGISTERS as its own node → gets an idx.
  const layout = [
    { x: 0.50, y: 0.55, r: 0.10, k: 4 }, // CORE center
    { x: 0.38, y: 0.55, r: 0.08, k: 0 }, // HULL
    { x: 0.62, y: 0.55, r: 0.08, k: 0 }, // HULL
    { x: 0.50, y: 0.40, r: 0.07, k: 2 }, // GUN top
    { x: 0.50, y: 0.70, r: 0.07, k: 3 }, // ENGINE bottom
    { x: 0.30, y: 0.42, r: 0.06, k: 1 }, // ARMOR
    { x: 0.70, y: 0.42, r: 0.06, k: 1 }, // ARMOR
  ];
  return layout.map((p, i) => {
    const K = KINDS[p.k];
    const node = register({
      id: 'part.' + i + '.' + K.kind.toLowerCase(), kind: 'part', order: 100, layer: 'ship (1 field, N parts)',
      title: K.kind + ' #' + i, detail: K.kind + ' part',
      prov: { via: K.code, state: 'cost ' + K.cost, means: 'a ' + K.kind + ' part of the ship',
        code: K.code, cand: K.kind === 'GUN' ? { node: 'grow.gun.v2', by: 'opus-a', would: 'swivel mount variant', on: false } : null },
      run: () => {},
    });
    return { ...p, col: K.col, idx: node.idx };
  });
}

// the RENDER node: draw all parts into color+owner. Topmost part owns the pixel.
export function renderPopNode(parts) {
  return {
    id: 'render.pop', kind: 'render', order: 100, owns: { uni: [] },
    title: 'render · population', detail: 'draws N part-entities; EACH stamps its own entity-owner (pentarch-style)',
    prov: { via: 'population loop · per-entity owner write', state: 'owner = the specific part', means: 'the ship (N parts, 1 field)', cand: null },
    run: ({ frame }) => {
      const W = frame.W, H = frame.H, col = frame.col, own = frame.owner;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          // topmost part whose disc covers this pixel (reverse = last drawn wins)
          let hitCol = null, hitIdx = -1;
          for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            const dx = x / W - p.x, dy = y / H - p.y;
            if (dx * dx + dy * dy <= p.r * p.r) { hitCol = p.col; hitIdx = p.idx; break; }
          }
          const pp = (y * W + x) * 4;
          if (hitIdx >= 0) {
            col[pp] = hitCol[0]; col[pp + 1] = hitCol[1]; col[pp + 2] = hitCol[2]; col[pp + 3] = 255;
            own[y * W + x] = hitIdx;                 // ← per-ENTITY owner: this pixel belongs to THIS part
          }
        }
      }
    },
  };
}
