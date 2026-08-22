
fn visual_base2d(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = uni(0);
  // superimposed compute path: +uv.y points DOWN — flip into y-up world space
  let su = vec2f(uv.x, -uv.y);
  let camX = uni(8); let camY = uni(9);
  let HALF = 300.0;
  let wp = vec2f(camX + su.x * HALF, camY + su.y * HALF);
  let px = (uv * 0.5 + 0.5) * 512.0;
  let dawn = uni(11); let warmth = uni(12); let wind = uni(10);
  let bx = uni(1); let by = uni(2); let heat = uni(7);

  // ── sky ──
  let y01 = clamp((wp.y + 120.0) / 520.0, 0.0, 1.0);
  var c = mod_cf_sky(wp.x, y01, t, dawn, warmth);

  // ── parallax ridges ──
  let farWp = vec2f(camX * 0.35 + su.x * HALF, camY * 0.5 + su.y * HALF);
  let r1 = mod_cf_ridge(farWp, 5200.0, 1.5, -30.0, mix(vec3f(0.028, 0.045, 0.085), vec3f(0.35, 0.30, 0.34), dawn), c);
  c = mix(c, r1.rgb, r1.a * 0.85);
  let midWp = vec2f(camX * 0.62 + su.x * HALF, camY * 0.72 + su.y * HALF);
  let r2 = mod_cf_ridge(midWp, 2600.0, 1.15, -70.0, mix(vec3f(0.020, 0.030, 0.055), vec3f(0.22, 0.17, 0.20), dawn), c);
  c = mix(c, r2.rgb, r2.a * 0.92);

  // ── back snow ──
  c += vec3f(0.7, 0.78, 0.95) * mod_cf_snow(px + vec2f(camX * 0.4, -camY * 0.4), t, wind, 34.0, 0.6, dawn) * 0.35;

  // ── the gameplay terrain — the exact surface the doggo bounces on ──
  let hNear = mod_cf_h(wp.x);
  let dg = wp.y - hNear;
  let aa = HALF / 256.0;
  let gm = smoothstep(aa, -aa, dg);
  if (gm > 0.001) {
    let g = mod_cf_ground(wp, t, heat, bx, by, dawn, warmth);
    c = mix(c, g, gm);
  }

  // beacons/doors stripped — the base is FLAT; a fork paints its landmarks here

  // ── FROST GLOOMIES — bounce into every one of them ──
  for (var gi = 0; gi < 16; gi++) {
    if (gi >= popCount()) { break; }
    let e = pop(gi);
    let gd = wp - e.xy;
    if (dot(gd, gd) > 2500.0) { continue; }
    if (e.w < 1.0) {
      // popped: melting into warm sparks
      let er = 12.0 + (1.0 - e.w) * 30.0;
      let rd = abs(length(gd) - er) - 2.0;
      c += vec3f(1.6, 0.8, 0.25) * smoothstep(2.5, -1.0, rd) * e.w * 0.9;
      let ga = atan2(gd.y, gd.x);
      c += vec3f(2.0, 1.2, 0.4) * smoothstep(0.90, 1.0, sin(ga * 7.0 + e.z * 5.0)) * smoothstep(5.0, 0.0, abs(length(gd) - er)) * e.w;
      continue;
    }
    let wob = 1.0 + 0.08 * sin(e.z * 3.0);
    let bdg = length(gd * vec2f(1.0, 1.15)) - 12.0 * wob;
    // cold aura
    c += vec3f(0.25, 0.45, 0.75) * exp(-max(bdg, 0.0) * 0.18) * 0.25;
    if (bdg < 1.0) {
      var gc = mix(vec3f(0.30, 0.42, 0.66), vec3f(0.45, 0.60, 0.85), 0.5 + 0.5 * sin(f32(gi) * 2.3 + e.z));
      gc *= 0.8 + 0.4 * mod_cf_fbm(gd * 0.3 + e.z);
      gc *= 1.0 - smoothstep(-4.0, 0.5, bdg) * 0.35;
      let gl = length(gd - vec2f(-4.4, 2.8)); let gr = length(gd - vec2f(4.4, 2.8));
      gc = mix(gc, vec3f(0.95, 0.98, 1.0), smoothstep(2.7, 2.1, min(gl, gr)));
      gc = mix(gc, vec3f(0.05, 0.08, 0.16), smoothstep(1.3, 0.8, min(length(gd - vec2f(-4.0, 2.4)), length(gd - vec2f(4.8, 2.4)))));
      let b1 = sdSegment(gd, vec2f(-7.0, 7.0), vec2f(-1.8, 4.6)) - 1.0;
      let b2 = sdSegment(gd, vec2f(7.0, 7.0), vec2f(1.8, 4.6)) - 1.0;
      gc = mix(gc, vec3f(0.06, 0.10, 0.2), smoothstep(0.4, -0.4, min(b1, b2)));
      let fr = sdSegment(gd, vec2f(-2.6, -4.6), vec2f(2.6, -4.2)) - 0.9;
      gc = mix(gc, vec3f(0.06, 0.10, 0.2), smoothstep(0.4, -0.4, fr));
      c = mix(c, gc, smoothstep(1.0, -0.5, bdg));
    }
  }

  // ── THE DOGGO ──
  let dogP = vec2f(bx, by);
  let grabbed = uni(25);
  let anch = vec2f(uni(26), uni(27));
  let face = uni(34);
  let amb = mix(vec3f(0.55, 0.66, 0.90), vec3f(1.15, 0.98, 0.85), dawn);
  let lp0 = wp - dogP;
  let bd0 = length(lp0);
  // the collar lantern's warmth — small, alive
  let breathe = 0.9 + 0.1 * sin(t * 3.4);
  c += vec3f(1.3, 0.6, 0.2) * (heat * breathe * 18.0 / (bd0 * bd0 * 0.10 + 20.0));

  var bodyd = 100000.0;
  if (grabbed > 0.5) {
    // rubbery stretch: a tapered capsule from the grab anchor to the dragged pup
    let ab = dogP - anch;
    let abl = max(dot(ab, ab), 0.0001);
    let hseg = clamp(dot(wp - anch, ab) / abl, 0.0, 1.0);
    bodyd = length(wp - anch - ab * hseg) - mix(7.0, 14.0, hseg);
  } else {
    // squash & stretch along the motion
    let sxs = max(uni(36), 0.4);
    let q0 = rot2(-uni(35)) * lp0;
    bodyd = length(vec2f(q0.x / sxs, q0.y * sxs)) - 14.0;
  }

  if (bodyd < 26.0) {
    let cream = vec3f(0.93, 0.84, 0.66);
    let caramel = vec3f(0.72, 0.47, 0.24);
    // ears + tail behind the body
    let earDrop = clamp(uni(5) / 700.0, -1.0, 1.0) * 2.5;
    let e1 = length((lp0 - vec2f(-9.0, 11.0 + earDrop)) * vec2f(1.5, 0.85)) - 7.0;
    let e2 = length((lp0 - vec2f(9.0, 11.5 + earDrop)) * vec2f(1.5, 0.85)) - 7.0;
    let wag = sin(t * 10.0) * 2.5;
    let tl = length(lp0 - vec2f(-face * 15.0, 2.0 + wag * 0.4)) - 4.5;
    let acc = min(min(e1, e2), tl);
    c = mix(c, caramel * amb * (1.0 + heat * 0.6), smoothstep(1.0, -0.5, acc));
    if (bodyd < 1.2) {
      var bc = cream;
      bc = mix(bc, vec3f(1.0, 0.95, 0.80), smoothstep(0.0, -10.0, lp0.y) * 0.35);
      bc = mix(bc, caramel, smoothstep(6.5, 5.0, length(lp0 - vec2f(6.0 * face, 3.5))));
      bc *= amb * 1.18;
      bc *= 1.0 - smoothstep(-4.0, 0.5, bodyd) * 0.30;
      bc += vec3f(1.2, 0.6, 0.25) * heat * 0.20;
      c = mix(c, bc, smoothstep(1.2, -0.4, bodyd));
      // face — derpy on purpose
      let inb = smoothstep(0.5, -0.5, bodyd);
      let lean = clamp(uni(4) / 1000.0, -1.0, 1.0) * 3.0;
      let fp = dogP + vec2f(lean + face * 1.5, 2.0);
      var look = vec2f(face * 1.2, -0.3);
      let cur = vec2f(uni(37), uni(38));
      if (grabbed > 0.5) { look = normalize(anch - dogP + vec2f(0.001, 0.0)) * 1.7; }
      else if (abs(uni(4)) + abs(uni(5)) > 60.0) { look = normalize(vec2f(uni(4), uni(5))) * 1.5; }
      else if (length(cur - dogP) < 150.0) { look = normalize(cur - dogP + vec2f(0.001, 0.0)) * 1.6; }
      let eLp = wp - (fp + vec2f(-5.5, 3.0));
      let eRp = wp - (fp + vec2f(6.0, 2.6));
      c = mix(c, vec3f(0.99, 0.99, 0.97), smoothstep(4.3, 3.6, length(eLp)) * inb);
      c = mix(c, vec3f(0.99, 0.99, 0.97), smoothstep(3.5, 2.8, length(eRp)) * inb);
      c = mix(c, vec3f(0.10, 0.07, 0.05), smoothstep(2.0, 1.3, length(eLp - look - vec2f(0.5, -0.4))) * inb);
      c = mix(c, vec3f(0.10, 0.07, 0.05), smoothstep(1.8, 1.1, length(eRp - look * 0.35 - vec2f(-0.9, 0.5))) * inb);
      // muzzle + nose
      c = mix(c, vec3f(1.0, 0.96, 0.85) * amb, smoothstep(5.6, 4.7, length((wp - (fp + vec2f(0.5, -3.2))) * vec2f(0.9, 1.15))) * inb);
      c = mix(c, vec3f(0.16, 0.10, 0.08), smoothstep(2.3, 1.6, length((wp - (fp + vec2f(0.5, -1.6))) * vec2f(0.85, 1.2))) * inb);
      // tongue — flops harder with speed
      let flop = sin(t * 9.0) * (1.0 + uni(20) * 1.5);
      let tq = wp - (fp + vec2f(1.8 + flop * 0.5, -7.5 - flop * 0.6));
      let td = sdRoundedBox(tq, vec2f(2.3, 3.6), 2.0);
      c = mix(c, vec3f(0.95, 0.45, 0.50), smoothstep(0.6, -0.4, td) * inb);
      // collar + lantern tag
      let cq = wp - (dogP + vec2f(0.0, -8.5));
      let cd = sdRoundedBox(cq, vec2f(11.0, 1.8), 1.5);
      c = mix(c, vec3f(0.45, 0.10, 0.14) * amb + vec3f(0.20, 0.02, 0.02), smoothstep(0.5, -0.5, max(cd, bodyd - 1.0)));
      let tagd = length(wp - (dogP + vec2f(0.0, -11.5))) - 2.2;
      c = mix(c, vec3f(2.0, 1.2, 0.4), smoothstep(0.5, -0.5, tagd));
    }
  }

  // cursor halo — a soft firefly marking where your hand is on the fell
  let curP = vec2f(uni(37), uni(38));
  let curD = length(wp - curP);
  c += vec3f(0.9, 0.85, 0.7) * exp(-curD * curD / 60.0) * 0.40 * (1.0 - grabbed) * uni(24);
  c += vec3f(1.0, 0.8, 0.4) * smoothstep(1.6, 0.0, abs(curD - 13.0 - 2.0 * sin(t * 3.0))) * 0.12 * (1.0 - grabbed) * uni(24);

  // grab anchor + fling-direction hint
  if (grabbed > 0.5) {
    let ad = abs(length(wp - anch) - 6.0) - 1.0;
    c += vec3f(0.9, 0.95, 1.0) * smoothstep(0.8, -0.4, ad) * 0.6;
    let dir = anch - dogP;
    let dl = length(dir);
    if (dl > 4.0) {
      let nd = dir / dl;
      let along = dot(wp - anch, nd);
      let perp = abs(dot(wp - anch, vec2f(-nd.y, nd.x)));
      let dotm = smoothstep(0.5, 0.2, abs(fract(along / 14.0) - 0.5));
      let hint = step(0.0, along) * step(along, dl * 1.4) * smoothstep(2.2, 0.8, perp) * dotm;
      c += vec3f(1.4, 0.9, 0.4) * hint * uni(28) * 0.8;
    }
  }

  // sparks trail a fast pup — the ember heart it inherited
  let stoke = uni(20);
  if (stoke > 0.02 && bd0 < 90.0 && bd0 > 14.0) {
    let vx = uni(4);
    let back = vec2f(lp0.x + sign(vx) * bd0 * 0.5, lp0.y - bd0 * 0.18);
    let sp = mod_cf_hash(floor(back * 0.5 + vec2f(0.0, t * 9.0)));
    c += vec3f(2.2, 1.1, 0.25) * smoothstep(0.93, 0.995, sp) * stoke * smoothstep(90.0, 20.0, bd0);
  }

  // ── front snow, wind-bent, heaviest before dawn ──
  c += vec3f(0.85, 0.9, 1.05) * mod_cf_snow(px + vec2f(camX * 1.6, -camY * 1.6), t, wind, 60.0, 1.0, dawn) * 0.8;
  c += vec3f(0.7, 0.75, 0.9) * mod_cf_snow(px + vec2f(camX * 1.0, -camY), t + 40.0, wind, 45.0, 0.8, dawn) * 0.5;

  // intro fade from black
  c *= uni(24);
  return vec4f(c, 1.0);
}
