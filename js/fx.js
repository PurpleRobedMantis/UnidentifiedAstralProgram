// Shaders and effect objects for the final act (the palace, the jesters, the flower, the doors, the council).
// Everything here is unlit ShaderMaterial work written in GLSL ES 1.0 style so it runs on WebGL1-class hardware.
// Each maker returns a Mesh (or a small controller object); the caller advances material.uniforms.uT every frame.
import * as THREE from 'three';
import { FACE } from './jester-face.js';

// ---------- shared GLSL ----------
const COMMON = `
const float K_PI = 3.14159265;
const float K_TAU = 6.2831853;
const vec3 PINK = vec3(1.0, 0.25, 0.66);
const vec3 PURP = vec3(0.46, 0.12, 0.88);
const vec3 GRN = vec3(0.2, 0.95, 0.5);
const vec3 GOLD = vec3(1.0, 0.8, 0.3);
const vec3 INK = vec3(0.05, 0.01, 0.12);
float hash11(float n){ return fract(sin(n*127.1)*43758.5453); }
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float amp = 0.5;
  float sum = 0.0;
  for (int i = 0; i < 4; i++) {
    sum += amp*vnoise(p);
    p = p*2.03 + vec2(17.1, 9.3);
    amp *= 0.5;
  }
  return sum;
}
// 1 inside (d < 0), 0 outside, antialiased over +-w
float fillAA(float d, float w){ return 1.0 - smoothstep(-w, w, d); }
float segD(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0);
  return length(pa - ba*h);
}
float taperD(vec2 p, vec2 a, vec2 b, float ra, float rb){
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0);
  return length(pa - ba*h) - mix(ra, rb, h);
}
`;

const VS_UV = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// For a big inside-out box centred on the camera: the fragment gets a world-space view direction.
const VS_SKY = `
varying vec3 vDir;
void main(){
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// ---------- 1. the checkered palace (analytic, no raymarch) ----------
// A colossal nave under a barrel vault: an arcade of tall arches on piers with a gallery above it, and through the
// arches arcade behind arcade of side aisles. Every forty metres the hall ends in a cross-wall with a rose window
// (a Poincare-disc tiling) over three doorways, and each doorway opens on a whole new hall of the same size, the
// outer two leaning away from the middle one: more room than the space can hold, branching again and again to the
// horizon. Everything is intersected in closed form. Strictly black and white.
// The jesters live in here too (FACE): each is a patch of the hall's own surface that swells into a face, so the
// wall's pattern runs unbroken across it. uJa[i] = (side -1/+1, height up the wall or over the vault, world z, size),
// uJb[i] = (how far it has swollen out 0..1, mood 0 frown..1 grin, head tilt, pointing hand -1/0/+1).
// the jester faces are drawn by FACE, kept in jester-face.js so they can be edited on their own
const PALACE_FRAG = `
uniform float uT;
uniform float uZ;
uniform float uFocus;
uniform float uBurn;
uniform vec3 uLight;
uniform float uFry;
uniform float uQ;
uniform float uPx;   // the angle one screen pixel covers, set each frame from the real resolution and field of view
uniform vec4 uJa[4];
uniform vec4 uJb[4];
varying vec3 vDir;
${COMMON}
${FACE}
const float BAY = 8.0;
const float JL = 40.0;
const float AHW = 2.6;
const float AHS = 8.0;
const float ARISE = 1.9494;   // apex height above the springing, in half-widths: sqrt(2*PK - 1) for PK 2.4
// pure black and white checks, bent and always sliding: the pattern swims across every surface of the palace
float chk(vec2 p, float w){
  p += 0.22*sin(p.yx*0.55 + vec2(uT*0.7, uT*0.9)) + vec2(uT*0.18, uT*0.11);
  // square-cornered: each axis is a hard sign, softened only across the pixel footprint at the cell edges
  float wf = max(w, 0.0001);
  float gx = clamp(sin(K_PI*p.x)/wf, -1.0, 1.0);
  float gy = clamp(sin(K_PI*p.y)/wf, -1.0, 1.0);
  return 0.5 + 0.5*gx*gy;
}
float dia(vec2 p, float w){ return chk(vec2(p.x + p.y, p.x - p.y), w); }
// every arch in the palace is pointed (Gothic): each side is an arc of radius PK*hw whose centre lies on the springing line,
// toward the far side, so the two arcs meet in a point. PK 1 would be round; 2 is the equilateral arch.
const float PK = 2.4;   // lancet: tall and sharp
// > 0 inside a pointed opening of half-width hw whose arcs spring at height hs (apex at hs + hw*sqrt(2*PK - 1))
float archIn(vec2 q, float hw, float hs){
  float R = PK*hw;
  return (q.y < hs) ? hw - abs(q.x) : R - length(vec2(abs(q.x) - hw + R, q.y - hs));
}
// distance travelled up one side and over its arc to the point, for voussoir stripes
float archArc(vec2 q, float hw, float hs){
  float R = PK*hw;
  return (q.y < hs) ? q.y : hs + R*atan(max(q.y - hs, 0.0), abs(q.x) - hw + R);
}
float bayZ(float z){ return mod(z + 0.5*BAY, BAY) - 0.5*BAY; }
// the whole palace curves: the hall's centre line bends sideways by CRV*z*z/2 at depth z, so its far end is always round
// the bend and never in sight. In hall coordinates a straight ray x0 + sx*z becomes x0 + sx*z - CRV*z*z/2.
const float CRV = 0.0;   // no sideways bend (the hall only curves up and down)
// and it curves vertically too: CRVY < 0 the hall falls away ahead over a crest, > 0 it rises ahead like a ramp.
// In hall coordinates a straight ray's height y0 + sy*z becomes y0 + sy*z - CRVY*z*z/2.
float CRVY = 0.0;   // set at the top of main(): drifts slowly between a slight rise and a slight fall (keep PAL_CRVY in step)
// depth at which a bent ray (start x0, slope sx, curve c) meets the hall line X; 100000 if it never does
float bendHitC(float x0, float sx, float X, float c){
  float a = -0.5*c;
  if (abs(a) < 0.000001) { float r0 = (X - x0)/(abs(sx) < 0.00001 ? (sx < 0.0 ? -0.00001 : 0.00001) : sx); return (r0 > 0.0001) ? r0 : 100000.0; }
  float disc = sx*sx - 4.0*a*(x0 - X);
  if (disc < 0.0) return 100000.0;
  float sq = sqrt(disc);
  float r1 = (-sx - sq)/(2.0*a);
  float r2 = (-sx + sq)/(2.0*a);
  float r = 100000.0;
  if (r1 > 0.0001) r = r1;
  if (r2 > 0.0001) r = min(r, r2);
  return r;
}
float bendHit(float x0, float sx, float X){ return bendHitC(x0, sx, X, CRV); }
float hallY(vec3 p){ return p.y - 0.5*CRVY*p.z*p.z; }
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
vec2 cdiv(vec2 a, vec2 b){ return vec2(a.x*b.x + a.y*b.y, a.y*b.x - a.x*b.y)/dot(b, b); }
// chequered {6,4} tiling of the Poincare disc: cells crowd without end toward the rim
float hyp(vec2 z){
  float par = 0.0;
  float an = 0.0;
  for (int i = 0; i < 7; i++) {
    an = mod(atan(z.y, z.x) + 0.5236, 1.0472) - 0.5236;
    z = length(z)*vec2(cos(an), sin(an));
    vec2 dz = z - vec2(1.41421, 0.0);
    float l2 = dot(dz, dz);
    if (l2 >= 1.0) break;
    z = vec2(1.41421, 0.0) + dz/l2;
    par += 1.0;
  }
  return mod(par + step(0.0, an), 2.0);
}
// an arcade wall in (along, up) coordinates; d = archIn (negative: solid), top = where its cornice sits
float wallPat(vec2 q, float zz, float d, float foot, float top, out vec2 suv, out float nest){
  nest = 0.0;
  suv = vec2(zz, q.y);
  float e = -d;
  float v;
  if (q.y > top - 0.9) {
    v = chk(vec2(zz*2.5, q.y*2.5), foot*2.5);
  } else if (q.y > AHS + AHW*ARISE + 1.0 && q.y < top - 1.2) {
    // the gallery: a run of small pointed arches, each filled with finer checks running the other way
    vec2 gq = vec2(mod(zz + 1.0, 2.0) - 1.0, q.y - (AHS + AHW*ARISE + 1.0));
    float dg = archIn(gq, 0.7, 1.0);
    if (dg > 0.0) v = 1.0 - chk(vec2(zz*4.0, q.y*4.0), foot*4.0);
    else v = chk(vec2(zz*2.0, q.y*2.0), foot*2.0);
  } else {
    v = chk(suv, foot);
  }
  return v;
}

