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
      loadLaws(state.caseData.id);
    }).catch(function (e) {
      $("caseTitle").textContent = "载入失败：" + e.message;
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
    $("hint").textContent = "点地面走过去 · 点物件查看";
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
      $("hint").textContent = spot.label + "：" + (spot.look || "");
      if (spot.fact && state.caseData.facts) {
        var f = state.caseData.facts.filter(function (x) { return x.id === spot.fact; })[0];
        if (f) { remember(f); }
      }
      if (spot.talk) { pickParty(spot.talk); }
    }).catch(function (e) {
      $("hint").textContent = "查看失败：" + e.message;
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
  }

  function renderThread() {
    var t = $("thread");
    t.innerHTML = "";
    var rows = (state.threads && state.threads[state.partyId]) || [];
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
    (state.caseData.dimensions || []).forEach(function (dim) {
      var card = document.createElement("div");
      card.className = "plan-dim";
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
          Array.prototype.forEach.call(card.querySelectorAll(".opt"), function (x) {
            x.classList.toggle("on", x.contains(input) && input.checked);
          });
        });
        lab.appendChild(input);
        lab.appendChild(document.createTextNode(opt.label));
        card.appendChild(lab);
      });
      box.appendChild(card);
    });
  }

  function submit(mode) {
    if (!state.sessionId) { return; }
    var picked = Object.keys(state.plan || {}).length;
    if (mode === "agreement" && picked < (state.caseData.dimensions || []).length) {
      $("hint").textContent = "还有 " + ((state.caseData.dimensions || []).length - picked) +
        " 个维度没选。没想清楚的部分，谈完再交。";
      return;
    }
    $("btnAgree").disabled = $("btnRefer").disabled = true;
    api("/api/submit", { sessionId: state.sessionId, plan: state.plan, mode: mode })
      .then(function (res) {
        state.reportText = "";
        showReport(res);
      })
      .catch(function (e) {
        $("hint").textContent = "提交失败：" + e.message;
      })
      .then(function () {
        $("btnAgree").disabled = $("btnRefer").disabled = false;
      });
  }

  // ------------------------------------------------------------ 复盘
  function showReport(res) {
    var rep = res.report || {};
    var body = $("reportBody");
    var rows = (rep.dims || []).map(function (d) {
      return "<tr><td>" + esc(d.name) + "</td><td>" + esc(d.chosen) +
        "</td><td class='num'>" + d.quality.toFixed(2) + "</td><td>" +
        (d.gap > 0.2 && d.best ? "更好的做法：" + esc(d.best)
          : (d.lackFactsText ? "缺证据：" + esc(d.lackFactsText) : "—")) + "</td></tr>";
    }).join("");
    var top3 = (rep.top3 || []).map(function (t, i) {
      return "<li><b>" + (i + 1) + "· " + esc(t.dim) + "</b><p>你： " + esc(t.what) +
        "</p><p class='alt'>换成： " + esc(t.instead) + "</p>" +
        (t.why ? "<p class='why'>" + esc(t.why) + "</p>" : "") + "</li>";
    }).join("") || "<li class='ok'>没有明显失误。</li>";
    var untouched = (rep.untouched || []).map(function (n) {
      return "<li>" + esc(n.text) + "</li>";
    }).join("") || "<li class='ok'>每条诉求都碰到了。</li>";
    var p = rep.process || {};

    $("repTitle").textContent = "训练复盘 · " + (rep.caseTitle || "");
    body.innerHTML =
      "<div class='verdict " + (rep.verdict === "合格" ? "good" : "bad") + "'>" +
        "<div class='v-label'>" + esc(rep.ending ? rep.ending.label : "") + "</div>" +
        "<div class='v-verdict'>" + esc(rep.verdict || "") + "</div>" +
        "<p>" + esc(rep.why || "") + "</p></div>" +
      "<div class='nums'>" +
        num("覆盖率", rep.scores.coverage) + num("天花板", rep.scores.ceiling) +
        num("总分", rep.scores.total) + num("置信度", rep.scores.confidence) + "</div>" +
      "<h4>四维</h4><table class='rep'><thead><tr><th>维度</th><th>你的选择</th><th>得分</th><th>对照</th></tr></thead><tbody>" +
      rows + "</tbody></table>" +
      "<h4>关键失误</h4><ol class='top3'>" + top3 + "</ol>" +
      "<h4>全程没碰到的诉求</h4><ul class='plain'>" + untouched + "</ul>" +
      "<h4>过程</h4><p class='proc'>分别谈话：" + (p.separateTalk ? "有" : "没有") +
        "（" + (p.separateCount || 0) + " 次）｜ 越界承诺：" + (p.oversteps || 0) + " 次 ｜ " +
        "看过 " + (p.spotsSeen || 0) + " 处、记下 " + (p.factsSeen || 0) + " 条事实</p>" +
      "<p class='audit'>报告里的每个数字都能在审计日志里找到来源（本份 " +
        (rep.auditLines || 0) + " 条判定记录）。</p>" +
      "<p class='foot-note'>" + esc(rep.footer || "") + "</p>";

    state.sessionId = state.sessionId;
    $("reportModal").hidden = false;
    api("/api/report/" + state.sessionId).then(function (d) {
      state.reportText = d.text || "";
    }).catch(function () { state.reportText = ""; });
  }

  function num(label, v) {
    var n = typeof v === "number" ? v : 0;
    return "<div class='num-box'><span>" + label + "</span><b>" + n.toFixed(2) + "</b></div>";
  }

  $("btnAgree").addEventListener("click", function () { submit("agreement"); });
  $("btnRefer").addEventListener("click", function () { submit("refer"); });
  $("btnClose").addEventListener("click", function () { $("reportModal").hidden = true; });
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

  $("btnOffline").addEventListener("click", function () {
    state.offline = !state.offline;
    $("btnOffline").classList.toggle("on", state.offline);
    $("hint").textContent = state.offline
      ? "离线演示：不调模型，只走剧本台词。功能不中断，只是话变呆板。"
      : "已恢复：能连模型就走模型。";
  });

  boot();
})();
