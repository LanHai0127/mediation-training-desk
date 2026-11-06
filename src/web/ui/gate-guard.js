// gate-guard.js · app.html 的口令门（同步执行，别让人先闪一眼看板再跳走）
// -----------------------------------------------------------------------------
// 规则（只挡"人"，不挡验收）：
//   · ?gate=off          → 放行（自动化脚本显式绕过）
//   · HeadlessChrome UA  → 放行（test_app / qa_play / 截图工具都是无头跑）
//   · ?gate=ok           → 放行并补写 sessionStorage（口令页存储被禁用时的兜底）
//   · sessionStorage 有口令页写的 ok → 放行
//   · 其余一律 replace 到 ./gate.html?next=app.html…
// 这是演示门禁，不是安全边界：真正的密钥/鉴权在 src/auth.py，别把两者混用。
// -----------------------------------------------------------------------------
(function () {
  try {
    var q = new URLSearchParams(location.search);
    if (q.get("gate") === "off") { return; }
    if (/HeadlessChrome/i.test(navigator.userAgent)) { return; }
    if (q.get("gate") === "ok") {
      try { sessionStorage.setItem("tjt_gate", "ok"); } catch (e) { /* 隐私模式 */ }
      return;
    }
    if (sessionStorage.getItem("tjt_gate") === "ok") { return; }
    location.replace("./gate.html?next=" + encodeURIComponent("app.html" + location.search));
  } catch (e) {
    // 存储被禁用时放行：宁可少一道门，也别让人打不开训练台
  }
})();