float PXS = 1.0;   // scales the pattern filtering: narrower when several samples share a pixel
// the whole palace, seen along one direction; t = distance to what was hit
vec4 palace(vec3 vD, out float tOut){
  CRVY = 0.0012*sin(uT*0.13);
  vec3 rd0 = normalize(vD);
  vec3 rd = rd0;
  vec2 nc = vec2(atan(rd0.x, -rd0.z), asin(clamp(rd0.y, -1.0, 1.0)));
  float fry = 0.35 + 0.65*uFry;

  // melting film drags the picture about as it burns
  if (uBurn > 0.0) {
    vec2 mv = vec2(vnoise(nc*2.3 + vec2(0.0, uT*0.9)), vnoise(nc*2.3 + vec2(7.7, -uT*0.7))) - 0.5;
    rd.xy += mv*uBurn*0.55;
    rd.y += uBurn*uBurn*0.3*(0.4 + vnoise(nc*5.0));
    rd = normalize(rd);
  }

  // fried: thin slices of the picture slip sideways, thin columns slip up or down
  {
    float slot = floor(uT*5.0);
    float band = floor(nc.y*46.0);
    float slip = step(1.0 - 0.1*fry, hash11(band*1.31 + slot*7.7));
    rd.x += slip*(hash11(band + slot*3.1) - 0.5)*0.1;
    float colm = floor(nc.x*30.0);
    float slipV = step(1.0 - 0.05*fry, hash11(colm*2.17 + slot*5.3));
    rd.y += slipV*(hash11(colm + slot*1.9) - 0.5)*0.07;
    rd = normalize(rd);
  }

  // the hall rolls gently, and winds itself up toward the vanishing point
  float rho = length(rd.xy)/max(abs(rd.z), 0.001);
  // disorienting: the whole hall leans and rolls one way then the other, the far end corkscrews harder
  float tw = 0.2*sin(uT*0.23) + 0.08*sin(uT*0.61) + 0.9*sin(uT*0.17)*exp(-rho*2.5);
  float cs = cos(tw);
  float sn = sin(tw);
  rd.xy = vec2(cs*rd.x - sn*rd.y, sn*rd.x + cs*rd.y);
  // and space itself ripples, slowly, as if seen through moving water
  rd.xy += 0.035*vec2(sin(rd.y*5.0 + uT*0.8), sin(rd.x*5.0 - uT*0.7));
  rd = normalize(rd);

  // breathing
  float W = 6.0*(1.0 + 0.045*sin(uT*0.8));
  float H0 = 19.0 + 0.25*sin(uT*0.6 + 1.0);
  vec3 ro = vec3(0.0, 1.6, 0.0);
  float px = uPx*PXS;   // was a fixed 0.0008, about 2x too fine at the game's view, so distant patterns were under-filtered and shimmered

  // ---- faces: bend the ray where a face is swelling out of the surface, so the surface's own pattern bulges ----
  float fSel = 0.0;
  vec2 fp = vec2(0.0);
  float fT = 0.0;
  vec4 fB = vec4(0.0);
  float fAA = 0.01;
  float fTime = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 ja = uJa[i];
    vec4 jb = uJb[i];
    if (ja.w <= 0.0 || jb.x <= 0.0) continue;
    vec3 A = vec3(ja.x*W, ja.y, ja.z);
    vec3 N = vec3(-ja.x, 0.0, 0.0);
    vec3 U = vec3(0.0, 1.0, 0.0);
    if (ja.y > H0) {
      float ph = (ja.y - H0)/W;
      A = vec3(ja.x*W*cos(ph), H0 + W*sin(ph), ja.z);
      N = -vec3(ja.x*cos(ph), sin(ph), 0.0);
      U = vec3(-ja.x*sin(ph), cos(ph), 0.0);
    }
    A.x += 0.5*CRV*A.z*A.z;
    A.y += 0.5*CRVY*A.z*A.z;
    vec3 R = vec3(0.0, 0.0, ja.x);
    float dn = dot(rd, N);
    if (dn > -0.02) continue;
    float tp = dot(A - ro, N)/dn;
    if (tp <= 0.0) continue;
    vec3 dP = ro + rd*tp - A;
    vec2 q = vec2(dot(dP, R), dot(dP, U))/ja.w;
    if (abs(q.x) > 2.5 || q.y > 3.0 || q.y < -2.0) continue;
    float cr = cos(jb.z);
    float sr = sin(jb.z);
    vec2 qr = vec2(cr*q.x - sr*q.y, sr*q.x + cr*q.y);
    float ft = uT + float(i)*3.7;
    vec2 wr = faceWarp(qr, ft)*jb.x;
    vec2 qs = q + vec2(cr*wr.x + sr*wr.y, -sr*wr.x + cr*wr.y);
    vec3 P2 = A + (R*qs.x + U*qs.y)*ja.w;
    rd = normalize(P2 - ro);
    fSel = 1.0;
    fp = qr;
    fT = length(P2 - ro);
    fB = jb;
    fTime = ft;
    fAA = 1.5*px*tp/(ja.w*max(-dn, 0.2));
  }

  // ---- the hall branches: every JL metres a cross-wall with three doorways, each onto a whole new hall ----
  float nf = 0.0;
  float sideH = 0.0;   // 1 once the ray has gone through a side doorway into one of the leaning halls
  float endHit = 0.0;
  vec3 ew = vec3(0.0);
  float exw = 0.0;
  float eD = 0.0;
  if (rd.z < -0.02) {
    float sx = rd.x/(-rd.z);
    float sy = rd.y/(-rd.z);
    float x0 = 0.0;
    float D = JL - mod(uZ + 4.0, JL);
    float cO = W*0.6667;
    for (int n = 0; n < 5; n++) {
      float Dn = D + float(n)*JL;
      float sxs = (sx >= 0.0) ? max(sx, 0.00001) : min(sx, -0.00001);
      float zW = min(bendHit(x0, sx, W), bendHit(x0, sx, -W));
      if (zW < Dn) break;
      // a dipping hall curves its floor back up: a ray that already met the floor stays on it (no trails through it)
      if (bendHitC(ro.y, sy, 0.0, CRVY) < Dn) break;
      float yw = ro.y + sy*Dn - 0.5*CRVY*Dn*Dn;
      float xw = x0 + sxs*Dn - 0.5*CRV*Dn*Dn;
      if (yw < 0.0 || yw > H0 + sqrt(max(W*W - xw*xw, 0.0))) break;
      float side = step(cO*0.5, abs(xw));
      float xo = mix(xw, abs(xw) - cO, side);
      float dO = archIn(vec2(xo, yw), 1.6, 7.0);
      if (dO > 0.0) {
        // through a side doorway: a new hall on its own axis, leaning away from the one beside it
        if (side > 0.5) {
          float sg = (xw >= 0.0) ? 1.0 : -1.0;
          // the new hall's line through the doorway, re-expressed so it bends the same way from its own start
          float Xd = sg*xw - cO;
          float Sd = sg*(sx - CRV*Dn) - 0.07;
          x0 = Xd - Sd*Dn - 0.5*CRV*Dn*Dn;
          sx = Sd + CRV*Dn;
          sideH = 1.0;
        }
        nf += 1.0;
      } else {
        endHit = 1.0;
        ew = vec3(xo, yw, dO);
        exw = xw;
        eD = Dn;
        break;
      }
    }
    rd = normalize(vec3(sx, sy, -1.0));
    ro.x = x0;
  }

  float kz = max(abs(rd.z), 0.0001);
  float sxe = rd.x/kz;
  float zA = bendHit(ro.x, sxe, W);
  float zB = bendHit(ro.x, sxe, -W);
  float sX = (zA < zB) ? 1.0 : -1.0;
  float zHit = min(zA, zB);
  float tW = zHit/kz;
  float ax = max(abs(rd.x - CRV*zHit*kz), 0.0001);
  float sye = rd.y/kz;
  float yW = ro.y + rd.y*tW - 0.5*CRVY*zHit*zHit;
  float tF = bendHitC(ro.y, sye, 0.0, CRVY)/kz;
  float t = tF;
  float v = 0.5;
  float shade = 1.0;
  float foot = 0.01;
  vec2 suv = vec2(0.0);   // surface coordinates of whatever was hit, for the nested detail
  float nest = 0.0;       // 0 none, 1 nested checker, 2 the floor's little doorways

  if (endHit > 0.5) {
    // the cross-wall: voussoirs round its doorways, a rose window over them
    t = eD/max(-rd.z, 0.001);
    foot = K_PI*px*t;
    shade = 0.92;
    float e = -ew.z;
    vec2 rz = (vec2(exw, ew.y) - vec2(0.0, 16.2))/4.6;
    float rr = length(rz);
    if (rr < 1.0) {
      vec2 a = 0.35*vec2(cos(uT*0.2), sin(uT*0.2));
      vec2 hz = cdiv(rz - a, vec2(1.0, 0.0) - cmul(vec2(a.x, -a.y), rz));
      v = mix(0.5, hyp(hz), clamp((1.0 - dot(hz, hz))*1.05/(px*t*2.4), 0.0, 1.0));
    } else if (rr < 1.1) {
      v = smoothstep(-0.3, 0.3, sin(atan(rz.y, rz.x)*36.0))*smoothstep(0.0, 0.012, min(rr - 1.0, 1.1 - rr));
    } else {
      suv = vec2(exw, ew.y);
      v = chk(suv, foot);
      nest = 1.0;
    }
  } else if (yW < 0.0 || tF < tW) {
    // nave floor: checker, with a harlequin runner down the middle
    t = tF;
    vec3 p = ro + rd*t;
    p.x -= 0.5*CRV*p.z*p.z;
    vec2 q = vec2(p.x, p.z - uZ);
    q += 0.07*sin(q.yx*0.9 + uT*1.3);
    foot = K_PI*px*t/max(abs(rd.y), 0.008);
    v = chk(q, foot);



    shade = 1.0;
    // the runner and its black border belong to the hall you walk down only: in the side halls they read as paths that
    // lead nowhere. Far off they fade out before their dark lines merge into a smear at the vanishing point.
    float farFade = (1.0 - sideH)*(1.0 - smoothstep(0.15, 0.45, foot));
    float run = (1.0 - smoothstep(0.66, 0.7, abs(p.x)))*farFade;
    v = mix(v, dia(vec2(q.x*2.0, q.y), foot*2.0), run);
    float border = 1.0 - smoothstep(0.0, 0.03 + foot*0.3, abs(abs(p.x) - 0.76) - 0.06);
    v = mix(v, 0.0, border*farFade);
  } else if (yW <= H0) {
    vec3 p = ro + rd*tW;
    p.y = hallY(p);
    float zz = p.z - uZ;
    vec2 q = vec2(bayZ(zz), p.y);
    float d = archIn(q, AHW, AHS);
    if (d <= 0.0) {
      // pier, archivolt, spandrel, gallery, cornice
      t = tW;
      foot = K_PI*px*t/max(ax, 0.008);
      shade = 0.86 + 0.14*smoothstep(0.0, 0.6, q.y);
      v = wallPat(q, zz, d, foot, H0, suv, nest);
    } else {
      // through the arch: the thickness of the wall, then arcade behind arcade of aisles
      float tJ = bendHit(ro.x, sxe, sX*(W + 0.7))/kz;
      vec3 pj = ro + rd*tJ;
      pj.y = hallY(pj);
      vec2 qj = vec2(bayZ(pj.z - uZ), pj.y);
      float dj = archIn(qj, AHW, AHS);
      if (dj <= 0.0 && pj.y > 0.0) {
        t = tJ;
        foot = K_PI*px*t/max(ax, 0.008);
        v = chk(vec2(archArc(qj, AHW, AHS), abs(pj.x) - W), foot);
        shade = 0.7;
      } else {
        float Hc = 15.0;
        for (int i = 1; i <= 20; i++) {
          float fi = float(i);
          float ti = bendHit(ro.x, sxe, sX*(W + 0.7 + 5.5*fi))/kz;
          float yi = hallY(ro + rd*ti);
          shade = 0.92 - 0.07*fi;
          if (yi < 0.0 || tF < ti) {
            t = tF;
            vec3 p2 = ro + rd*t;
            p2.x -= 0.5*CRV*p2.z*p2.z;
            foot = K_PI*px*t/max(abs(rd.y), 0.008);
            v = dia(vec2(p2.x, p2.z - uZ), foot);
            suv = vec2(p2.x + p2.z - uZ, p2.x - p2.z + uZ); nest = 1.0;
            break;
          }
          if (yi > Hc) {
            t = bendHitC(ro.y, sye, Hc, CRVY)/kz;
            vec3 p2 = ro + rd*t;
            p2.x -= 0.5*CRV*p2.z*p2.z;
            foot = K_PI*px*t/max(abs(rd.y), 0.008);
            v = chk(vec2(p2.x*0.5, (p2.z - uZ)*0.5), foot*0.5);
            break;
          }
          vec3 p3 = ro + rd*ti;
          p3.y = hallY(p3);
          float z2 = p3.z - uZ + 4.0*fi;
          vec2 q2 = vec2(bayZ(z2), p3.y);
          float d2 = archIn(q2, AHW, AHS);
          if (d2 > 0.0 && i == 20) {
            // twenty arcades on, and still open: arch inside arch, ever smaller, crawling away (the haze takes most of it)
            t = ti;
            foot = K_PI*px*t/max(ax, 0.008);
            v = smoothstep(-foot*5.0, foot*5.0, sin(K_PI*(log(1.0 + d2*6.0)*3.0 + uT*0.6)));
            break;
          }
          if (d2 <= 0.0) {
            t = ti;
            foot = K_PI*px*t/max(ax, 0.008);
            v = wallPat(q2, z2, d2, foot, Hc, suv, nest);
            break;
          }
        }
      }
    }
  } else {
    // barrel vault: harlequin webs between crossing ribs
    vec2 oc = vec2(ro.x, ro.y - H0);
    float qa = max(dot(rd.xy, rd.xy), 0.000001);
    float qb = dot(oc, rd.xy);
    float qc = dot(oc, oc) - W*W;
    t = (-qb + sqrt(max(qb*qb - qa*qc, 0.0)))/qa;
    for (int k2 = 0; k2 < 4; k2++) {
      vec3 pp = ro + rd*t;
      float xh = pp.x - 0.5*CRV*pp.z*pp.z;
      float yy = hallY(pp) - H0;
      float df = 2.0*(xh*(rd.x - CRV*pp.z*rd.z) + yy*(rd.y - CRVY*pp.z*rd.z));
      t = max(0.01, t - (xh*xh + yy*yy - W*W)/(abs(df) > 0.0001 ? df : 0.0001));
    }
    vec3 p = ro + rd*t;
    p.x -= 0.5*CRV*p.z*p.z;
    p.y = hallY(p);
    vec2 nr = (p.xy - vec2(0.0, H0))/W;
    foot = K_PI*px*t/max(abs(dot(rd.xy, nr)), 0.03);
    float th = atan(p.x, max(p.y - H0, 0.0001));
    float zz = p.z - uZ;
    float un = th/1.5708;
    float zn = bayZ(zz)/(0.5*BAY);
    float u = th*W;
    float k = abs(un) - abs(zn);
    v = dia(vec2(u*1.2, zz*0.6), foot*1.2);
    if (k < 0.0) v = 1.0 - v;
    float vaultFoot = foot*1.2;
    float rb = min(abs(k)*2.5, (1.0 - abs(zn))*3.0);
    float ribV = smoothstep(-foot*3.0, foot*3.0, sin(K_PI*u*3.0));
    v = mix(ribV, v, smoothstep(0.15, 0.17, rb));
    v *= smoothstep(0.0, 0.03, abs(rb - 0.18));
    // a ringed boss where the ribs cross at the crown of each bay
    float bd = length(vec2(u, bayZ(zz)));
    shade = 0.84 + 0.16*cos(th);
    if (rb > 0.2 && bd > 0.92) { suv = vec2(u*1.2 + zz*0.6, u*1.2 - zz*0.6); foot = vaultFoot; nest = 1.0; }
  }

  // far off, a pale bright haze
  float fog = 1.0 - exp(-t*0.004);
  shade = mix(mix(shade, 1.0, 0.75), 1.0, fog);
  vec3 col = mix(vec3(v*shade), vec3(0.9), fog*0.8);

  // fried: a block of the picture flips for a moment; a column of it smears downward
  {
    float flip = step(1.0 - 0.03*fry, hash21(floor(nc*vec2(7.0, 9.0)) + floor(uT*3.0)*5.1));
    col = mix(col, 1.0 - col, flip);   // a clean inverted block, never a grey one
    float cm = floor(nc.x*260.0);
    float ch = hash11(cm*1.7 + floor(uT*2.0)*9.1);
    float y0 = hash11(cm*3.3)*1.4 - 0.7;
    float smear = step(1.0 - 0.05*fry, ch)*step(nc.y, y0)*step(y0 - 0.05 - 0.25*ch, nc.y);
    col = mix(col, vec3(step(0.5, hash11(cm))), smear);
  }

  // the face's features, only where the ray really did land on the surface the face lives in
  if (fSel > 0.5 && nf < 0.5 && endHit < 0.5 && abs(t - fT) < 0.6) col = faceDraw(col, fp, fB, fTime, fAA);

  // burning film: where it has burnt through it turns clear, and the flower behind shows
  float pAlpha = 1.0;
  if (uBurn > 0.0) {
    float n = fbm(nc*2.6 + 3.0);
    float e = n - (uBurn*1.15 - 0.12);
    vec3 scorch = vec3(dot(col, vec3(0.3333))*0.5);
    col = mix(col, scorch, 1.0 - smoothstep(0.02, 0.2, e));
    col = mix(col, vec3(0.74, 0.77, 0.82), 1.0 - smoothstep(0.0, 0.05, e));
    col = mix(col, vec3(1.0), 1.0 - smoothstep(0.0, 0.015, e));
    float burnt = 1.0 - smoothstep(-0.03, 0.0, e);
    pAlpha = 1.0 - burnt;
  }
  tOut = t;
  return vec4(col, pAlpha);
}
// one sample per pixel. (Build 47 took five samples for distant pixels: the shader, inlined five times, made the palace
// hang the GPU at full resolution and showed a white screen. Do not bring that back without measuring at 1080p.)
void main(){
  PXS = 1.0;
  float t0;
  gl_FragColor = palace(vDir, t0);
}`;

// ---------- 2. jester faces ----------
// The faces are drawn by the palace shader itself (FACE above), out of the surface they sit in. The mesh that
// makeJesterFace returns is only an anchor the scene steers and measures angles to; it is never drawn.
const JESTER_FRAG = `
void main(){ gl_FragColor = vec4(0.0); }`;

// ---------- 3. the chrysanthemum ----------
// The original polar interference flower (petal and ring waves), driven much further: two counter-rotating
// kaleidoscopic fold-and-invert fractals with orbit-trap glow are laid through it, their orbits also
// warping the fine interference. Everything is smooth and additive; detail finer than a pixel is faded
// out by tracking the fold's stretch, so it stays crisp instead of sparkling. 20 iterations in all.
// FLOWER is the shared pattern: the mandala and the doors cut out of it both include it.
const FLOWER = `
// pink -> purple -> green -> gold -> pink
vec3 irid(float h){
  h = fract(h)*4.0;
  vec3 c = mix(PINK, PURP, smoothstep(0.0, 1.0, h));
  c = mix(c, GRN, smoothstep(1.0, 2.0, h));
  c = mix(c, GOLD, smoothstep(2.0, 3.0, h));
  return mix(c, PINK, smoothstep(3.0, 4.0, h));
}
// mirror the plane into n pairs of sectors
vec2 kfold(float r, float a, float n){
  float sg = K_PI/n;
  float af = abs(mod(a, 2.0*sg) - sg);
  return r*vec2(cos(af), sin(af));
}
// iterated fold-and-invert; returns (ring-trap glow, line-trap glow, nearest approach, last radius)
vec4 orbit(vec2 q, vec2 c, float cr, float sr, float n){
  float g1 = 0.0;
  float g2 = 0.0;
  float tr = 10.0;
  float sc = 1.0;
  float l = 0.0;
  for (int i = 0; i < 10; i++) {
    if (float(i) >= n) break;
    q = abs(q);
    float d2 = max(dot(q, q), 0.02);
    q = q/d2 - c;
    sc /= d2;
    q = vec2(cr*q.x - sr*q.y, sr*q.x + cr*q.y);
    l = length(q);
    float w = 1.0/(1.0 + sc*sc*0.0016);
    g1 += w*exp(-12.0*abs(l - 0.75));
    g2 += w*exp(-18.0*abs(q.y));
    tr = min(tr, l);
    // once the fold has stretched this far every later term is weighted below 2%: stop paying for them
    if (sc > 180.0) break;
  }
  return vec4(g1, g2, tr, l);
}
// the flower's light at p (radius r, angle a) and time t, before exposure; qn 0..1 scales the iteration count
vec3 flower(float r, float a, float t, float qn){
  float petals = cos(a*12.0 + sin(r*10.0 - t*1.5)*1.6);
  float rings = sin(r*26.0 - t*3.0 + petals*1.3);
  float kk = cos(a*6.0 - t*0.4)*0.5 + 0.5;
  vec3 col = mix(PURP, PINK, 0.5 + 0.5*rings);
  col = mix(col, GRN, smoothstep(0.55, 1.0, petals*kk)*0.8);
  // two fractal layers, turning against each other, breathing in and out
  float ra = 0.35 + 0.1*sin(t*0.11);
  vec2 qa = kfold(r, a + t*0.05, 6.0)*(2.1 + 0.3*sin(t*0.23));
  vec4 oa = orbit(qa, vec2(0.84 + 0.05*sin(t*0.17), 0.56 + 0.05*cos(t*0.13)), cos(ra), sin(ra), 4.0 + 6.0*qn);
  vec2 qb = kfold(r, a - t*0.08 + 0.4, 4.0)*(3.4 - 0.5*sin(t*0.19));
  vec4 ob = vec4(0.0, 0.0, 1.0, 1.0);
  if (qn > 0.3) ob = orbit(qb, vec2(0.7 + 0.06*cos(t*0.21), 0.92 + 0.04*sin(t*0.15)), 0.8253, -0.5646, 3.0 + 7.0*qn);
  // fine interference, bent by the orbits
  float fine = cos(a*24.0 + r*34.0 - t*2.0 + oa.z*5.0);
  float finer = cos(a*48.0 - r*80.0 + t*1.3 + ob.z*7.0 + petals*2.0);
  col *= 0.6 + 0.3*fine + 0.1*finer;
  vec3 glow = irid(oa.z*0.9 + r*0.6 - t*0.06)*oa.x*0.34;
  glow += irid(log(1.0 + oa.w)*0.5 + 0.3 + t*0.04)*oa.y*0.2;
  glow += irid(ob.z*1.1 - r*0.5 + t*0.05 + 0.5)*ob.x*0.26;
  glow += irid(log(1.0 + ob.w)*0.4 + 0.75)*ob.y*0.16;
  return col*0.55 + glow*(0.75 + 0.25*rings);
}
// soft shoulder so the glow saturates instead of clipping, then a little extra colour
vec3 expose(vec3 col){
  col = 1.0 - exp(-col*1.5);
  return mix(vec3(dot(col, vec3(0.3333))), col, 1.25);
}
`;
// uScreen 1: a full-screen surface in clip space (vP runs -1..1 up the view and wider across by the aspect ratio,
// vR scales the growing edge so that at uGrow 1.5 it is well past the corners). uScreen 0: an ordinary world quad.
const VS_MANDALA = `
uniform float uScreen;
varying vec2 vP;
varying float vR;
void main(){
  if (uScreen > 0.5) {
    float asp = projectionMatrix[1][1]/projectionMatrix[0][0];
    vP = position.xy*2.0*vec2(asp, 1.0)*0.6;
    vR = length(vec2(asp, 1.0))*0.5;
    gl_Position = vec4(position.xy*2.0, 0.999, 1.0);
  } else {
    vP = (uv - 0.5)*2.0;
    vR = 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
}`;
const MANDALA_FRAG = `
uniform float uT;
uniform float uGrow;
uniform float uLight;
uniform float uQ;
uniform float uFade;
uniform float uRot;
uniform float uZoom;
varying vec2 vP;
varying float vR;
${COMMON}
${FLOWER}
void main(){
  vec2 p = vP;
  float r0 = length(p)/vR;
  // uZoom scales the flower itself (below 1 it is smaller), not the growing edge: it swells as it opens (build 146)
  p /= uZoom;
  if (r0 > uGrow) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float edge = (1.0 - smoothstep(uGrow - 0.18, uGrow, r0))*uFade;
  if (edge <= 0.002) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float t = uT;
  p *= 1.0 + 0.02*sin(t*0.9 + r0*7.0);
  float r = length(p);
  float a = atan(p.y, p.x) + uRot;
  // travelling into it: two copies of the flower a half-cycle apart, each arriving small at the vanishing point,
  // swelling until its petals stream off the edges of view, and handing over to the next as it goes. Always at
  // full iteration count: the detail never depends on the quality scalar.
  float rt = pow(r, 0.85);
  vec3 col = vec3(0.0);
  float ph0 = fract(t*0.07);
  float w0 = pow(sin(K_PI*ph0), 4.0);
  float w1 = pow(cos(K_PI*ph0), 4.0);
  for (int i = 0; i < 2; i++) {
    float ph = fract(ph0 + 0.5*float(i));
    float wgt = ((i == 0) ? w0 : w1)/(w0 + w1);   // one copy carries the picture most of the time, so it stays crisp
    if (wgt > 0.004) col += wgt*flower(rt*exp2(1.0 - 2.0*ph), a + 0.26*float(i) + 0.5*ph, t, 1.0);
  }

  // bright core, and light pouring from the centre as the doors open. The light multiplies the pattern instead of
  // being added over it, so the flower's detail is still there inside the glare.
  col += vec3(1.0, 0.9, 0.8)*exp(-r*11.0)*0.9;
  if (uLight > 0.0) {
    float ray = 0.6*pow(0.5 + 0.5*cos(a*16.0 + sin(t*0.6)*3.0), 5.0) + 0.4*pow(0.5 + 0.5*cos(a*7.0 - t*0.4), 3.0);
    float lk = uLight*(0.35 + 0.65*ray)*exp(-r*3.2);
    col *= 1.0 + 1.1*lk;
    col += vec3(1.0, 0.93, 0.72)*lk*0.16;
  }
  // the growing edge glows gold
  col += GOLD*(1.0 - smoothstep(0.0, 0.09, abs(r0 - (uGrow - 0.1))))*0.6*(1.0 - smoothstep(1.2, 1.5, uGrow));
  // a gentle falloff toward the rim gives the flower depth
  col *= 1.0 - 0.22*smoothstep(0.45, 1.3, r);
  gl_FragColor = vec4(expose(col), edge);
}`;

// ---------- 4. doors ----------
// The doors are cut out of the flower: every leaf and every wall between doorways carries the same
// pattern as the mandala (FLOWER), at its own phase, turn and scale, so each layer reads as a deeper
// one. Nothing is drawn as a frame; edges are a rim of light and a luminous seam where the leaves meet.
// uMode 0: a door leaf   1: the wall between one doorway and the next
// uMode 2: the light behind the last door   3: additive bloom on a quad in front of the doorway
const DOOR_FRAG = `
uniform float uT;
uniform vec2 uSize;
uniform float uPhase;
uniform float uMode;
uniform float uGlow;
uniform float uQ;
varying vec2 vUv;
${COMMON}
${FLOWER}
// > 0 inside a pointed (equilateral) arch of half-width hw and total height h standing on y = 0; matches pointedOutline()
float archD(vec2 q, float hw, float h){
  float R = 2.0*hw;
  float hs = h - 1.7320508*hw;
  return (q.y < hs) ? min(hw - abs(q.x), q.y + 0.2) : R - length(vec2(abs(q.x) - hw + R, q.y - hs));
}
void main(){
  vec2 q = vUv;
  float hw = 0.5*uSize.x;
  float d = archD(q, hw, uSize.y);
  // the true pixel footprint, so the lines of light stay clean when a leaf swings edge-on
  vec2 fw = fwidth(q);
  float w1 = max(0.003, max(fw.x, fw.y));
  vec3 col = vec3(0.0);
  if (uMode < 1.5) {
    // the flower again, turned and re-phased for this layer
    float ca = cos(uPhase*0.9);
    float sa = sin(uPhase*0.9);
    vec2 c = (q - vec2(0.0, uSize.y*0.5))*(0.26 + 0.06*uPhase);
    c = vec2(ca*c.x - sa*c.y, sa*c.x + ca*c.y) + vec2(0.05*sin(uPhase*2.3), 0.04*cos(uPhase*1.7));
    float fr = length(c);
    col = expose(flower(fr, atan(c.y, c.x), uT*(1.0 + 0.12*uPhase) + uPhase*11.0, clamp(uQ, 0.0, 1.0)));
    if (uMode < 0.5) {
      col *= 0.78 + 0.4*uGlow;
      float seam = exp(-abs(q.x)/max(w1*2.5, 0.012));
      float rim = exp(-max(d, 0.0)/max(w1*3.0, 0.016));
      col += vec3(1.0, 0.93, 0.78)*(seam*0.95 + rim*0.75)*(0.6 + 0.6*uGlow);
    } else {
      // further in: dimmer until the doors in front have opened
      col *= 0.62 + 0.45*uGlow;
      col += vec3(1.0, 0.9, 0.72)*exp(-abs(d)/max(w1*3.0, 0.016))*0.7;
    }
  } else if (uMode < 2.5) {
    float la = atan(q.y - uSize.y*0.45, q.x);
    float ray = 0.5 + 0.5*cos(la*14.0 + uT*1.5);
    col = mix(vec3(1.0, 0.78, 0.94), vec3(1.0, 0.98, 0.88), ray)*(0.7 + 0.4*uGlow);
  } else {
    vec2 bc = vUv - 0.5;
    float brr = length(bc)*2.0;
    float bla = atan(bc.y, bc.x);
    float bray = 0.6 + 0.4*cos(bla*9.0 + uT*0.7)*cos(bla*5.0 - uT*0.4);
    float fall = 1.0 - smoothstep(0.0, 1.0, brr);
    col = vec3(1.0, 0.9, 0.72)*fall*fall*bray*uGlow*0.4;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------- 5. council orbs ----------
// A soft additive glow of pale violet with a slow swirl inside it and one thin halo ring. uRush adds
// fast fine ripples for the download.
const ORB_FRAG = `
uniform float uT;
uniform float uSeed;
uniform float uOp;
uniform float uRush;
varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5)*2.0;
  float r = length(p);
  if (r > 1.0 || uOp <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float t = uT + uSeed*13.0;
  float a = atan(p.y, p.x);
  float lr = log(r + 0.05);
  float body = exp(-r*r*7.0)*0.75 + 0.3*(1.0 - r)*(1.0 - r);
  float inner = 1.0 - smoothstep(0.0, 0.55, r);
  float swirl = 0.5 + 0.5*sin(a*3.0 + lr*5.0 - t*0.5 + sin(t*0.3 + r*6.0));
  float fil = 0.5 + 0.5*sin(a*9.0 - lr*11.0 + t*0.35);
  float hr = 0.62 + 0.03*sin(t*0.7);
  float halo = exp(-abs(r - hr)*60.0)*0.2;
  float rip = uRush*(0.5 + 0.5*sin(r*90.0 - t*40.0 + a*4.0))*(1.0 - r)*0.5;
  float v = body*(0.75 + inner*(0.32*swirl + 0.12*fil)) + halo + rip;
  v *= 1.0 - smoothstep(0.85, 1.0, r);
  vec3 c = mix(vec3(0.745, 0.667, 1.0), vec3(1.0), body*body*0.6);
  gl_FragColor = vec4(c*v*uOp, 1.0);
}`;

// ---------- shared geometry (built once, reused across nights) ----------
let _plane = null, _sky = null;
const plane = () => _plane || ((_plane = new THREE.PlaneGeometry(1, 1)).userData.keep = true, _plane);
const sky = () => _sky || ((_sky = new THREE.BoxGeometry(60, 60, 60)).userData.keep = true, _sky);

function skyMesh(frag, uniforms) {
  const m = new THREE.Mesh(sky(), new THREE.ShaderMaterial({
    uniforms, vertexShader: VS_SKY, fragmentShader: frag, side: THREE.BackSide, depthTest: false, depthWrite: false,
  }));
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

// ---------- makers ----------
// The palace: add to the scene and copy the camera position into mesh.position each frame.
// uZ = distance travelled down the hall, uFocus 0..1 swells the far light, uBurn 0..1 burns the film,
// uLight = unit vector from the camera to the far light, uFry 0..1 the overdriven, glitching look.
export function makePalace() {
  const v4 = () => [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0));
  return palaceLayer(skyMesh(PALACE_FRAG, { uT: { value: 0 }, uZ: { value: 0 }, uFocus: { value: 0 }, uBurn: { value: 0 }, uLight: { value: new THREE.Vector3(0, 0, -1) }, uFry: { value: 0 }, uQ: fxQuality, uPx: { value: 0.0016 },
    uJa: { value: v4() }, uJb: { value: v4() } }));
}
// drawn after the flower (renderOrder -5) and blended, so where the film burns through, the flower is behind it
function palaceLayer(m) { m.material.transparent = true; m.renderOrder = -4; return m; }

// The anchor for one jester (never drawn: the palace shader draws the face out of its own wall). The uniforms are
// kept so the scene can go on driving them. At most PALACE_FACES faces at once.
export function makeJesterFace() {
  return new THREE.Mesh(plane(), new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uSeed: { value: Math.random() * 10 }, uMood: { value: 0 }, uPoint: { value: 0 }, uBurn: { value: 0 }, uFry: { value: 0 } },
    vertexShader: VS_UV, fragmentShader: JESTER_FRAG, transparent: true, depthWrite: false, visible: false,
  }));
}
export const PALACE_FACES = 4;
// A place on the hall's own surfaces for a face to grow: a pier, a spandrel between two arches, or the vault, some way
// ahead of the viewer and this side of the next cross-wall. Returns null when there is no room yet. (Constants match PALACE_FRAG.)
export function palaceSpot(pu, pointing) {
  const uz = pu.uZ.value, D = 40 - ((uz + 4) % 40), r = Math.random();
  const kind = pointing ? 0 : r < 0.5 ? 0 : r < 0.85 ? 1 : 2;
  const target = kind === 2 ? 20 + Math.random() * 6 : 9 + Math.random() * 6;
  let zz = 4 + 8 * Math.round((-target - uz - 4) / 8);   // pier centres, in the hall's own scrolling coordinate
  while (-(zz + uz) > D - 3 || (kind === 0 && -(zz + uz) > 17)) zz += 8;   // (a pier further off would sit too near the way ahead)
  if (-(zz + uz) < 6.5) return null;
  return { side: pointing ? -1 : (Math.random() < 0.5 ? -1 : 1), zz,
    h: kind === 0 ? 2.5 + Math.random() * 0.6 : kind === 1 ? 11 : 19.3 + 6 * (0.45 + Math.random() * 0.5),
    size: kind === 0 ? 1.5 : kind === 1 ? 2.1 : 3.2 };
}
// Drive face slot i from a spot: k 0..1 how far it has swollen out, mood 0 frown..1 grin, rot head tilt, point true for
// the pointing one. Writes the direction the face is SEEN in (unit vector from the eye) into out; returns its distance ahead.
export function palaceFace(pu, i, s, k, mood, rot, point, out) {
  const T = pu.uT.value, z = s.zz + pu.uZ.value;
  pu.uJa.value[i].set(s.side, s.h, z, s.size); pu.uJb.value[i].set(k, mood, rot, point ? -s.side : 0);
  const W = 6 * (1 + 0.045 * Math.sin(T * 0.8)), H0 = 19 + 0.25 * Math.sin(T * 0.6 + 1);   // must match the palace shader
  let x = s.side * W, y = s.h;
  if (s.h > H0) { const ph = (s.h - H0) / W; x = s.side * W * Math.cos(ph); y = H0 + W * Math.sin(ph); }
  y += 0.5 * 0.0012 * Math.sin(T * 0.13) * z * z;   // the hall's slow rise and fall (CRVY in the shader)
  y -= 1.6;
  // undo the hall's roll, which the shader applies to the view ray
  const rho = Math.hypot(x, y) / Math.max(-z, 0.001), tw = 0.2 * Math.sin(T * 0.23) + 0.08 * Math.sin(T * 0.61) + 0.9 * Math.sin(T * 0.17) * Math.exp(-rho * 2.5);   // must match the shader
  const c = Math.cos(tw), sn = Math.sin(tw);
  out.set(c * x + sn * y, -sn * x + c * y, z).normalize();
  return -z;
}
export function palaceFaceOff(pu, i) { pu.uJa.value[i].w = 0; pu.uJb.value[i].x = 0; }

