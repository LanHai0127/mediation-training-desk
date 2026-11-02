/* 登录页脚本：POST /api/login，成功后回跳 next（只认站内路径）。
   失败一律把服务端给的原因显示出来，不要只说"登录失败"——现场排障时这句最没用。 */
(function () {
  "use strict";

  var form = document.getElementById("f");
  var err = document.getElementById("err");
  var go = document.getElementById("go");

  function nextPath() {
    var p = new URLSearchParams(location.search).get("next") || "/";
    // 只允许站内绝对路径，挡掉 //evil.com 这种协议相对跳转
    if (p.charAt(0) !== "/" || p.charAt(1) === "/") { p = "/"; }
    return p;
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    err.textContent = "";
    go.disabled = true;
    go.textContent = "验证中…";

    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: document.getElementById("u").value.trim(),
        password: document.getElementById("p").value
      })
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "服务返回了无法解析的内容" }; })
        .then(function (data) { return { status: r.status, data: data }; });
    }).then(function (res) {
      if (res.data && res.data.ok) {
        location.replace(nextPath());
        return;
      }
      err.textContent = (res.data && res.data.error) || ("登录失败（HTTP " + res.status + "）");
      go.disabled = false;
      go.textContent = "进入训练台";
    }).catch(function () {
      err.textContent = "网络不通，请检查服务是否在运行";
      go.disabled = false;
      go.textContent = "进入训练台";
    });
  });
})();
