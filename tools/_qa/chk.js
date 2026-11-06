(() => {
  const a = window.__app;
  const f = document.getElementById('frame');
  const c = document.querySelector('#stage canvas');
  let mini = false;
  try { mini = !!(f && f.contentWindow && f.contentWindow.__mini); } catch (e) { mini = 'x:' + e; }
  return JSON.stringify({
    app: !!a,
    mode: a && a.state ? a.state.mode : null,
    boot: !!(a && a.boot),
    phone: !!(a && a.phone),
    canvas: !!c,
    mini: mini,
    err: String(window.__err || ''),
    gate: !!document.getElementById('gate'),
    boards: a && a.boot && a.boot.layout ? a.boot.layout().length : null
  });
})()