// Quality scalar for the heavy shaders (the mandala, the doors cut from it, the palace's nested detail): 1 = full, 0 = cheapest. One shared uniform object,
// so setting fxQuality.value takes effect on every live material at once (main.js pins it to 1).
export const fxQuality = { value: 1 };

// uFade multiplies the whole flower's opacity (used for the afterimage on waking).
// size 0 (or none): the flower fills the whole view at any aspect ratio, behind everything, wherever the mesh is put
// (it is drawn straight in clip space, so there is no quad edge to see). A size makes an ordinary quad in the world.
// Turn it with uRot, never by rotating the mesh.
export function makeMandala(size) {
  const full = !size;
  const m = new THREE.Mesh(plane(), new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uGrow: { value: 0 }, uLight: { value: 0 }, uQ: fxQuality, uFade: { value: 1 }, uRot: { value: 0 }, uZoom: { value: 1 }, uScreen: { value: full ? 1 : 0 } },
    vertexShader: VS_MANDALA, fragmentShader: MANDALA_FRAG, transparent: true, depthWrite: false,
  }));
  if (full) { m.frustumCulled = false; m.renderOrder = -5; } else m.scale.set(size, size, 1);
  return m;
}

function doorMat(mode, w, h, phase, doubleSide, extra) {
  return new THREE.ShaderMaterial({
    extensions: { derivatives: true }, ...extra,
    uniforms: { uT: { value: 0 }, uSize: { value: new THREE.Vector2(w, h) }, uPhase: { value: phase }, uMode: { value: mode }, uGlow: { value: 0 }, uQ: fxQuality },
    vertexShader: VS_UV, fragmentShader: DOOR_FRAG, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
  });
}
// the doors are pointed (equilateral) arches: each side an arc of radius w (twice the half-width) centred on the springing
// line at the far side, meeting in a point at the full height h. Must match archD in DOOR_FRAG.
const pointArc = (hw, h) => { const R = 2 * hw, hs = h - Math.sqrt(3) * hw, th = Math.acos((R - hw) / R); return { R, hs, th }; };
function archGeo(w, h) {
  const s = new THREE.Shape(), r = w / 2, P = pointArc(r, h);
  s.moveTo(-r, 0); s.lineTo(-r, P.hs); s.absarc(P.R - r, P.hs, P.R, Math.PI, Math.PI - P.th, true); s.absarc(r - P.R, P.hs, P.R, P.th, 0, true); s.lineTo(r, 0); s.lineTo(-r, 0);
  return new THREE.ShapeGeometry(s, 24);
}
function halfArchGeo(w, h, side) {
  const s = new THREE.Shape(), r = w / 2, P = pointArc(r, h);
  if (side < 0) { s.moveTo(-r, 0); s.lineTo(-r, P.hs); s.absarc(P.R - r, P.hs, P.R, Math.PI, Math.PI - P.th, true); s.lineTo(0, 0); s.lineTo(-r, 0); }
  else { s.moveTo(0, 0); s.lineTo(0, h); s.absarc(r - P.R, P.hs, P.R, P.th, 0, true); s.lineTo(r, 0); s.lineTo(0, 0); }
  const g = new THREE.ShapeGeometry(s, 16);
  g.translate(-side * r, 0, 0);   // hinge on the outer edge; UVs keep the untranslated door coordinates
  return g;
}
// the wall between a doorway (W x H) and the smaller doorway (w x h) set into it
function archRingGeo(W, H, w, h) {
  const s = new THREE.Shape(), R = W / 2, r = w / 2, P = pointArc(R, H), p = pointArc(r, h);
  s.moveTo(-R, 0); s.lineTo(-R, P.hs); s.absarc(P.R - R, P.hs, P.R, Math.PI, Math.PI - P.th, true); s.absarc(R - P.R, P.hs, P.R, P.th, 0, true); s.lineTo(R, 0);
  s.lineTo(r, 0); s.lineTo(r, p.hs); s.absarc(r - p.R, p.hs, p.R, 0, p.th, false); s.absarc(p.R - r, p.hs, p.R, Math.PI - p.th, Math.PI, false); s.lineTo(-r, 0); s.lineTo(-R, 0);
  return new THREE.ShapeGeometry(s, 24);
}

