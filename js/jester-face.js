// THE JESTER FACES: everything you see of a jester in the palace is drawn here, in GLSL (the shader language).
// Units: the face is about 2.4 wide and 3 tall, centred on (0, 0); x goes right, y goes up. q is the point being drawn.
// mood runs 0 (frowning, angry) to 1 (grinning); t is time in seconds; aa is the edge softness.
// Helpers you can use (defined in fx.js): fillAA(d, aa) turns a distance into coverage, taperD(p, a, b, ra, rb) is a
// tapering stroke from a to b, segD(p, a, b) a line, hash11(n) a random number 0..1, K_PI is pi.
// Each feature works out a distance d (negative inside the shape) and paints with c = mix(c, colour, fillAA(d, aa)).
// After editing: save, reload the game (F2 then the developer menu jumps straight to the palace: Vision > Jester palace).
export const FACE = `
// one horn (mirrored): a serpentine that tapers to a bell. returns (distance, offset across, radius, distance along)
vec4 hornAt(vec2 q, float t){
  vec2 p = vec2(abs(q.x), q.y) - vec2(0.5, 0.62);
  float u = dot(p, vec2(0.447, 0.894));
  float wv = dot(p, vec2(0.894, -0.447));
  float un = clamp(u/1.9, 0.0, 1.0);
  float amp = 0.09 + 0.2*un;
  float ph = u*4.6 + 0.5*sin(t*2.3);
  float off = wv - amp*sin(ph);
  float sl = amp*4.6*cos(ph);
  float rad = 0.25*(1.0 - un)*(1.0 - 0.3*un) + 0.035;
  float d = abs(off)/sqrt(1.0 + sl*sl) - rad;
  d = max(d, u - 1.9);
  d = min(d, length(vec2(u - 1.93, off)) - 0.085);
  return vec4(d, off, rad, u);
}
// how far the wall's pattern is pushed about by the face swelling out of it (in face units)
vec2 faceWarp(vec2 q, float t){
  vec2 w = -q*0.5*(1.0 - smoothstep(0.0, 1.45, length(q*vec2(1.0, 0.8) + vec2(0.0, 0.12))));
  vec2 e = vec2(abs(q.x) - 0.36, q.y - 0.16);
  w -= vec2(e.x*sign(q.x), e.y)*0.4*(1.0 - smoothstep(0.0, 0.45, length(e)));
  return w;
}
// one plume of the headdress: a tapering, banded stroke fanning up and out from the crown, curling over at its tip.
// a = its angle from straight up. Returns (distance, distance along it, side offset, its radius there)
vec4 plumeAt(vec2 q, float a, float t){
  vec2 d = vec2(sin(a), cos(a));
  vec2 n = vec2(d.y, -d.x);
  vec2 b = vec2(0.0, 0.2) + 0.95*d;   // roots spread round the crown arc, not bunched
  vec2 p = q - b;
  float L = 1.1 - 0.25*abs(a);
  float u = dot(p, d);
  float un = clamp(u/L, 0.0, 1.0);
  float bend = (0.26*un*un + 0.03*sin(t*1.7 + a*5.0)*un)*sign(a + 0.0001);
  float off = dot(p, n) - bend;
  float rad = 0.085*(1.0 - un) + 0.03;
  float dd = abs(off)/sqrt(1.0 + 0.4*un) - rad;
  dd = max(dd, max(-u, u - L));
  // the curl at the tip: a ring turning back over
  vec2 tip = b + d*L + n*(0.26*sign(a + 0.0001)) + n*0.08*sign(a + 0.0001);
  float dc = abs(length(q - tip) - 0.075) - 0.025;
  return vec4(dd, u, off, rad);
}
float starD(vec2 p, float r){
  float an = atan(p.x, p.y);
  float k = 6.2831853/5.0;
  float m = mod(an + k*0.5, k) - k*0.5;
  float rr = length(p);
  float edge = mix(r*0.42, r, pow(1.0 - abs(m)/(k*0.5), 1.6));
  return rr - edge;
}
// the features, painted flat over whatever the wall shows there
vec3 faceDraw(vec3 col, vec2 q, vec4 jb, float t, float aa){
  float mood = jb.y;
  vec3 c = col;
  vec3 BK = vec3(0.02);
  vec3 WH = vec3(1.0);
  // the headdress: seven plumes fanning out over the crown, each banded in black and white chevrons, edged in black
  for (int i = 0; i < 7; i++) {
    float a = (float(i) - 3.0)*0.3;   // a tall fan, rising
    vec4 pl = plumeAt(q, a, t);
    // each plume is a stack of separate chevron blades pointing outward, with gaps of wall between them; every blade
    // narrows to sharp points at its wings and at its back edge. White, edged in black.
    float L = 1.1 - 0.25*abs(a);
    float S = 0.24;
    float w = fract((pl.y + 0.9*abs(pl.z) + t*0.12)/S);   // + : each chevron points outward, its wings swept back
    float dW = (w <= 0.55) ? -min(w, 0.55 - w) : min(w - 0.55, 1.0 - w);
    float taper = 1.0 - 0.5*clamp(w/0.55, 0.0, 1.0);
    float dSide = abs(pl.z) - pl.w*1.7*taper;
    float dBlade = max(max(dSide, dW*S*0.7), max(0.1 - pl.y, pl.y - L));
    c = mix(c, BK, fillAA(dBlade - 0.012, aa));
    c = mix(c, WH, fillAA(dBlade, aa));
  }
  // the mask: broad on top, narrowing to a pointed chin, heavy black edge with a row of white beads set into it
  float my = q.y - 0.08;
  float wBot = 0.84*pow(max(1.0 - (my/1.42)*(my/1.42), 0.0), 1.15);
  float dMask = (my > 0.0) ? (length(vec2(q.x/0.84, my/0.98)) - 1.0)*0.86 : abs(q.x) - wBot;
  if (my < -1.42) dMask = 0.5;
  c = mix(c, BK, fillAA(dMask - 0.06, aa));
  c = mix(c, WH, fillAA(dMask, aa));
  {
    float ang = atan(q.x, my);
    float bead = length(vec2((fract(ang*7.0) - 0.5)/7.0*0.9, dMask - 0.03)) - 0.02;   // in the middle of the black edge
    c = mix(c, WH, fillAA(bead, aa));
  }
  // a small five-pointed star on the brow

  // eyes: round kaleidoscopes, petals and rings turning against each other, set in a heavy black ring. Angry, a slanted lid
  // comes down over the top of each, low by the nose. Both the same size.
  float side = sign(q.x);
  vec2 ec = vec2(side*0.36, 0.16);
  float er = 0.22;
  vec2 el = q - ec;
  float lidSl = mix(0.7, 0.0, smoothstep(0.0, 0.75, mood));
  float lidY = mix(0.03, er + 0.5, smoothstep(0.0, 0.85, mood)) + lidSl*(abs(q.x) - 0.36);
  float dLid = (el.y - lidY)/sqrt(1.0 + lidSl*lidSl);
  // a touch almond: a lens of two circles, so the points sit at the inner and outer corners like a normal eye
  // (half width 0.24, half height 0.19)
  float dE = max(max(length(el + vec2(0.0, 0.0566)), length(el - vec2(0.0, 0.0566))) - 0.2466, dLid);
  c = mix(c, BK, fillAA(dE - 0.04, aa));
  {
    float r = length(el)/er;
    float th = atan(el.y, el.x);
    float petals = cos(6.0*(th + t*0.6*side))*0.5 + 0.5;
    float rings = step(0.5, fract(r*2.5 - t*0.8));
    float flower = step(r, 0.25 + 0.55*petals);
    float v = mix(rings, 1.0 - rings, flower);
    // the pupil (build 146, smaller): a small black centre in a thin white ring, so the rings moving out from the middle
    // no longer swell the centre into a black disc up to a quarter of the eye across (it was 0.12 to about 0.24)
    v = mix(v, 1.0, fillAA(r - 0.17, aa/er));
    v = mix(v, 0.0, fillAA(r - 0.09, aa/er));
    c = mix(c, vec3(v), fillAA(dE, aa));
  }
  // the mouth: a wide grin of long interlocking fangs, top row hanging down, bottom row standing up between them, inside
  // a heavy black lip line. Its corners simply come to points. Angry, it turns down at the ends.
  float mw = mix(0.58, 0.68, mood);
  float bend = mix(-0.18, 0.3, mood);
  float yM = mix(-0.5, -0.56, mood);
  float openM = smoothstep(0.5, 0.9, mood);
  float gap = mix(0.26, 0.5, mood);
  float xn = q.x/mw;
  float edge = max(1.0 - xn*xn, 0.0);
  float yTop = yM + bend*xn*xn;
  float th = gap*pow(edge, 0.8);
  float dM = max(q.y - yTop, (yTop - th) - q.y);
  if (abs(xn) > 1.0) dM = 0.5;
  float inM = fillAA(dM, aa);
  c = mix(c, BK, fillAA(dM - 0.04, aa));
  float P = 0.13;
  float u = q.x/P;
  float triT = 1.0 - abs(fract(u) - 0.5)*2.0;
  float triB = 1.0 - abs(fract(u + 0.5) - 0.5)*2.0;
  float fangL = mix(0.78, 0.24, openM);   // angry: long interlocking fangs; open: shorter fangs round a dark mouth
  float fT = fillAA((yTop - q.y) - th*fangL*triT, aa);
  float fB = fillAA((q.y - (yTop - th)) - th*fangL*triB, aa);
  c = mix(c, mix(BK, WH, max(fT, fB)), inM);
  if (openM > 0.02) {
    vec2 tA = vec2(0.0, yTop - th*0.45);
    vec2 tB = vec2(0.12*sin(t*4.0), yTop - th - 0.62*openM);
    float dT = taperD(q, tA, tB, 0.2*openM, 0.0);
    c = mix(c, BK, fillAA(dT - 0.035, aa));
    c = mix(c, WH, fillAA(dT, aa));
    c = mix(c, BK, fillAA(segD(q, tA + vec2(0.0, -0.08), mix(tA, tB, 0.68)) - 0.012, aa)*fillAA(dT, aa));   // the groove down its middle
  }
  // the one that points: a white glove
  if (abs(jb.w) > 0.5) {
    float hx = jb.w;
    vec2 f0 = vec2(1.25*hx, -0.5);
    float dH = min(length(q - f0) - 0.2, taperD(q, f0 + vec2(0.0, 0.08), f0 + vec2(0.75*hx, 0.1), 0.08, 0.06));
    dH = min(dH, taperD(q, f0 + vec2(-0.02*hx, 0.1), f0 + vec2(0.05*hx, 0.33), 0.075, 0.06));
    c = mix(c, BK, fillAA(dH - 0.045, aa));
    c = mix(c, WH, fillAA(dH, aa));
  }
  return mix(col, c, smoothstep(0.1, 0.6, jb.x));
}
`;
