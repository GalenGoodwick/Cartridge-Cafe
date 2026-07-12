// Neural Network Forward Pass — runs every tick during evaluation
// 12 inputs (sensory) → hidden (tanh) → 8 outputs (sigmoid, motor)

if (sim.worldData.neuro_phase !== 'evaluating') return;

sim.fields.forEach(function(field, id) {
  var conns = field.properties.get('nn_connections');
  if (!conns) return;

  var hiddenCount = field.properties.get('nn_hidden_count') || 8;
  var recurrent  = field.properties.get('nn_recurrent') || {};
  var energy     = field.properties.get('energy') || 100;

  // ── 12 sensory inputs ──────────────────────────────────────
  var inp = new Array(12);

  // 0-1  Own position normalised to [-1, 1] (grid ~512×512)
  inp[0] = Math.max(-1, Math.min(1, (field.transform.x - 256) / 256));
  inp[1] = Math.max(-1, Math.min(1, (field.transform.y - 256) / 256));

  // 2-3  Own velocity clamped
  inp[2] = Math.max(-1, Math.min(1, field.transform.vx / 100));
  inp[3] = Math.max(-1, Math.min(1, field.transform.vy / 100));

  // 4-6  Nearest field: distance (0-1) + unit direction
  var nearDist = 99999, nearDx = 0, nearDy = 0;
  sim.fields.forEach(function(other, oid) {
    if (oid === id) return;
    var dx = other.transform.x - field.transform.x;
    var dy = other.transform.y - field.transform.y;
    var d  = Math.sqrt(dx * dx + dy * dy);
    if (d < nearDist) {
      nearDist = d;
      nearDx = d > 0 ? dx / d : 0;
      nearDy = d > 0 ? dy / d : 0;
    }
  });
  inp[4] = Math.min(1, nearDist / 500);
  inp[5] = nearDx;
  inp[6] = nearDy;

  // 7-8  Mouse position relative to self, clamped
  var mx = (sim.worldData.mouse_x || 256) - field.transform.x;
  var my = (sim.worldData.mouse_y || 256) - field.transform.y;
  inp[7] = Math.max(-1, Math.min(1, mx / 256));
  inp[8] = Math.max(-1, Math.min(1, my / 256));

  // 9   Energy level [0, 1]
  inp[9] = energy / 100;

  // 10  Local population density (count within 150 px / 10)
  var nearby = 0;
  sim.fields.forEach(function(other, oid) {
    if (oid === id) return;
    var dx = other.transform.x - field.transform.x;
    var dy = other.transform.y - field.transform.y;
    if (dx * dx + dy * dy < 22500) nearby++;  // 150²
  });
  inp[10] = Math.min(1, nearby / 10);

  // 11  Oscillating time signal
  inp[11] = Math.sin((sim.worldData.neuro_tick || 0) * 0.01);

  // ── Forward pass ───────────────────────────────────────────
  var val = {};
  var n;

  // Set input node activations
  for (n = 0; n < 12; n++) val[n] = inp[n];

  // Hidden layer — seed with decayed recurrent memory
  for (n = 20; n < 20 + hiddenCount; n++) val[n] = (recurrent[n] || 0) * 0.5;

  // Output layer — start at zero
  for (n = 12; n < 20; n++) val[n] = 0;

  // Pass 1: accumulate weighted inputs into hidden nodes
  for (n = 0; n < conns.length; n++) {
    var c = conns[n];
    if (!c.enabled) continue;
    if (c.out >= 20 && c.out < 20 + hiddenCount && val[c.in] !== undefined) {
      val[c.out] += val[c.in] * c.weight;
    }
  }

  // Activate hidden (tanh)
  for (n = 20; n < 20 + hiddenCount; n++) val[n] = Math.tanh(val[n]);

  // Pass 2: accumulate into output nodes (from inputs + hidden)
  for (n = 0; n < conns.length; n++) {
    var c = conns[n];
    if (!c.enabled) continue;
    if (c.out >= 12 && c.out < 20 && val[c.in] !== undefined) {
      val[c.out] += val[c.in] * c.weight;
    }
  }

  // Activate outputs (sigmoid)
  for (n = 12; n < 20; n++) val[n] = 1 / (1 + Math.exp(-val[n]));

  // Save recurrent state for next tick
  var newRec = {};
  for (n = 20; n < 20 + hiddenCount; n++) newRec[n] = val[n];
  field.properties.set('nn_recurrent', newRec);

  // ── 8 motor outputs ────────────────────────────────────────
  var out = [];
  for (n = 12; n < 20; n++) out.push(val[n]);

  // 0-1  Force X, Y  ([-20, 20] scaled by dt)
  var fx = (out[0] * 2 - 1) * 20;
  var fy = (out[1] * 2 - 1) * 20;
  field.transform.vx += fx * dt;
  field.transform.vy += fy * dt;

  // Track cumulative force for efficiency fitness
  field.properties.set('nn_force_accum',
    (field.properties.get('nn_force_accum') || 0) + Math.abs(fx) + Math.abs(fy));

  // 2  Angular velocity [-3, 3]
  field.transform.vr = (out[2] * 2 - 1) * 3;

  // 3-4  Colour: modulate hue/saturation around species base → RGBA
  var specHue = field.properties.get('nn_species_hue') || 0;
  var hue = specHue + (out[3] - 0.5) * 60;
  var sat = 0.5 + out[4] * 0.5;
  var h = (((hue % 360) + 360) % 360) / 360;
  var sl = 0.6;
  var ch = (1 - Math.abs(2 * sl - 1)) * sat;
  var cx = ch * (1 - Math.abs(((h * 6) % 2) - 1));
  var cm = sl - ch / 2;
  var cr = 0, cg = 0, cb = 0;
  if      (h < 1/6) { cr = ch; cg = cx; }
  else if (h < 2/6) { cr = cx; cg = ch; }
  else if (h < 3/6) { cg = ch; cb = cx; }
  else if (h < 4/6) { cg = cx; cb = ch; }
  else if (h < 5/6) { cr = cx; cb = ch; }
  else               { cr = ch; cb = cx; }
  field.color = [cr + cm, cg + cm, cb + cm, 1.0];

  // 5  Emit projectile (threshold 0.8, cooldown 30 ticks)
  if (out[5] > 0.8 && energy > 5) {
    var cd = field.properties.get('nn_fire_cooldown') || 0;
    if (cd <= 0) {
      var angle = field.transform.rotation || 0;
      sim.spawnProjectile(
        field.transform.x, field.transform.y,
        Math.cos(angle) * 200, Math.sin(angle) * 200,
        1, h, 3, 0.8, 60
      );
      field.properties.set('nn_fire_cooldown', 30);
      field.properties.set('energy', energy - 5);
    }
  }
  var cdNow = field.properties.get('nn_fire_cooldown') || 0;
  if (cdNow > 0) field.properties.set('nn_fire_cooldown', cdNow - 1);

  // 6  Effect intensity — visual glow stamp
  if (out[6] > 0.3) {
    sim.stampEffectCircle(
      field.transform.x, field.transform.y,
      3 + out[6] * 5,       // radius
      1,                      // effectType
      h,                      // hue
      out[6],                 // brightness
      out[6] * 0.5            // intensity
    );
  }

  // 7  Scale [0.5, 2.0]
  field.transform.scale = 0.5 + out[7] * 1.5;

  // Energy regeneration (+0.1/tick, cap 100)
  if (energy < 100) field.properties.set('energy', Math.min(100, energy + 0.1));
});
