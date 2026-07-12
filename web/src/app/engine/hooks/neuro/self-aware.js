// Neural–Symbolic Bridge: Self-Integration Hook
// Connects the neural substrate to the agent self-programming pipeline
//
// 1. Neural → Symbolic: exposes brain outputs as readable signals for observer/decider hooks
// 2. Symbolic → Neural: lets agent hooks define fitness goals that steer evolution
// 3. Self-awareness: agents can perceive their own neural topology and fitness

if (sim.worldData.neuro_phase !== 'evaluating') return;

sim.fields.forEach(function(field, id) {
  var conns = field.properties.get('nn_connections');
  if (!conns) return;

  // ═══════════════════════════════════════════════════════════
  // 1. NEURAL → SYMBOLIC  (expose brain outputs as signals)
  // ═══════════════════════════════════════════════════════════
  // Read the recurrent state (hidden neuron activations from last tick)
  // These represent the "thoughts" of the neural network
  var rec = field.properties.get('nn_recurrent') || {};
  var hiddenCount = field.properties.get('nn_hidden_count') || 8;

  // Compute aggregate neural signals from hidden layer
  var sum = 0, maxAct = 0, minAct = 0, variance = 0;
  var activations = [];
  for (var h = 20; h < 20 + hiddenCount; h++) {
    var v = rec[h] || 0;
    activations.push(v);
    sum += v;
    if (v > maxAct) maxAct = v;
    if (v < minAct) minAct = v;
  }
  var mean = hiddenCount > 0 ? sum / hiddenCount : 0;
  for (var i = 0; i < activations.length; i++) {
    var diff = activations[i] - mean;
    variance += diff * diff;
  }
  variance = hiddenCount > 0 ? variance / hiddenCount : 0;

  // Store as properties readable by observer/decider hooks
  field.properties.set('nn_signal_mean', mean);           // average neural activation (-1 to 1)
  field.properties.set('nn_signal_variance', variance);   // activation diversity (0 to 1)
  field.properties.set('nn_signal_max', maxAct);           // strongest excitation
  field.properties.set('nn_signal_min', minAct);           // strongest inhibition
  field.properties.set('nn_signal_spread', maxAct - minAct); // dynamic range

  // Classify neural "mood" — a symbolic label from subsymbolic state
  var mood = 'neutral';
  if (mean > 0.3 && variance < 0.2)  mood = 'focused';
  if (mean > 0.3 && variance > 0.4)  mood = 'excited';
  if (mean < -0.3 && variance < 0.2) mood = 'withdrawn';
  if (mean < -0.3 && variance > 0.4) mood = 'agitated';
  if (variance > 0.6)                mood = 'chaotic';
  if (Math.abs(mean) < 0.1 && variance < 0.1) mood = 'dormant';
  field.properties.set('nn_signal_mood', mood);

  // ═══════════════════════════════════════════════════════════
  // 2. SELF-AWARENESS: topology introspection
  // ═══════════════════════════════════════════════════════════
  var enabledConns = 0, disabledConns = 0, totalWeight = 0;
  for (var c = 0; c < conns.length; c++) {
    if (conns[c].enabled) {
      enabledConns++;
      totalWeight += Math.abs(conns[c].weight);
    } else {
      disabledConns++;
    }
  }

  field.properties.set('nn_self_topology', {
    connections: enabledConns,
    disabled: disabledConns,
    hidden_neurons: hiddenCount,
    avg_weight: enabledConns > 0 ? totalWeight / enabledConns : 0,
    total_params: conns.length,
    complexity: enabledConns + hiddenCount * 2  // rough complexity score
  });

  field.properties.set('nn_self_fitness', field.properties.get('nn_fitness') || 0);
  field.properties.set('nn_self_species', field.properties.get('nn_species') || 0);
  field.properties.set('nn_self_generation', field.properties.get('nn_generation') || 0);

  // Global evolutionary context
  field.properties.set('nn_self_global', {
    generation: sim.worldData.neuro_generation,
    best_fitness: sim.worldData.neuro_best_fitness,
    species_count: (sim.worldData.neuro_species_list || []).length,
    phase: sim.worldData.neuro_phase
  });

  // ═══════════════════════════════════════════════════════════
  // 3. SYMBOLIC → NEURAL  (agent-defined fitness goals)
  // ═══════════════════════════════════════════════════════════
  // If any hook has set nn_goal_* properties, apply them as fitness bonuses
  // This lets the self-programming system steer what the brain learns

  // Goal: approach target position (set by decider hooks)
  var goalX = field.properties.get('nn_goal_x');
  var goalY = field.properties.get('nn_goal_y');
  if (goalX !== undefined && goalY !== undefined) {
    var gdx = field.transform.x - goalX;
    var gdy = field.transform.y - goalY;
    var goalDist = Math.sqrt(gdx * gdx + gdy * gdy);
    var goalBonus = Math.max(0, 1 - goalDist / 200) * 3;  // +3 max when at target
    field.properties.set('nn_fitness',
      (field.properties.get('nn_fitness') || 0) + goalBonus);
  }

  // Goal: match target speed (set by decider hooks)
  var goalSpeed = field.properties.get('nn_goal_speed');
  if (goalSpeed !== undefined) {
    var speed = Math.sqrt(field.transform.vx * field.transform.vx +
                          field.transform.vy * field.transform.vy);
    var speedBonus = Math.max(0, 1 - Math.abs(speed - goalSpeed) / 50) * 2;
    field.properties.set('nn_fitness',
      (field.properties.get('nn_fitness') || 0) + speedBonus);
  }

  // Goal: match target rotation rate
  var goalVr = field.properties.get('nn_goal_vr');
  if (goalVr !== undefined) {
    var vrBonus = Math.max(0, 1 - Math.abs(field.transform.vr - goalVr) / 3) * 1;
    field.properties.set('nn_fitness',
      (field.properties.get('nn_fitness') || 0) + vrBonus);
  }

  // Goal: custom fitness modifier (raw bonus/penalty per tick)
  var goalFitnessMod = field.properties.get('nn_goal_fitness_mod');
  if (goalFitnessMod !== undefined && typeof goalFitnessMod === 'number') {
    field.properties.set('nn_fitness',
      (field.properties.get('nn_fitness') || 0) + goalFitnessMod);
  }

  // ═══════════════════════════════════════════════════════════
  // 4. META-LEARNING: let agents modify evolution config
  // ═══════════════════════════════════════════════════════════
  // If any agent sets nn_meta_* on worldData, apply to config
  var metaMutRate = sim.worldData.nn_meta_mutation_rate;
  if (metaMutRate !== undefined && typeof metaMutRate === 'number') {
    sim.worldData.neuro_config.weight_perturb_sigma =
      Math.max(0.01, Math.min(0.5, metaMutRate));
  }

  var metaStructRate = sim.worldData.nn_meta_structure_rate;
  if (metaStructRate !== undefined && typeof metaStructRate === 'number') {
    sim.worldData.neuro_config.mutation_rate_add_conn =
      Math.max(0.01, Math.min(0.2, metaStructRate));
    sim.worldData.neuro_config.mutation_rate_add_neuron =
      Math.max(0.005, Math.min(0.1, metaStructRate * 0.4));
  }

  var metaEvalTime = sim.worldData.nn_meta_eval_ticks;
  if (metaEvalTime !== undefined && typeof metaEvalTime === 'number') {
    sim.worldData.neuro_config.eval_ticks =
      Math.max(200, Math.min(2000, Math.round(metaEvalTime)));
  }
});

// ═══════════════════════════════════════════════════════════
// 5. BROADCAST: make neural state visible to all hooks via worldData
// ═══════════════════════════════════════════════════════════
var neuralSummary = [];
sim.fields.forEach(function(field, id) {
  if (!field.properties.has('nn_connections')) return;
  neuralSummary.push({
    id: id,
    name: field.name,
    fitness: field.properties.get('nn_fitness') || 0,
    mood: field.properties.get('nn_signal_mood') || 'unknown',
    species: field.properties.get('nn_species') || 0,
    complexity: (field.properties.get('nn_self_topology') || {}).complexity || 0
  });
});
neuralSummary.sort(function(a, b) { return b.fitness - a.fitness; });
sim.worldData.neuro_population_summary = neuralSummary;
