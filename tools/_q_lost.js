(() => {
  const T = window.__dbg.THREE;
  const out = [];
  const p = new T.Vector3();
  window.__dbg.scene.traverse((o) => {
    if (!o.isMesh) { return; }
    o.getWorldPosition(p);
    if (Math.abs(p.x + 5.1) < 0.7 && p.y > 0.6 && p.y < 2.2 && Math.abs(p.z - 0.1) < 0.8) {
      const g = o.geometry;
      const box = new T.Box3().setFromObject(o);
      out.push({
        type: o.type,
        pos: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
        size: g && g.parameters ? [g.parameters.width || g.parameters.radiusTop || 0,
                                    g.parameters.height || 0,
                                    g.parameters.depth || 0] : null,
        bbox: [+box.min.x.toFixed(2), +box.min.y.toFixed(2), +box.min.z.toFixed(2),
               +box.max.x.toFixed(2), +box.max.y.toFixed(2), +box.max.z.toFixed(2)]
      });
    }
  });
  return JSON.stringify(out);
})()
