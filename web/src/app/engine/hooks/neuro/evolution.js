// Neuroevolution Manager — State Machine (NEAT-lite)
// States: init → spawning → evaluating → selecting → evaluating → ...

(function() {
  // --- Bootstrap ---
  if (!sim.worldData.neuro_phase) {
    sim.worldData.neuro_phase = 'init';
    sim.worldData.neuro_generation = 0;
    sim.worldData.neuro_tick = 0;
    sim.worldData.neuro_innovation = 0;
    sim.worldData.neuro_best_fitness = 0;
    sim.worldData.neuro_config = {
      population_size: 10,
      eval_ticks: 600,
      mutation_rate_weight: 0.8,
      mutation_rate_reset: 0.1,
      mutation_rate_add_conn: 0.05,
      mutation_rate_add_neuron: 0.02,
      weight_perturb_sigma: 0.1,
      compatibility_threshold: 3.0,
      elitism: 2,
      tournament_size: 3
    };
    sim.worldData.neuro_species_list = [];
    sim.worldData.neuro_fitness_history = [];
    sim.worldData.neuro_fitness_weights = {
      movement: 0.3, survival: 0.2, interaction: 0.2, efficiency: 0.15, novelty: 0.15
    };
  }

  var config = sim.worldData.neuro_config;
  var phase = sim.worldData.neuro_phase;

  // --- Helpers ---

  function hueToColor(hue) {
    var h = (((hue % 360) + 360) % 360) / 360;
    var s = 0.75, l = 0.6;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h * 6) % 2) - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 1/6)      { r = c; g = x; }
    else if (h < 2/6) { r = x; g = c; }
    else if (h < 3/6) { g = c; b = x; }
    else if (h < 4/6) { g = x; b = c; }
    else if (h < 5/6) { r = x; b = c; }
    else               { r = c; b = x; }
    return [r + m, g + m, b + m, 1.0];
  }

  function createGenome() {
    var conns = [];
    var innov = sim.worldData.neuro_innovation;
    // Input (0-11) → Hidden (20-27)
    for (var i = 0; i < 12; i++) {
      for (var h = 20; h < 28; h++) {
        conns.push({
          in: i, out: h,
          weight: (Math.random() * 2 - 1) * 0.5,
          enabled: true, innovation: innov++
        });
      }
    }
    // Hidden (20-27) → Output (12-19)
    for (var h = 20; h < 28; h++) {
      for (var o = 12; o < 20; o++) {
        conns.push({
          in: h, out: o,
          weight: (Math.random() * 2 - 1) * 0.5,
          enabled: true, innovation: innov++
        });
      }
    }
    sim.worldData.neuro_innovation = innov;
    return conns;
  }

  function initField(field, genome) {
    var hue = Math.random() * 360;
    field.properties.set('nn_connections', genome);
    field.properties.set('nn_hidden_count', 8);
    field.properties.set('nn_recurrent', {});
    field.properties.set('nn_fitness', 0);
    field.properties.set('nn_species', 0);
    field.properties.set('nn_species_hue', hue);
    field.properties.set('nn_generation', sim.worldData.neuro_generation);
    field.properties.set('energy', 100);
    field.properties.set('nn_interactions', []);
    field.properties.set('nn_last_x', field.transform.x);
    field.properties.set('nn_last_y', field.transform.y);
    field.properties.set('nn_force_accum', 0);
    field.properties.set('nn_fire_cooldown', 0);
    field.color = hueToColor(hue);
  }

  // ============================================================
  // INIT — enroll existing fields, spawn new ones if needed
  // ============================================================
  if (phase === 'init') {
    var neuralCount = 0;
    sim.fields.forEach(function(f) {
      if (f.properties.has('nn_connections')) neuralCount++;
    });

    if (neuralCount >= config.population_size) {
      sim.worldData.neuro_phase = 'evaluating';
      sim.worldData.neuro_tick = 0;
      sim.worldData.neuro_generation = 1;
      return;
    }

    // Enroll existing non-neural fields
    var enrolled = neuralCount;
    sim.fields.forEach(function(f) {
      if (enrolled >= config.population_size) return;
      if (!f.properties.has('nn_connections')) {
        initField(f, createGenome());
        enrolled++;
      }
    });

    // Spawn new fields if still short
    for (var i = enrolled; i < config.population_size; i++) {
      var x = 80 + Math.random() * 352;
      var y = 80 + Math.random() * 352;
      var hue = (i / config.population_size) * 360;
      sim.queueSpawn(
        'neuron_' + i,
        hueToColor(hue),
        { type: 'polygon', radius: 8, sides: 6 },
        x, y
      );
    }

    sim.worldData.neuro_phase = (enrolled < config.population_size) ? 'spawning' : 'evaluating';
    sim.worldData.neuro_tick = 0;
    sim.worldData.neuro_generation = 1;
    return;
  }

  // ============================================================
  // SPAWNING — wait one tick for queueSpawn to materialise
  // ============================================================
  if (phase === 'spawning') {
    sim.fields.forEach(function(f) {
      if (f.name && f.name.startsWith('neuron_') && !f.properties.has('nn_connections')) {
        initField(f, createGenome());
      }
    });
    sim.worldData.neuro_phase = 'evaluating';
    sim.worldData.neuro_tick = 0;
    return;
  }

  // ============================================================
  // EVALUATING — count ticks, let brain+fitness hooks do work
  // ============================================================
  if (phase === 'evaluating') {
    sim.worldData.neuro_tick = (sim.worldData.neuro_tick || 0) + 1;
    if (sim.worldData.neuro_tick >= config.eval_ticks) {
      sim.worldData.neuro_phase = 'selecting';
    }
    return;
  }

  // ============================================================
  // SELECTING — full NEAT cycle
  // ============================================================
  if (phase !== 'selecting') return;

  // Gather population
  var population = [];
  sim.fields.forEach(function(f) {
    if (!f.properties.has('nn_connections')) return;
    population.push({
      field: f,
      genome: f.properties.get('nn_connections'),
      hidden_count: f.properties.get('nn_hidden_count') || 8,
      fitness: f.properties.get('nn_fitness') || 0,
      species: 0
    });
  });

  if (population.length === 0) {
    sim.worldData.neuro_phase = 'init';
    return;
  }

  population.sort(function(a, b) { return b.fitness - a.fitness; });

  // Record history
  var bestFitness = population[0].fitness;
  sim.worldData.neuro_best_fitness = bestFitness;
  var history = sim.worldData.neuro_fitness_history;
  history.push(bestFitness);
  if (history.length > 50) history.shift();

  // ---- Speciation ----
  function compatDist(g1, g2) {
    var map1 = {}, map2 = {}, max1 = 0, max2 = 0;
    for (var i = 0; i < g1.length; i++) {
      map1[g1[i].innovation] = g1[i];
      if (g1[i].innovation > max1) max1 = g1[i].innovation;
    }
    for (var i = 0; i < g2.length; i++) {
      map2[g2[i].innovation] = g2[i];
      if (g2[i].innovation > max2) max2 = g2[i].innovation;
    }
    var minMax = Math.min(max1, max2);
    var matching = 0, disjoint = 0, excess = 0, wDiff = 0;
    var allInn = {};
    var k;
    for (k in map1) allInn[k] = true;
    for (k in map2) allInn[k] = true;
    for (k in allInn) {
      var inn = parseInt(k);
      var in1 = map1[k] !== undefined;
      var in2 = map2[k] !== undefined;
      if (in1 && in2) {
        matching++;
        wDiff += Math.abs(map1[k].weight - map2[k].weight);
      } else if (inn > minMax) {
        excess++;
      } else {
        disjoint++;
      }
    }
    var N = Math.max(g1.length, g2.length, 1);
    var avgW = matching > 0 ? wDiff / matching : 0;
    return (excess / N) + (disjoint / N) + 0.4 * avgW;
  }

  var speciesList = [];
  var nextSpId = 1;
  for (var pi = 0; pi < population.length; pi++) {
    var ind = population[pi];
    var assigned = false;
    for (var si = 0; si < speciesList.length; si++) {
      if (compatDist(ind.genome, speciesList[si].rep) < config.compatibility_threshold) {
        ind.species = speciesList[si].id;
        speciesList[si].members.push(ind);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      var spId = nextSpId++;
      ind.species = spId;
      speciesList.push({ id: spId, rep: ind.genome, members: [ind], hue: Math.random() * 360 });
    }
  }

  sim.worldData.neuro_species_list = speciesList.map(function(s) {
    var best = 0;
    for (var mi = 0; mi < s.members.length; mi++) {
      if (s.members[mi].fitness > best) best = s.members[mi].fitness;
    }
    return { id: s.id, size: s.members.length, hue: s.hue, bestFitness: best };
  });

  // ---- Tournament Selection ----
  function tournamentSelect() {
    var best = null;
    for (var t = 0; t < config.tournament_size; t++) {
      var c = population[Math.floor(Math.random() * population.length)];
      if (!best || c.fitness > best.fitness) best = c;
    }
    return best;
  }

  // ---- NEAT Crossover ----
  function crossover(p1, p2) {
    var child = [];
    var m1 = {}, m2 = {};
    for (var i = 0; i < p1.genome.length; i++) m1[p1.genome[i].innovation] = p1.genome[i];
    for (var i = 0; i < p2.genome.length; i++) m2[p2.genome[i].innovation] = p2.genome[i];
    var all = {};
    var k;
    for (k in m1) all[k] = true;
    for (k in m2) all[k] = true;
    for (k in all) {
      var c1 = m1[k], c2 = m2[k];
      if (c1 && c2) {
        var src = Math.random() < 0.5 ? c1 : c2;
        child.push({ in: src.in, out: src.out, weight: src.weight, enabled: src.enabled, innovation: src.innovation });
      } else if (c1 && p1.fitness >= p2.fitness) {
        child.push({ in: c1.in, out: c1.out, weight: c1.weight, enabled: c1.enabled, innovation: c1.innovation });
      } else if (c2 && p2.fitness >= p1.fitness) {
        child.push({ in: c2.in, out: c2.out, weight: c2.weight, enabled: c2.enabled, innovation: c2.innovation });
      }
    }
    return child;
  }

  // ---- Weight Mutation ----
  function mutateWeights(genome) {
    for (var i = 0; i < genome.length; i++) {
      if (Math.random() < config.mutation_rate_weight) {
        if (Math.random() < config.mutation_rate_reset) {
          genome[i].weight = Math.random() * 2 - 1;
        } else {
          genome[i].weight += (Math.random() * 2 - 1) * config.weight_perturb_sigma;
        }
        genome[i].weight = Math.max(-5, Math.min(5, genome[i].weight));
      }
    }
  }

  // ---- Structural Mutation ----
  function mutateStructure(genome, hiddenCount) {
    var newHidden = hiddenCount;

    // Add connection (5%)
    if (Math.random() < config.mutation_rate_add_conn) {
      var nodes = [];
      var ni;
      for (ni = 0; ni < 12; ni++) nodes.push(ni);
      for (ni = 12; ni < 20; ni++) nodes.push(ni);
      for (ni = 20; ni < 20 + hiddenCount; ni++) nodes.push(ni);
      var existing = {};
      for (ni = 0; ni < genome.length; ni++) existing[genome[ni].in + ',' + genome[ni].out] = true;
      for (var attempt = 0; attempt < 20; attempt++) {
        var from = nodes[Math.floor(Math.random() * nodes.length)];
        var to = nodes[Math.floor(Math.random() * nodes.length)];
        if (from === to) continue;
        if (to < 12) continue;                                  // nothing → input
        if (from < 12 && to < 12) continue;                     // input → input
        if (from >= 12 && from < 20 && to >= 12 && to < 20) continue; // output → output
        if (!existing[from + ',' + to]) {
          genome.push({
            in: from, out: to,
            weight: (Math.random() * 2 - 1) * 0.5,
            enabled: true, innovation: sim.worldData.neuro_innovation++
          });
          break;
        }
      }
    }

    // Add neuron — split connection (2%)
    if (Math.random() < config.mutation_rate_add_neuron && newHidden < 16) {
      var enabled = [];
      for (var ei = 0; ei < genome.length; ei++) {
        if (genome[ei].enabled) enabled.push(ei);
      }
      if (enabled.length > 0) {
        var idx = enabled[Math.floor(Math.random() * enabled.length)];
        var conn = genome[idx];
        conn.enabled = false;
        var newNode = 20 + newHidden;
        newHidden++;
        genome.push({ in: conn.in, out: newNode, weight: 1.0, enabled: true, innovation: sim.worldData.neuro_innovation++ });
        genome.push({ in: newNode, out: conn.out, weight: conn.weight, enabled: true, innovation: sim.worldData.neuro_innovation++ });
      }
    }

    return newHidden;
  }

  // ---- Build next generation ----
  var newGen = [];

  // Elitism — top N survive unchanged (deep copy)
  for (var ei = 0; ei < Math.min(config.elitism, population.length); ei++) {
    var eg = population[ei].genome;
    var copy = [];
    for (var ci = 0; ci < eg.length; ci++) {
      copy.push({ in: eg[ci].in, out: eg[ci].out, weight: eg[ci].weight, enabled: eg[ci].enabled, innovation: eg[ci].innovation });
    }
    newGen.push({ genome: copy, hidden_count: population[ei].hidden_count, species: population[ei].species, elite: true });
  }

  // Fill remainder with offspring
  while (newGen.length < population.length) {
    var p1 = tournamentSelect();
    var p2 = tournamentSelect();
    var childGenome = crossover(p1, p2);
    var childHidden = Math.max(p1.hidden_count, p2.hidden_count);
    mutateWeights(childGenome);
    childHidden = mutateStructure(childGenome, childHidden);
    newGen.push({ genome: childGenome, hidden_count: childHidden, species: p1.species, elite: false });
  }

  // Apply new genomes to fields (population is sorted best→worst)
  for (var ai = 0; ai < population.length && ai < newGen.length; ai++) {
    var f = population[ai].field;
    var ng = newGen[ai];
    f.properties.set('nn_connections', ng.genome);
    f.properties.set('nn_hidden_count', ng.hidden_count);
    f.properties.set('nn_recurrent', {});
    f.properties.set('nn_fitness', 0);
    f.properties.set('nn_species', ng.species);
    f.properties.set('nn_generation', sim.worldData.neuro_generation);
    f.properties.set('energy', 100);
    f.properties.set('nn_interactions', []);
    f.properties.set('nn_force_accum', 0);
    f.properties.set('nn_fire_cooldown', 0);

    var sp = null;
    for (var ssi = 0; ssi < speciesList.length; ssi++) {
      if (speciesList[ssi].id === ng.species) { sp = speciesList[ssi]; break; }
    }
    if (sp) {
      f.properties.set('nn_species_hue', sp.hue);
      f.color = hueToColor(sp.hue);
    }

    // Reset position for non-elites
    if (!ng.elite) {
      f.transform.x = 80 + Math.random() * 352;
      f.transform.y = 80 + Math.random() * 352;
      f.transform.vx = 0;
      f.transform.vy = 0;
    }
    f.properties.set('nn_last_x', f.transform.x);
    f.properties.set('nn_last_y', f.transform.y);
  }

  // ---- Meta-evolution (every 10 generations) ----
  var gen = sim.worldData.neuro_generation;
  if (gen > 0 && gen % 10 === 0 && history.length >= 10) {
    var recent = history.slice(-5);
    var older = history.slice(-10, -5);
    var rAvg = 0, oAvg = 0;
    for (var ri = 0; ri < recent.length; ri++) rAvg += recent[ri];
    rAvg /= recent.length;
    if (older.length > 0) {
      for (var oi = 0; oi < older.length; oi++) oAvg += older[oi];
      oAvg /= older.length;
    } else {
      oAvg = rAvg;
    }

    if (rAvg <= oAvg * 1.05) {
      // Stagnating — increase exploration
      config.mutation_rate_add_conn = Math.min(0.15, config.mutation_rate_add_conn * 1.5);
      config.mutation_rate_add_neuron = Math.min(0.08, config.mutation_rate_add_neuron * 1.5);
      config.weight_perturb_sigma = Math.min(0.3, config.weight_perturb_sigma * 1.2);
      config.compatibility_threshold = Math.max(1.0, config.compatibility_threshold * 0.9);
    } else {
      // Improving — allow convergence
      config.mutation_rate_add_conn = Math.max(0.02, config.mutation_rate_add_conn * 0.8);
      config.mutation_rate_add_neuron = Math.max(0.01, config.mutation_rate_add_neuron * 0.8);
      config.weight_perturb_sigma = Math.max(0.05, config.weight_perturb_sigma * 0.9);
      config.compatibility_threshold = Math.min(5.0, config.compatibility_threshold * 1.1);
    }

    // Meta-evolve fitness weights if deeply stagnant (20+ gens)
    if (history.length >= 20) {
      var deep = history.slice(-20, -10);
      var dAvg = 0;
      for (var di = 0; di < deep.length; di++) dAvg += deep[di];
      dAvg /= deep.length;
      if (rAvg <= dAvg * 1.02) {
        var fw = sim.worldData.neuro_fitness_weights;
        // Shift emphasis: reduce dominant, boost weakest
        var keys = ['movement', 'survival', 'interaction', 'efficiency', 'novelty'];
        var maxK = keys[0], minK = keys[0];
        for (var ki = 1; ki < keys.length; ki++) {
          if (fw[keys[ki]] > fw[maxK]) maxK = keys[ki];
          if (fw[keys[ki]] < fw[minK]) minK = keys[ki];
        }
        fw[maxK] = Math.max(0.05, fw[maxK] - 0.03);
        fw[minK] = Math.min(0.4, fw[minK] + 0.03);
      }
    }
  }

  // Advance generation
  sim.worldData.neuro_generation = gen + 1;
  sim.worldData.neuro_tick = 0;
  sim.worldData.neuro_phase = 'evaluating';
})();
