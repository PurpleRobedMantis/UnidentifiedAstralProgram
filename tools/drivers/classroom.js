await steps(240);
E.yaw = 0; E.pitch = -0.28;
await steps(4);
window.__log = window.__log || []; window.__log.push(`cam ${E.camera.position.toArray().map((v) => v.toFixed(2))} sub ${typeof sub === 'function' ? sub() : ''}`);
await snap('class');
