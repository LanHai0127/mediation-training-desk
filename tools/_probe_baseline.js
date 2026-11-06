(() => {
  const a = window.__app;
  const phoneLaunch = document.querySelector('#phoneMount .tp-launch');
  const cs = phoneLaunch ? getComputedStyle(phoneLaunch) : null;
  return JSON.stringify({
    app: !!a,
    mode: a && a.state ? a.state.mode : null,
    boot: !!(a && a.boot),
    phone: !!(a && a.phone),
    err: String(window.__err || ""),
    phoneLaunch: !!phoneLaunch,
    phoneLaunchDisplay: cs ? cs.display : null,
    phoneLaunchVisibility: cs ? cs.visibility : null,
    phoneLaunchOpacity: cs ? cs.opacity : null
  });
})()
