import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from test_app import CDP, Page, find_edge, free_port, wait_json  # noqa

URL = "http://127.0.0.1:8770/static/scenes/duty.html"
edge = find_edge()
port = free_port()
prof = tempfile.mkdtemp(prefix="grid-")
p = subprocess.Popen([edge, "--headless=new", "--disable-gpu", "--remote-debugging-port=%d" % port,
                      "--user-data-dir=%s" % prof, "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    page = next(t for t in wait_json("http://127.0.0.1:%d/json/list" % port) if t["type"] == "page")
    cdp = CDP(page["webSocketDebuggerUrl"])
    cdp.call("Page.enable")
    pg = Page(cdp)
    pg.viewport(1200, 800)
    cdp.call("Page.navigate", {"url": URL})
    pg.wait_for("!!window.__mini", 20)
    time.sleep(1.0)
    rows = pg.js("(() => { const out=[]; for (let i=0;i<37;i++) out.push(window.__mini.rowOf(i*0.5-9.2+0.25)); return out; })()")
    if isinstance(rows, str):
        rows = json.loads(rows)
    print("rows", len(rows), [len(r) for r in rows[:2]])
    COLS = 37
    GRID = 0.5
    HALF = 9.2
    blocked = []
    for r in rows:
        blocked.append([ch == '1' for ch in r])
    zs = [-9.2 + 0.5 * i + 0.25 for i in range(len(rows))]
    print("z rows", zs)

    def cell(v):
        return max(0, min(COLS - 1, int((v + HALF) // GRID)))

    # BFS from start
    import collections
    start = (cell(-2.5), cell(-1.5))
    seen = {start}
    dq = collections.deque([start])
    while dq:
        c, r = dq.popleft()
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nc, nr = c + dc, r + dr
            if 0 <= nc < COLS and 0 <= nr < len(blocked) and not blocked[nr][nc] and (nc, nr) not in seen:
                seen.add((nc, nr))
                dq.append((nc, nr))
    goal = (cell(0.9), cell(-3.0))
    print("start", start, "blocked", blocked[start[1]][start[0]])
    print("goal", goal, "blocked", blocked[goal[1]][goal[0]], "reachable", goal in seen)
    # print map around
    for ri, r in enumerate(rows):
        z = zs[ri]
        if -3.8 <= z <= -0.5:
            marks = "".join("S" if (ci, ri) == start else ("G" if (ci, ri) == goal else ("." if ch == "0" else "#")) for ci, ch in enumerate(r))
            print("%6.2f %s" % (z, marks))
finally:
    try:
        cdp.close()
    except Exception:
        pass
    p.terminate()
    try:
        p.wait(timeout=5)
    except subprocess.TimeoutExpired:
        p.kill()
    import shutil
    shutil.rmtree(prof, ignore_errors=True)
