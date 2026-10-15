/** One instanced quad = 80 bytes. Keep in sync with QUAD_FLOATS / push() in sprite-renderer.ts. */
export const SPRITE_SHADER = /* wgsl */ `
struct View { scale: vec2f, offset: vec2f };
@group(0) @binding(0) var<uniform> view: View;
@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;

struct Quad {
  @location(0) pos: vec2f,      // anchor, camera-relative world units
  @location(1) size: vec2f,     // world units; negative x mirrors
  @location(2) uv: vec4f,       // u0 v0 u1 v1 (shapes: kind, param, -, -)
  @location(3) origin: vec2f,   // anchor inside the quad, 0..1
  @location(4) params: vec4f,   // rotation, skew, saturation, flash
  @location(5) color: vec4f,    // tint rgb + opacity
  @location(6) fog: vec4f,      // haze rgb + amount
  @location(7) edges: vec4f,    // top / bottom fade (fractions of the quad height), left / right ragged cut (of its width)
};

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) local: vec2f,
  @location(2) color: vec4f,
  @location(3) fog: vec4f,
  @location(4) @interpolate(flat) params: vec4f, // saturation, flash, shape kind, shape param
  @location(5) @interpolate(flat) edges: vec4f,
};

// Value noise from an integer hash (no sin(), which loses precision on some mobile GPUs).
fn hash(p: vec2f) -> f32 {
  let q = vec2u(vec2i(floor(p)) + vec2i(65536));
  var h = (q.x * 1597334673u) ^ (q.y * 3812015801u);
  h = (h ^ (h >> 16u)) * 2246822519u;
  return f32(h ^ (h >> 13u)) / 4294967295.0;
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x), u.y);
}

fn fbm(p: vec2f) -> f32 { return noise(p) * 0.65 + noise(p * 2.7 + 17.0) * 0.35; }

// Where a ragged cut leaves a texture (1 inside, 0 cut away): d is the distance from the cut edge and
// w the cut's width (fractions of the quad), n a noise value that moves the line about within it, and
// ty how far down the quad: the line leans in toward the bottom, like the end of a floating island.
fn ragged(d: f32, w: f32, n: f32, ty: f32) -> f32 {
  if (w <= 0.0) { return 1.0; }
  let t = 0.38 * ty + 0.56 * smoothstep(0.2, 0.8, n);
  return smoothstep(t, t + 0.05, d / w);
}

// Cellular noise: the offset from p to the nearest of points scattered one per cell, and that point's random id.
fn cells(p: vec2f) -> vec3f {
  let i = floor(p);
  let f = fract(p);
  var best = vec3f(8.0, 8.0, 0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2f(f32(x), f32(y));
      let o = g + vec2f(hash(i + g), hash(i + g + 41.0)) * 0.7 + 0.15 - f;
      if (dot(o, o) < dot(best.xy, best.xy)) { best = vec3f(o, hash(i + g + 83.0)); }
    }
  }
  return best;
}

// A floating piece of meadow (a moving platform): grass on top with tufts and flowers, round mossy
// boulders underneath tapering to a point, moss and vines hanging off it. p is the quad's -1..1 space
// (y down); k is its width / height (under 8) plus 8 x a whole-number seed, so no two islands need look
// the same. The walking surface is at p.y = -0.38. Returns straight (not premultiplied) colour and coverage.
fn island(p: vec2f, k: f32) -> vec4f {
  let n = floor(k / 8.0);
  let aspect = k - n * 8.0;
  let seed = n * 13.7;
  let s = vec2f(p.x * aspect, p.y); // in half-heights
  let ax = abs(s.x);
  let hx = aspect - 0.08; // half its width along the top
  if (ax > aspect || s.y < -0.62) { return vec4f(0.0); }
  let aa = 0.012;

  // the top is flat, rounding off at the ends, with uneven blades of grass standing up along it
  let r = 0.22;
  let over = max(ax - (hx - r), 0.0);
  let top = -0.38 + r - sqrt(max(r * r - over * over, 0.0));
  var blades = 0.0;
  for (var i = 0; i < 2; i++) {
    let b = s.x * (11.0 + 6.0 * f32(i)) + seed + f32(i) * 0.5;
    let u = fract(b) * 2.0 - 1.0;
    blades = max(blades, (0.03 + 0.1 * hash(vec2f(floor(b), seed + f32(i)))) * (1.0 - abs(u + 0.3 * (1.0 - abs(u)))));
  }
  blades *= 1.0 - smoothstep(hx - 0.3, hx, ax);
  let d = s.y - top; // depth below the grass
  // a thick lip of grass, then the body narrowing to a point
  let band = 0.15 + 0.07 * noise(vec2f(s.x * 7.0 + seed, 1.0));
  let u = clamp((d - band) / (1.33 - band), 0.0, 1.0);
  let rough = (fbm(vec2f(s.y * 6.0 + seed, sign(s.x) * 5.0)) - 0.5) * 1.3 * u * (1.0 - u);
  let hw = select(hx * 0.9 * (1.0 - pow(u, 1.2)) * (1.0 - 0.15 * u) + rough, hx, d < band);
  var a = smoothstep(0.0, aa, hw - ax) * smoothstep(0.0, aa, d + blades) * step(s.y, 0.95);

  // grass and moss are little leaves, each its own green, lit from the upper left
  let leaf = cells(s * vec2f(10.0, 13.0) + vec2f(seed, 3.0));
  let leafRel = -leaf.xy / 0.62;
  let leafy = (0.78 + 0.3 * dot(leafRel, vec2f(-0.6, -0.8))) * (1.0 - 0.3 * smoothstep(0.55, 1.0, length(leafRel)));
  // grass: darker deeper in, a bright lime line along the top like the meadow's, lighter blade tips
  var grass = mix(vec3f(0.30, 0.62, 0.12), vec3f(0.50, 0.79, 0.18), leaf.z) * leafy;
  grass = mix(grass, vec3f(0.15, 0.42, 0.10), smoothstep(0.02, band, d));
  grass = mix(grass, vec3f(0.80, 0.95, 0.30), (1.0 - smoothstep(0.0, 0.035, abs(d - 0.012))) * 0.8);
  grass = mix(grass, vec3f(0.70, 0.92, 0.28), smoothstep(0.0, blades + 0.001, -d) * 0.8);
  // underneath: round grey-pink boulders in dark soil, each lit from the upper left
  let c = cells(s * 2.2 + vec2f(seed, 0.0));
  let rel = -c.xy / (0.66 + 0.1 * c.z); // from the boulder's middle, in its radii
  let light = dot(rel, vec2f(-0.6, -0.8));
  let rock = mix(vec3f(0.58, 0.51, 0.49), vec3f(0.86, 0.80, 0.75), c.z) * (0.86 + 0.24 * light) * (1.0 - 0.3 * smoothstep(0.55, 1.0, length(rel)))
    * (0.9 + 0.2 * noise(s * 18.0 + seed));
  let boulder = 1.0 - smoothstep(0.86, 0.98, length(rel));
  var body = mix(vec3f(0.34, 0.25, 0.21), rock, boulder);
  // moss hangs in drips from under the grass, and caps the tops of some boulders
  let moss = mix(vec3f(0.16, 0.42, 0.12), vec3f(0.36, 0.64, 0.17), leaf.z) * leafy;
  let drip = band + 0.05 + 0.24 * fbm(vec2f(s.x * 5.0 + seed, 7.0));
  let capped = boulder * smoothstep(0.2, 0.6, light) * step(0.45, noise(s * 3.0 + vec2f(seed + 5.0, 0.0)));
  body = mix(body, moss, max(1.0 - smoothstep(drip - 0.03, drip, d), capped * 0.9));
  body *= 0.55 + 0.45 * smoothstep(band, band + 0.1, d); // in the shade of the grass lip
  var col = mix(grass, body, smoothstep(band - aa, band + aa, d));

  // leafy vines trailing from under the grass, some on past the boulders
  let vx = s.x * 4.0 + seed;
  let slot = floor(vx);
  let reach = band + 0.2 + 0.75 * hash(vec2f(slot, seed + 3.0));
  let thick = 0.12 + 0.1 * abs(sin(s.y * 26.0 + slot * 1.7)) * (1.0 - smoothstep(reach - 0.15, reach, d));
  let vine = (1.0 - smoothstep(thick - 0.04, thick, abs(fract(vx) - 0.5 + sin(s.y * 9.0 + slot * 2.3) * 0.12)))
    * step(0.55, hash(vec2f(slot, seed + 9.0))) * step(band * 0.6, d) * step(d, reach) * step(ax, hx * 0.9);
  col = mix(col, mix(vec3f(0.10, 0.36, 0.14), vec3f(0.26, 0.58, 0.18), noise(s * vec2f(12.0, 30.0) + seed)), vine);
  a = max(a, vine);

  // flowers in the grass, white, pink, violet or blue with golden middles
  let fx = s.x * 1.6 + seed + 0.5;
  let fc = floor(fx);
  let centre = vec2f((fc + 0.3 + 0.4 * hash(vec2f(fc, seed + 22.0)) - seed - 0.5) / 1.6, -0.42 + 0.12 * hash(vec2f(fc, seed + 23.0)));
  let q = s - centre;
  let size = 0.1 + 0.06 * hash(vec2f(fc, seed + 24.0));
  let spin = hash(vec2f(fc, seed + 21.0));
  let petal = size * (0.6 + 0.4 * abs(cos(2.5 * atan2(q.y, q.x) + spin * 9.0)));
  let bloom = (1.0 - smoothstep(petal - aa, petal, length(q))) * step(0.35, spin) * step(abs(centre.x), hx - 0.3);
  let hue = hash(vec2f(fc, seed + 25.0));
  var petals = vec3f(0.98, 0.97, 0.93);
  if (hue > 0.72) { petals = vec3f(1.0, 0.58, 0.78); } else if (hue > 0.5) { petals = vec3f(0.72, 0.54, 0.98); } else if (hue > 0.35) { petals = vec3f(0.52, 0.72, 1.0); }
  col = mix(col, petals * (1.0 - 0.25 * length(q) / size), bloom);
  col = mix(col, vec3f(1.0, 0.80, 0.25), (1.0 - smoothstep(size * 0.28 - aa, size * 0.28, length(q))) * bloom);
  a = max(a, bloom);

  // lit from the upper left; the underside darker, and tinged with the violet magic that holds it up
  let t = clamp((s.y + 0.38) / 1.33, 0.0, 1.0);
  col *= 1.05 - 0.3 * smoothstep(0.1, 1.0, t) - 0.1 * clamp(s.x / hx, -1.0, 1.0);
  col = mix(col, vec3f(0.55, 0.40, 0.90), 0.24 * smoothstep(0.45, 1.0, t));
  return vec4f(col, a);
}

@vertex fn vs(@builtin(vertex_index) vi: u32, q: Quad) -> VOut {
  let corner = vec2f(f32(vi & 1u), f32(vi >> 1u));
  var p = (corner - q.origin) * q.size;
  p.x += p.y * q.params.y;
  let c = cos(q.params.x);
  let s = sin(q.params.x);
  p = vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
  var o: VOut;
  o.pos = vec4f((q.pos + p) * view.scale + view.offset, 0.0, 1.0);
  o.uv = mix(q.uv.xy, q.uv.zw, corner);
  o.local = corner * 2.0 - 1.0;
  o.color = q.color;
  o.fog = q.fog;
  o.params = vec4f(q.params.z, q.params.w, q.uv.x, q.uv.y);
  o.edges = q.edges;
  return o;
}

@fragment fn fs_texture(v: VOut) -> @location(0) vec4f {
  var c = textureSample(tex, samp, v.uv); // premultiplied
  let ty = v.local.y * 0.5 + 0.5; // 0 at the quad's top edge
  c *= smoothstep(0.0, max(v.edges.x, 1e-5), ty) * smoothstep(0.0, max(v.edges.y, 1e-5), 1.0 - ty);
  if (v.edges.z + v.edges.w > 0.0) {
    // cut off raggedly at the side (the ground stopping at a gap): the line wanders with noise laid
    // over the image (24 bumps to its height, at either art size), so it ends in clumps and stray
    // leaves like a hedge, not like a knife cut
    let tx = v.local.x * 0.5 + 0.5;
    let dims = vec2f(textureDimensions(tex));
    let n = fbm(v.uv * vec2f(dims.x / dims.y, 1.0) * 24.0);
    c *= ragged(tx, v.edges.z, n, ty) * ragged(1.0 - tx, v.edges.w, n, ty);
  }
  let grey = dot(c.rgb, vec3f(0.299, 0.587, 0.114));
  var rgb = mix(vec3f(grey), c.rgb, v.params.x);
  rgb = mix(rgb, v.fog.rgb * c.a, v.fog.a);
  rgb = mix(rgb, vec3f(c.a), v.params.y);
  return vec4f(rgb * v.color.rgb, c.a) * v.color.a;
}

// Procedural shapes in the quad's -1..1 space. Output is premultiplied: colour * coverage.
@fragment fn fs_shape(v: VOut) -> @location(0) vec4f {
  let p = v.local;
  let r = length(p);
  let k = v.params.w;
  var a = 0.0;
  var rgb = v.color.rgb;
  switch u32(v.params.z + 0.5) {
    case 0u: { // soft glow; k sharpens the falloff
      a = pow(saturate(1.0 - r), 2.0 + k);
    }
    case 1u: { // four-point sparkle
      let rays = saturate(1.0 - abs(p.x * p.y) * 14.0) * pow(saturate(1.0 - r), 1.2);
      a = max(rays * rays, pow(saturate(1.0 - r * 1.8), 1.5));
    }
    case 2u: { // ring; k = thickness
      a = pow(saturate(1.0 - abs(r - (1.0 - k)) / k), 2.0);
    }
    case 3u: { // crescent slash, bulging toward +x
      let outer = saturate((1.0 - r) * 10.0);
      let inner = saturate((length(p - vec2f(-0.42, 0.0)) - 0.8) * 9.0);
      let lead = saturate(p.x * 0.9 + 0.55);
      a = outer * inner * lead;
    }
    case 4u: { // magic orb: hot core inside a soft halo
      a = pow(saturate(1.0 - r), 3.0) * 0.55 + pow(saturate(1.0 - r * 2.2), 1.5);
    }
    case 5u: { // soft ellipse/disc (shadows, dust)
      a = 1.0 - smoothstep(0.2 + 0.6 * k, 1.0, r);
    }
    case 6u: { // beam of light from the -x end, widening and fading toward +x (god rays); k narrows it
      let along = p.x * 0.5 + 0.5;
      let w = mix(0.15, 1.0, along);
      a = pow(saturate(1.0 - abs(p.y) / w), 2.0 + k) * pow(1.0 - along, 1.3) * saturate(along * 8.0);
    }
    case 7u: { // heart, point down; k softens the edge
      let h = vec2f(abs(p.x), -p.y) * 0.62 + vec2f(0.0, 0.55);
      var d = 0.0;
      if (h.y + h.x > 1.0) {
        d = length(h - vec2f(0.25, 0.75)) - 0.35355;
      } else {
        let m = vec2f(0.5 * max(h.x + h.y, 0.0));
        d = sqrt(min(dot(h - vec2f(0.0, 1.0), h - vec2f(0.0, 1.0)), dot(h - m, h - m))) * sign(h.x - h.y);
      }
      a = 1.0 - smoothstep(-0.02 - k * 0.25, 0.02, d);
    }
    case 8u: { // rounded square filling the quad; k = corner radius (0 sharp .. 1 round)
      let q = abs(p) - vec2f(1.0 - k);
      let d = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - k;
      a = 1.0 - smoothstep(-0.03, 0.0, d);
    }
    case 9u: { // five-point star, point up, tips touching the quad's edge; k = inner radius (0.38 classic, 0.5 chubby)
      let k1 = vec2f(0.809016994, -0.587785252);
      let k2 = vec2f(-k1.x, k1.y);
      var s = vec2f(abs(p.x), -p.y);
      s -= 2.0 * max(dot(k1, s), 0.0) * k1;
      s -= 2.0 * max(dot(k2, s), 0.0) * k2;
      s.x = abs(s.x);
      s.y -= 1.0;
      let ba = k * vec2f(-k1.y, k1.x) - vec2f(0.0, 1.0);
      let h = clamp(dot(s, ba) / dot(ba, ba), 0.0, 1.0);
      let d = length(s - ba * h) * sign(s.y * ba.x - s.x * ba.y);
      a = 1.0 - smoothstep(-0.03, 0.0, d);
    }
    case 10u: { // floating island (see island()): its own colours, tinted by the quad's
      let c = island(p, k);
      rgb *= c.rgb;
      a = c.a;
    }
    case 11u: { // fade: clear along the top edge, solid from k of the way down
      a = smoothstep(-1.0, -1.0 + 2.0 * max(k, 0.001), p.y);
    }
    default: {}
  }
  return vec4f(rgb, 1.0) * (v.color.a * a);
}
`;