// Four doors cut from the flower, each set into the wall behind the one before, with light behind the last.
// Local space: the outer door is 1.5 wide and 3 tall, standing on y = 0 at z = 0 and facing +z.
// open(i, k) swings door i's two leaves (k 0..1); setGlow(v) brightens everything; tick(dt) animates.
export function makePortal() {
  const group = new THREE.Group();
  const S = [1, 0.8, 0.62, 0.46], mats = [], leaves = [];
  const add = (geo, mat, x, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, 0, z); group.add(m); mats.push(mat); return m; };
  add(archRingGeo(1.9, 3.2, 1.5, 3), doorMat(1, 1.9, 3.2, 0.5), 0, 0);
  for (let i = 0; i < 4; i++) {
    const w = 1.5 * S[i], h = 3 * S[i], z = -i * 0.06;
    const L = add(halfArchGeo(w, h, -1), doorMat(0, w, h, i + 1, true), -w / 2, z);
    const R = add(halfArchGeo(w, h, 1), doorMat(0, w, h, i + 1, true), w / 2, z);
    leaves.push([L, R]);
    if (i < 3) add(archRingGeo(w, h, 1.5 * S[i + 1], 3 * S[i + 1]), doorMat(1, w, h, i + 1.5), 0, z - 0.06);
  }
  add(archGeo(1.5 * S[3], 3 * S[3]), doorMat(2, 1.5 * S[3], 3 * S[3], 0), 0, -0.26);
  const bloom = add(plane(), doorMat(3, 1, 1, 0, false, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 0, 0.3);
  bloom.position.y = 1.45; bloom.scale.set(4.6, 5.4, 1);
  return {
    group,
    open(i, k) { leaves[i][0].rotation.y = -k * 1.9; leaves[i][1].rotation.y = k * 1.9; },
    setGlow(v) { for (const m of mats) m.uniforms.uGlow.value = v; },
    tick(dt) { for (const m of mats) m.uniforms.uT.value += dt; },
  };
}

