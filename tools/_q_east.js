(() => {
  const T = window.__dbg.THREE;
  const out = [];
  window.__dbg.scene.traverse((o) => {
    if (!o.isMesh) { return; }
    const box = new T.Box3().setFromObject(o);
    const c = box.getCenter(new T.Vector3());
    if (c.x > 5.15 && c.y > 0.9 && c.y < 2.8 && c.z > -1.5 && c.z < 3.5) {
      out.push({
        pos: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)],
        size: [+(box.max.x - box.min.x).toFixed(2), +(box.max.y - box.min.y).toFixed(2),
               +(box.max.z - box.min.z).toFixed(2)],
        mat: o.material && o.material.color ? o.material.color.getHexString() : null
      });
    }
  });
  return JSON.stringify(out);
})()
