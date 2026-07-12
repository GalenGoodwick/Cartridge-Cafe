// Neural Agent Seed — reactive goal-setting from neural signals
// Creates the feedback loop: brain signals → symbolic goals → fitness shaping → brain learning
// This gives the meta-programmer hooks a foothold to evolve from.

if (sim.worldData.neuro_phase !== 'evaluating') return;

sim.fields.forEach(function(field, id) {
  var mood = field.properties.get('nn_signal_mood');
  if (!mood) return;

  var topo = field.properties.get('nn_self_topology') || {};
  var signalMean = field.properties.get('nn_signal_mean') || 0;
  var signalVar = field.properties.get('nn_signal_variance') || 0;
  var fitness = field.properties.get('nn_self_fitness') || 0;
  var energy = field.properties.get('energy') || 100;
  var tick = sim.worldData.neuro_tick || 0;

  // ── Mood-driven goal setting ───────────────────────────────
  // The neural network's internal state drives what it's rewarded for,
  // creating a self-reinforcing loop: brain state → goals → evolution → brain state

  if (mood === 'chaotic') {
    // High variance, mixed signals — reward stabilisation
    field.properties.set('nn_goal_speed', 15);        // moderate speed
    field.properties.set('nn_goal_fitness_mod', 0.3);  // small bonus for surviving chaos
  }
  else if (mood === 'focused') {
    // Coherent activation — reward purposeful movement toward others
    var nearFields = sim.getFieldsNear(field.transform.x, field.transform.y, 200);
    var bestTarget = null, bestDist = 9999;
    for (var i = 0; i < nearFields.length; i++) {
      if (nearFields[i].id === id) continue;
      if (!nearFields[i].properties.has('nn_connections')) continue;
      var dx = nearFields[i].transform.x - field.transform.x;
      var dy = nearFields[i].transform.y - field.transform.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { bestDist = d; bestTarget = nearFields[i]; }
    }
    if (bestTarget) {
      field.properties.set('nn_goal_x', bestTarget.transform.x);
      field.properties.set('nn_goal_y', bestTarget.transform.y);
    }
    field.properties.set('nn_goal_fitness_mod', 0.5);  // bonus for focus
  }
  else if (mood === 'excited') {
    // High mean + high variance — reward exploration and interaction
    field.properties.set('nn_goal_speed', 40);          // fast movement
    field.properties.set('nn_goal_fitness_mod', 0.8);   // bonus for excitement
    // Clear position goals — let it roam
    field.properties.delete('nn_goal_x');
    field.properties.delete('nn_goal_y');
  }
  else if (mood === 'withdrawn') {
    // Low mean, low variance — nudge toward activity
    field.properties.set('nn_goal_speed', 30);
    field.properties.set('nn_goal_fitness_mod', -0.2);  // mild penalty for withdrawal
    // Set goal toward population center
    var summary = sim.worldData.neuro_population_summary || [];
    if (summary.length > 0) {
      var cx = 0, cy = 0, n = 0;
      sim.fields.forEach(function(f) {
        if (f.properties.has('nn_connections')) { cx += f.transform.x; cy += f.transform.y; n++; }
      });
      if (n > 0) {
        field.properties.set('nn_goal_x', cx / n);
        field.properties.set('nn_goal_y', cy / n);
      }
    }
  }
  else if (mood === 'agitated') {
    // Low mean, high variance — conflicting signals, reward coherence
    field.properties.set('nn_goal_vr', 0);              // reward stillness in rotation
    field.properties.set('nn_goal_fitness_mod', 0.1);
  }
  else if (mood === 'dormant') {
    // Nearly flat activations — penalise to force awakening
    field.properties.set('nn_goal_fitness_mod', -0.5);
    field.properties.set('nn_goal_speed', 25);
  }
  else {
    // neutral — mild exploration reward
    field.properties.set('nn_goal_fitness_mod', 0.2);
  }

  // ── Complexity-aware modulation ────────────────────────────
  // Reward brains that grow more complex IF they also perform well
  var complexity = topo.complexity || 160;
  var generation = sim.worldData.neuro_generation || 1;
  var bestFit = sim.worldData.neuro_best_fitness || 1;
  var fitnessRatio = bestFit > 0 ? fitness / bestFit : 0;

  // If this brain is more complex than average AND performing above median,
  // give a small complexity bonus (encourages structural growth in fit individuals)
  if (complexity > 170 && fitnessRatio > 0.5) {
    var currentMod = field.properties.get('nn_goal_fitness_mod') || 0;
    field.properties.set('nn_goal_fitness_mod', currentMod + 0.3);
  }

  // ── Energy-aware behaviour ─────────────────────────────────
  // Low energy → reward conservation (stop firing projectiles)
  if (energy < 30) {
    field.properties.set('nn_goal_speed', 10);  // slow down to conserve
    var currentMod = field.properties.get('nn_goal_fitness_mod') || 0;
    field.properties.set('nn_goal_fitness_mod', currentMod + 0.5); // reward surviving low energy
  }

  // ── Periodic goal rotation (prevents overfitting to one objective) ──
  if (tick % 200 === 0) {
    // Every 200 ticks, clear position goals to force re-evaluation
    field.properties.delete('nn_goal_x');
    field.properties.delete('nn_goal_y');
  }
});