// A council orb on a unit quad (additive): scale it, and copy the camera quaternion to keep it facing the viewer.
export function makeOrb(seed) {
  return new THREE.Mesh(plane(), new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uSeed: { value: seed }, uOp: { value: 0 }, uRush: { value: 0 } },
    vertexShader: VS_UV, fragmentShader: ORB_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
}

// Fine motes of pale light scattered through a shell round the origin (no custom shader). Fade with material.opacity.
export function makeMotes(n = 420, color = 0xcfc2ff, size = 0.028) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, y = Math.random() * 2 - 1, s = Math.sqrt(1 - y * y), d = 2.2 + Math.pow(Math.random(), 1.6) * 12;
    pos[i * 3] = Math.cos(a) * s * d; pos[i * 3 + 1] = y * d * 0.6; pos[i * 3 + 2] = Math.sin(a) * s * d;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.frustumCulled = false;
  return m;
}

// Compile every program up front (call while the screen is black) so nothing hitches mid-sequence.
// Its warm-up materials are never disposed on purpose: they hold the vision's shader programs in the renderer's cache
// for the whole session (bounded: one set), so the scene's own transient copies can be disposed by clearScene freely.
let warmed = false;
export function prewarm(renderer, camera) {
  if (warmed) return;
  warmed = true;
  try {
    const s = new THREE.Scene();
    const p = makePortal();
    s.add(makePalace(), makeJesterFace(), makeMandala(1), p.group, makeOrb(0), makeMotes(3));
    renderer.compile(s, camera);
  } catch (e) { console.warn('fx prewarm failed', e); }
}

// for tools and test drivers: the shared GLSL helpers and the jester face, so a face can be previewed head-on on its own
export const COMMON_GLSL = COMMON, FACE_GLSL = FACE;
