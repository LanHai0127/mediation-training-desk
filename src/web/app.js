/* 调解台 · 前端胶水层
 *
 * 职责单一：把 API、场景、面板接起来，不在这里写业务规则。
 * 判定与状态推进都在服务端（见 src/game/dialogue.py），前端只负责显示。
 */
(function () {
  "use strict";

  var S = window.MediationScene;

  var state = {
    caseData: null,
    sessionId: "",
    sceneId: "",
    scene: null,
    channel: "face",
    partyId: "",
    offline: false,
    facts: {},
    scenes: {}
  };

  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------ 工具
  function api(path, body) {
    var opt = { method: body ? "POST" : "GET", headers: {} };
    if (body) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    return fetch(path, opt).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) { throw new Error(d.error || ("HTTP " + r.status)); }
        return d;
      });
    });
  }

  // 反馈统一走 toast：hint 在画布上，用户滚到方案区/对话坞时是看不见的。
  function toast(msg, kind) {
    var wrap = $("toastWrap");
    if (!wrap) { return; }
    var el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    el.textContent = msg;
    wrap.appendChild(el);
    // 最多留 3 条，多了挤屏
    while (wrap.children.length > 3) { wrap.removeChild(wrap.firstChild); }
    setTimeout(function () {
      el.classList.add("out");
      setTimeout(function () { el.remove(); }, 260);
    }, kind === "bad" ? 4200 : 2600);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ------------------------------------------------------------ 启动
  window.__app = state;      // 给 UI 探针/演示脚本用：读会话、点方案，不参与业务

  function boot() {
    api("/api/llm/status").then(function (d) {
      var on = d.llm && d.llm.enabled;
      $("llmPill").textContent = on ? ("模型：" + d.llm.model + " · 在线") : "模型：未配置 · 剧本台词";
      $("llmPill").classList.toggle("ok", !!on);
    }).catch(function () {
      $("llmPill").textContent = "模型：状态未知";
    });

    api("/api/cases").then(function (d) {
      if (!d.cases || !d.cases.length) { throw new Error("没有可用案子"); }
      state.cases = d.cases;
      var want = new URLSearchParams(location.search).get("case");
      var pick = d.cases.filter(function (c) { return c.id === want; })[0] || d.cases[0];
      renderCasePicker(pick.id);
      return api("/api/case/" + pick.id);
    }).then(function (cs) {
      state.caseData = cs;
      cs.scenes.forEach(function (sc) { state.scenes[sc.id] = sc; });
      renderCase();
      return api("/api/session", { caseId: cs.id });
    }).then(function (d) {
      state.sessionId = d.view.sessionId;
      state.sceneId = d.view.sceneId || (state.caseData.scenes[0] || {}).id;
      mountScene(state.sceneId);
      renderParties();
      renderPlan();
      renderThread();          // 进场就给一句"怎么开口"，别留一块空白
      loadLaws(state.caseData.id);
    }).catch(function (e) {
      $("caseTitle").textContent = "载入失败";
      $("caseBrief").textContent = "服务可能没起来，或者正在重启。";
      $("hint").textContent = "打不开页面时：确认命令行里跑着 python src/server.py --port 8770";
      var sk = $("skeleton");
      if (sk) {
        sk.classList.remove("gone");
        sk.innerHTML = "<span>连不上服务<br>先运行 start.bat（或 python src/server.py --port 8770）</span>";
        sk.style.textAlign = "center";
      }
      toast("载入失败：" + (e.message || "网络不通"), "bad");
    });
  }

  // ------------------------------------------------------------ 选案
  function renderCasePicker(current) {
    var sel = $("casePick");
    sel.innerHTML = (state.cases || []).map(function (c) {
      return "<option value='" + esc(c.id) + "'" + (c.id === current ? " selected" : "") + ">" +
        esc(c.title) + " · " + esc(c.difficulty) + "</option>";
    }).join("");
    sel.addEventListener("change", function () {
      var dirty = Object.keys(state.plan || {}).length > 0 ||
        (state.threads && Object.keys(state.threads).some(function (k) {
          return (state.threads[k] || []).length > 0;
        }));
      if (dirty && !window.confirm("换案子会清空当前的谈话与方案，继续吗？")) {
        sel.value = state.caseData.id;
        return;
      }
      location.search = "?case=" + encodeURIComponent(sel.value);
    });
  }

  // ------------------------------------------------------------ 案子头部
  function renderCase() {
    var c = state.caseData;
    $("caseTitle").textContent = c.title;
    $("caseBrief").textContent = (c.meta && c.meta.brief) || "";
    $("alarmText").textContent = (c.alarm && c.alarm.text) || "";
    $("alarmMeta").textContent = [(c.alarm && c.alarm.time), (c.alarm && c.alarm.source)]
      .filter(Boolean).join(" · ");

    var tabs = $("sceneTabs");
    tabs.innerHTML = "";
    c.scenes.forEach(function (sc) {
      var b = document.createElement("button");
      b.className = "tab";
      b.textContent = sc.name;
      b.dataset.scene = sc.id;
      b.addEventListener("click", function () { switchScene(sc.id); });
      tabs.appendChild(b);
    });
  }

  function markTab() {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.classList.toggle("on", b.dataset.scene === state.sceneId);
    });
  }

  // ------------------------------------------------------------ 场景
  function mountScene(sceneId) {
    state.sceneId = sceneId;
    var data = state.scenes[sceneId];
    if (!data) { return; }
    var canvas = $("scene");
    if (!state.scene) {
      state.scene = new S.Scene(canvas, data);
      state.scene.onSpot = onSpot;
      state.scene.onBlocked = function (msg) { toast(msg); };
      window.__scene = state.scene;    // 给 UI 探针用：量投影与人物位置，不参与业务
      requestAnimationFrame(loop);
    } else {
      state.scene.data = data;
      state.scene.setSpots(data.spots);
      state.scene.player = { x: (data.spawn || {}).x || 700, y: (data.spawn || {}).y || 760 };
      state.scene.cam.x = state.scene.player.x;
      state.scene.path = null;
      state.scene.pending = null;
    }
    state.scene.resize();
    markTab();
    var sk = $("skeleton");
    if (sk) { sk.classList.add("gone"); }
    $("hint").textContent = "点地面走过去 · 点物件查看";
    if (state.lastSceneToast && sceneId !== state.lastSceneToast) {
      state.lastSceneToast = sceneId;
      toast("到了「" + (data.name || "") + "」");
    }
  }

  var last = 0;
  function loop(t) {
    var dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    state.scene.update(dt);
    state.scene.render();
    requestAnimationFrame(loop);
  }

  function switchScene(sceneId) {
    if (sceneId === state.sceneId) { return; }
    api("/api/scene", { sessionId: state.sessionId, sceneId: sceneId }).catch(function () {});
    mountScene(sceneId);
  }

  // ------------------------------------------------------------ 看点
  function onSpot(spot) {
    if (spot.goto) { switchScene(spot.goto); return; }
    api("/api/look", { sessionId: state.sessionId, spotId: spot.id }).then(function (d) {
      $("hint").textContent = spot.label;
      toast(spot.label + "：" + (spot.look || ""));
      if (spot.fact && state.caseData.facts) {
        var f = state.caseData.facts.filter(function (x) { return x.id === spot.fact; })[0];
        if (f) { remember(f); }
      }
      if (spot.talk) { pickParty(spot.talk); }
    }).catch(function (e) {
      toast("查看失败：" + e.message, "bad");
    });
  }

  function remember(fact) {
    if (state.facts[fact.id]) { return; }
    state.facts[fact.id] = fact;
    var list = $("factList");
    var empty = list.querySelector(".empty");
    if (empty) { empty.remove(); }
    var li = document.createElement("li");
    li.innerHTML = "<strong>" + esc(fact.title) + "</strong><span>" + esc(fact.text) + "</span>";
    list.appendChild(li);
    $("factCount").textContent = Object.keys(state.facts).length;
  }

  // ------------------------------------------------------------ 法条
  function loadLaws(cid) {
    api("/api/laws?case=" + encodeURIComponent(cid) + "&n=3").then(function (d) {
      var box = $("lawList");
      var arts = d.articles || [];
      $("lawCount").textContent = arts.length;
      if (!arts.length) {
        box.innerHTML = "<li class='empty'>没有匹配到条文。宁可不给，也不编一条。</li>";
        return;
      }
      box.innerHTML = arts.map(function (a) {
        return "<li><strong>" + esc(a.law) + " " + esc(a.article) + " · " + esc(a.title) +
          "</strong><span>" + esc(a.gist) + "</span></li>";
      }).join("");
    }).catch(function () {
      $("lawList").innerHTML = "<li class='empty'>条文库未载入。</li>";
      toast("法条库没能载入，条文提示暂不可用", "bad");
    });
  }

  // ------------------------------------------------------------ 当事人
  function renderParties() {
    var box = $("partyList");
    box.innerHTML = "";
    state.caseData.partyOrder.forEach(function (pid) {
      var p = state.caseData.parties[pid];
      if (!p) { return; }
      var b = document.createElement("button");
      b.className = "party";
      b.dataset.party = pid;
      b.innerHTML = "<b>" + esc(p.name) + "</b><span>" + esc(p.role) + "</span>";
      b.addEventListener("click", function () { pickParty(pid); });
      box.appendChild(b);
    });
  }

  function pickParty(pid) {
    state.partyId = pid;
    var p = state.caseData.parties[pid];
    Array.prototype.forEach.call(document.querySelectorAll(".party"), function (b) {
      b.classList.toggle("on", b.dataset.party === pid);
    });
    $("who").textContent = p.name + " · " + p.role;
    $("say").placeholder = "对" + p.name + "说点什么…";
    if (!state.threads) { state.threads = {}; }
    renderThread();
    var st = (state.meters || {})[pid];
    if (st) { renderMeters(st, false); } else { $("meters").innerHTML = ""; }
    $("say").focus({ preventScroll: true });
  }

  function renderThread() {
    var t = $("thread");
    t.innerHTML = "";
    var rows = (state.threads && state.threads[state.partyId]) || [];
    if (!state.partyId) {
      t.innerHTML = "<div class='thread-empty'>先在右边点一位当事人。" +
        "<br>建议先「单独谈」——当面说第一句，往往就是最难听的那句。</div>";
      return;
    }
    if (!rows.length) {
      t.innerHTML = "<div class='thread-empty'>还没开口。可以先问一句：" +
        "<br>「你先坐下，慢慢说，我想听听你的难处。」</div>";
      return;
    }
    rows.forEach(function (m) {
      var div = document.createElement("div");
      div.className = "msg " + (m.role === "me" ? "me" : "them");
      div.innerHTML = "<div class='bubble'>" + esc(m.text) + "</div>" +
        (m.note ? "<div class='note-line'>" + esc(m.note) + "</div>" : "");
      t.appendChild(div);
    });
    t.scrollTop = t.scrollHeight;
  }

  // ------------------------------------------------------------ 说话
  $("say").addEventListener("focus", function () {
    if (window.innerWidth > 900) { return; }
    setTimeout(function () {
      var dock = $("dock");
      if (dock) { dock.scrollIntoView({ behavior: "smooth", block: "end" }); }
    }, 260);
  });

  $("composer").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!state.partyId) {
      $("hint").textContent = "先在右侧选一位当事人。";
      return;
    }
    var text = $("say").value.trim();
    if (!text) { return; }
    $("say").value = "";
    push("me", text);
    $("send").disabled = true;

    api("/api/dialogue", {
      sessionId: state.sessionId,
      partyId: state.partyId,
      text: text,
      channel: state.channel,
      offline: state.offline
    }).then(function (d) {
      var note = "";
      if (d.overstep) { note = "⚠ 越界承诺：你答应了无权答应或做不到的事"; }
      if (d.reveal) { note = (note ? note + " · " : "") + "（单独谈话 · 他说出了实情）" + d.reveal; }
      push("them", d.reply, note);
      state.meters = state.meters || {};
      state.meters[state.partyId] = d.state;
      renderMeters(d.state, d.degraded);
    }).catch(function (e) {
      push("them", "（服务异常：" + e.message + "）");
    }).then(function () {
      $("send").disabled = false;
      $("say").focus();
    });
  });

  function push(role, text, note) {
    if (!state.threads) { state.threads = {}; }
    var key = state.partyId;
    (state.threads[key] = state.threads[key] || []).push({ role: role, text: text, note: note });
    renderThread();
  }

  function renderMeters(st, degraded) {
    if (!st) { return; }
    var m = $("meters");
    m.innerHTML =
      bar("信任", st.trust) + bar("情绪", st.mood) +
      (degraded ? "<span class='deg'>本条走剧本台词</span>" : "");
  }

  function bar(label, v) {
    var pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
    return "<div class='meter'><span>" + label + "</span>" +
      "<i><b style='width:" + pct + "%'></b></i><em>" + pct + "</em></div>";
  }

  // ------------------------------------------------------------ 方案与提交
  function renderPlan() {
    var box = $("planDims");
    box.innerHTML = "";
    state.plan = state.plan || {};
    updatePlanProgress();
    (state.caseData.dimensions || []).forEach(function (dim) {
      var card = document.createElement("div");
      card.className = "plan-dim";
      card.dataset.dim = dim.id;
      var h = document.createElement("div");
      h.className = "plan-dim-head";
      h.innerHTML = "<b>" + esc(dim.name) + "</b><span>" + esc(dim.ask || "") + "</span>";
      card.appendChild(h);
      dim.options.forEach(function (opt) {
        var lab = document.createElement("label");
        lab.className = "opt";
        var input = document.createElement("input");
        input.type = "radio";
        input.name = dim.id;
        input.value = opt.id;
        input.addEventListener("change", function () {
          state.plan[dim.id] = opt.id;
          card.classList.remove("missing");
          Array.prototype.forEach.call(card.querySelectorAll(".opt"), function (x) {
            x.classList.toggle("on", x.contains(input) && input.checked);
          });
          updatePlanProgress();
        });
        lab.appendChild(input);
        lab.appendChild(document.createTextNode(opt.label));
        card.appendChild(lab);
      });
      box.appendChild(card);
    });
  }

  function updatePlanProgress() {
    var total = (state.caseData && state.caseData.dimensions || []).length;
    var done = Object.keys(state.plan || {}).filter(function (k) {
      return !!state.plan[k];
    }).length;
    var el = $("planProgress");
    if (el) {
      el.textContent = done + "/" + total;
      el.classList.toggle("done", total > 0 && done === total);
    }
    return { done: done, total: total };
  }

  function submit(mode) {
    if (!state.sessionId) { return; }
    if (state.submitting) { return; }          // 连点两下不能提交两次
    var dims = state.caseData.dimensions || [];
    if (mode === "agreement") {
      var missing = [];
      Array.prototype.forEach.call(document.querySelectorAll(".plan-dim"), function (card) {
        card.classList.remove("missing");
      });
      dims.forEach(function (d) {
        if (!state.plan[d.id]) {
          missing.push(d.name);
          var card = document.querySelector(".plan-dim[data-dim='" + d.id + "']");
          if (card) { card.classList.add("missing"); }
        }
      });
      if (missing.length) {
        toast("还有 " + missing.length + " 个维度没选：" + missing.join("、"), "bad");
        var first = document.querySelector(".plan-dim.missing");
        if (first) { first.scrollIntoView({ behavior: "smooth", block: "center" }); }
        return;
      }
    }
    state.submitting = true;
    $("btnAgree").disabled = $("btnRefer").disabled = true;
    var label = mode === "agreement" ? "出具调解协议书" : "依法告知 · 转其他途径";
    var active = mode === "agreement" ? $("btnAgree") : $("btnRefer");
    active.dataset.label = label;
    active.textContent = "判定中…";
    api("/api/submit", { sessionId: state.sessionId, plan: state.plan, mode: mode })
      .then(function (res) {
        state.reportText = "";
        state.hasReport = true;
        showReport(res);
      })
      .catch(function (e) {
        toast("提交失败：" + e.message, "bad");
      })
      .then(function () {
        state.submitting = false;
        $("btnAgree").disabled = $("btnRefer").disabled = false;
        active.textContent = label;
      });
  }

  // ------------------------------------------------------------ 复盘
  function showReport(res) {
    var rep = res.report || {};
    var body = $("reportBody");
    var sc = rep.scores || {};

    // 四维：一行一维 + 分数条。表格在手机上会挤成一坨，改用卡片式排。
    var dims = (rep.dims || []).map(function (d) {
      var pct = Math.round(Math.max(0, Math.min(1, d.quality)) * 100);
      var alt = "";
      if (d.gap > 0.2 && d.best) {
        alt = "<p class='dim-alt'>更好的做法：" + esc(d.best) + "</p>";
      } else if (d.lackFactsText) {
        alt = "<p class='dim-alt warn'>缺证据：" + esc(d.lackFactsText) + "（去现场把它们看到）</p>";
      }
      return "<div class='dim-row" + (d.trap ? " trap" : "") + "'>" +
        "<div class='dim-top'><b>" + esc(d.name) + "</b>" +
        "<span class='dim-score'>" + d.quality.toFixed(2) + "</span></div>" +
        "<div class='dim-bar'><i style='width:" + pct + "%'></i></div>" +
        "<p class='dim-pick'>你选了：" + esc(d.chosen) + "</p>" +
        alt + "</div>";
    }).join("");

    var top3 = (rep.top3 || []).map(function (t, i) {
      return "<li><b>" + (i + 1) + " · " + esc(t.dim) + "</b>" +
        "<p>你： " + esc(t.what) + "</p>" +
        "<p class='alt'>换成： " + esc(t.instead) + "</p>" +
        (t.why ? "<p class='why'>" + esc(t.why) + "</p>" : "") + "</li>";
    }).join("") || "<li class='ok'>没有明显失误，四维都选到了该选的。</li>";

    var untouched = (rep.untouched || []).map(function (n) {
      return "<li>" + esc(n.text) + "</li>";
    }).join("") || "<li class='ok'>每条诉求都碰到了。</li>";

    var pr = rep.process || {};
    var good = rep.verdict === "合格";

    $("repTitle").textContent = "训练复盘";
    body.innerHTML =
      "<div class='rep-head'>" +
        "<span class='rep-case'>" + esc(rep.caseTitle || "") +
          (rep.subtitle ? " · " + esc(rep.subtitle) : "") + "</span>" +
        "<span class='rep-time'>" + esc(rep.generatedAt || "") + "</span>" +
      "</div>" +
      "<div class='verdict " + (good ? "good" : "bad") + "'>" +
        "<div class='verdict-main'><b>" + esc((rep.ending || {}).label || "") + "</b>" +
          "<i>" + esc(rep.verdict || "") + "</i></div>" +
        "<p>" + esc(rep.why || "") + "</p>" +
      "</div>" +
      "<div class='nums'>" +
        num("覆盖率", sc.coverage, 0.60) +
        num("天花板", sc.ceiling, null) +
        num("总分", sc.total, 0.60) +
        num("置信度", sc.confidence, 0.62) +
      "</div>" +
      "<p class='nums-note'>三个分数线：及格 0.60 · 可以下结论 0.62 · 结构性冲突门槛 0.40。都是经验值，待跑数校准。</p>" +
      "<h4>四维</h4><div class='dims'>" + dims + "</div>" +
      "<h4>关键失误</h4><ol class='top3'>" + top3 + "</ol>" +
      "<h4>全程没碰到的诉求</h4><ul class='plain'>" + untouched + "</ul>" +
      "<h4>过程</h4>" +
      "<div class='proc-grid'>" +
        procCell("分别谈话", pr.separateTalk ? "有 · " + pr.separateCount + " 次" : "没有", !pr.separateTalk) +
        procCell("越界承诺", (pr.oversteps || 0) + " 次", (pr.oversteps || 0) >= 2) +
        procCell("看过点位", (pr.spotsSeen || 0) + " 处", false) +
        procCell("记下事实", (pr.factsSeen || 0) + " 条", false) +
      "</div>" +
      "<p class='audit'>本份报告有 " + (rep.auditLines || 0) +
        " 条判定记录支撑，每个数字都能在审计日志里找到出处。</p>" +
      "<p class='foot-note'>" + esc(rep.footer || "") + "</p>";

    api("/api/report/" + state.sessionId).then(function (d) {
      state.reportText = d.text || "";
    }).catch(function () { state.reportText = ""; });

    openReport();
  }

  function procCell(label, value, warn) {
    return "<div class='proc-cell" + (warn ? " warn" : "") + "'>" +
      "<span>" + esc(label) + "</span><b>" + esc(value) + "</b></div>";
  }

  var lastFocus = null;

  function openReport() {
    lastFocus = document.activeElement;
    $("reportModal").hidden = false;
    $("btnReopen").hidden = true;
    // 弹层打开时锁住背景滚动：否则手机上滑一下，底下的方案区跟着动
    document.body.classList.add("modal-open");
    $("btnClose").focus({ preventScroll: true });
  }

  function closeReport() {
    $("reportModal").hidden = true;
    document.body.classList.remove("modal-open");
    $("btnReopen").hidden = !state.hasReport;
    // 焦点回到打开它的地方，键盘用户不会"掉"到页面顶部
    if (lastFocus && lastFocus.focus) { lastFocus.focus({ preventScroll: true }); }
  }

  // Tab 只在弹层内循环：不然按着按着就跑到背后的方案区去了
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Tab" || $("reportModal").hidden) { return; }
    var box = document.querySelector(".modal-box");
    var items = box.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    if (!items.length) { return; }
    var first = items[0], last = items[items.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault(); last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault(); first.focus();
    }
  });

  function num(label, v, pass) {
    var n = typeof v === "number" ? v : 0;
    var pct = Math.round(Math.max(0, Math.min(1, n)) * 100);
    var cls = pass === null || pass === undefined ? "" : (n >= pass ? " hit" : " low");
    var line = (pass === null || pass === undefined)
      ? "" : "<i class='mark' style='left:" + Math.round(pass * 100) + "%'></i>";
    return "<div class='num-box" + cls + "'>" +
      "<span>" + label + "</span>" +
      "<b>" + n.toFixed(2) + "</b>" +
      "<div class='num-bar'>" + line + "<i style='width:" + pct + "%'></i></div>" +
      "</div>";
  }

  $("btnAgree").addEventListener("click", function () { submit("agreement"); });
  $("btnRefer").addEventListener("click", function () { submit("refer"); });
  $("btnClose").addEventListener("click", closeReport);
  $("btnReopen").addEventListener("click", openReport);
  // 点遮罩关闭；按 ESC 关闭 —— 弹层该有的两个习惯动作
  $("reportModal").addEventListener("click", function (ev) {
    if (ev.target === $("reportModal")) { closeReport(); }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !$("reportModal").hidden) { closeReport(); }
  });
  $("btnPrint").addEventListener("click", function () { window.print(); });
  $("btnAgain").addEventListener("click", function () { location.reload(); });
  $("btnCopy").addEventListener("click", function () {
    var txt = state.reportText || "";
    if (!txt) { $("hint").textContent = "文本还没生成好，稍等一秒再点。"; return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () {
        $("hint").textContent = "复盘文本已复制，可直接粘进台账。";
      }).catch(function () { fallbackCopy(txt); });
    } else {
      fallbackCopy(txt);
    }
  });

  function fallbackCopy(txt) {
    var ta = document.createElement("textarea");
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); $("hint").textContent = "复盘文本已复制。"; } catch (e) { /* 忽略 */ }
    document.body.removeChild(ta);
  }

  // ------------------------------------------------------------ 模式切换
  Array.prototype.forEach.call(document.querySelectorAll("[data-channel]"), function (b) {
    b.addEventListener("click", function () {
      state.channel = b.dataset.channel;
      Array.prototype.forEach.call(document.querySelectorAll("[data-channel]"), function (x) {
        x.classList.toggle("on", x === b);
      });
      $("hint").textContent = state.channel === "separate"
        ? "单独谈话：没有第三方在场，对方更容易说真话，但事后要如实告知另一方。"
        : "面对面：两人都在场，说错一句就可能翻脸。";
    });
  });

  // 默认就是"面对面"，按钮要如实显示当前模式
  (function () {
    var face = document.getElementById("btnFace");
    if (face) { face.classList.add("on"); }
  })();

  $("btnOffline").addEventListener("click", function () {
    state.offline = !state.offline;
    $("btnOffline").classList.toggle("on", state.offline);
    $("hint").textContent = state.offline
      ? "离线演示：不调模型，只走剧本台词。功能不中断，只是话变呆板。"
      : "已恢复：能连模型就走模型。";
  });

  boot();
})();
