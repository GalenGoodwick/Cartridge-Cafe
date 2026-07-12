// Fitness Accumulator — composite fitness every tick during evaluation
// Components: movement, survival, interaction, efficiency, novelty

if (sim.worldData.neuro_phase !== 'evaluating') return;

var w = sim.worldData.neuro_fitness_weights || {
  movement: 0.3, survival: 0.2, interaction: 0.2, efficiency: 0.15, novelty: 0.15
};

// Compute population centroid for novelty scoring
var cx = 0, cy = 0, nCount = 0;
sim.fields.forEach(function(f) {
  if (!f.properties.has('nn_connections')) return;
  cx += f.transform.x;
  cy += f.transform.y;
  nCount++;
});
if (nCount > 0) { cx /= nCount; cy /= nCount; }

sim.fields.forEach(function(field, id) {
  if (!field.properties.has('nn_connections')) return;

  var fitness = field.properties.get('nn_fitness') || 0;

  // ── Movement (weight 0.3) ─────────────────────────────────
  // Distance traveled this tick, capped at 5
  var lastX = field.properties.get('nn_last_x');
  var lastY = field.properties.get('nn_last_y');
  if (lastX !== undefined && lastY !== undefined) {
    var dx = field.transform.x - lastX;
    var dy = field.transform.y - lastY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    fitness += Math.min(5, dist) * w.movement;
  }
  field.properties.set('nn_last_x', field.transform.x);
  field.properties.set('nn_last_y', field.transform.y);

  // ── Survival (weight 0.2) ──────────────────────────────────
  // +1 per tick if within grid bounds (0–512)
  if (field.transform.x > 0 && field.transform.x < 512 &&
      field.transform.y > 0 && field.transform.y < 512) {
    fitness += 1 * w.survival;
  }

  // ── Interaction (weight 0.2) ───────────────────────────────
  // +5 for each *unique* field approached within 50 px
  var interactions = field.properties.get('nn_interactions') || [];
  sim.fields.forEach(function(other, oid) {
    if (oid === id) return;
    if (!other.properties.has('nn_connections')) return;
    var dx = other.transform.x - field.transform.x;
    var dy = other.transform.y - field.transform.y;
    if (dx * dx + dy * dy < 2500) {              // 50²
      if (interactions.indexOf(oid) === -1) {
        interactions.push(oid);
        fitness += 5 * w.interaction;
      }
    }
  });
  field.properties.set('nn_interactions', interactions);

  // ── Efficiency (weight 0.15) ───────────────────────────────
  // Penalise excessive average force output
  var forceAccum = field.properties.get('nn_force_accum') || 0;
  var tick = sim.worldData.neuro_tick || 1;
  var avgForce = forceAccum / tick;
  fitness -= Math.max(0, avgForce - 10) * 0.1 * w.efficiency;

  // ── Novelty (weight 0.15) ──────────────────────────────────
  // Reward distance from population centroid
  if (nCount > 1) {
    var ndx = field.transform.x - cx;
    var ndy = field.transform.y - cy;
    fitness += Math.min(5, Math.sqrt(ndx * ndx + ndy * ndy) / 50) * w.novelty;
  }

  field.properties.set('nn_fitness', fitness);
});
