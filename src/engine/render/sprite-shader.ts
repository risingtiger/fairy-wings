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
  @location(7) edges: vec4f,    // top fade, bottom fade (fractions of the quad height), -, -
};

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) local: vec2f,
  @location(2) color: vec4f,
  @location(3) fog: vec4f,
  @location(4) @interpolate(flat) params: vec4f, // saturation, flash, shape kind, shape param
  @location(5) @interpolate(flat) edges: vec2f,
};

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
  o.edges = q.edges.xy;
  return o;
}

@fragment fn fs_texture(v: VOut) -> @location(0) vec4f {
  var c = textureSample(tex, samp, v.uv); // premultiplied
  let ty = v.local.y * 0.5 + 0.5; // 0 at the quad's top edge
  c *= smoothstep(0.0, max(v.edges.x, 1e-5), ty) * smoothstep(0.0, max(v.edges.y, 1e-5), 1.0 - ty);
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
    default: {}
  }
  return vec4f(v.color.rgb, 1.0) * (v.color.a * a);
}
`;
