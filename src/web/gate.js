// gate.js · 口令页
// -----------------------------------------------------------------------------
// 背景不是色块，是加载页/地图转场同一朵云：ui/clouds.js 的 paintClouds，
// 云表照抄 app.js 的 LOAD_CLOUDS（加载页用的那张小云表），保证三处长得一样。
// 口令正确才跳 ./app.html；错误只提示，不跳转。
// -----------------------------------------------------------------------------
import { paintClouds } from "./ui/clouds.js";

// 演示口令：改这一行即可。不要在别处再写一份。
const GATE_PASSWORD = "337969";
const APP_URL = "./app.html";

// 与 app.js 的 LOAD_CLOUDS 逐项一致（加载页那张"满天云"的小云表）。
const LOAD_CLOUDS = [
  { x: 0.06, y: 0.14, r: 0.19, ph: 0.3 },
  { x: 0.30, y: 0.08, r: 0.22, ph: 1.1 },
  { x: 0.58, y: 0.12, r: 0.20, ph: 2.2 },
  { x: 0.84, y: 0.20, r: 0.18, ph: 3.4 },
  { x: 0.14, y: 0.40, r: 0.21, ph: 4.1 },
  { x: 0.44, y: 0.36, r: 0.24, ph: 0.8 },
  { x: 0.74, y: 0.44, r: 0.19, ph: 2.9 },
  { x: 0.96, y: 0.52, r: 0.17, ph: 1.6 },
  { x: 0.10, y: 0.70, r: 0.22, ph: 1.9 },
  { x: 0.38, y: 0.78, r: 0.24, ph: 3.7 },
  { x: 0.66, y: 0.70, r: 0.21, ph: 0.5 },
  { x: 0.88, y: 0.82, r: 0.20, ph: 2.6 },
  { x: 0.20, y: 0.96, r: 0.20, ph: 4.6 },
  { x: 0.56, y: 0.98, r: 0.22, ph: 1.3 },
  { x: 0.90, y: 0.98, r: 0.18, ph: 3.1 }
];

// ---------------------------------------------------------------- 云背景
const cloud = document.getElementById("gateCloud");
const ctx = cloud ? cloud.getContext("2d") : null;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let cloudRAF = 0;
let cloudLast = 0;

function paintOnce(t) {
  if (!ctx) { return; }
  paintClouds(ctx, innerWidth, innerHeight, 1, t, {
    blobs: LOAD_CLOUDS,
    scale: 0.92,
    rim: 0.06,
    shadowColor: "rgba(41,72,88,.30)",
    shadowBlur: 90
  });
}

function sizeCloud() {
  if (!cloud || !ctx) { return; }
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cloud.width = Math.max(1, Math.round(innerWidth * dpr));
  cloud.height = Math.max(1, Math.round(innerHeight * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintOnce(performance.now());
}

function pumpCloud(now) {
  if (now - cloudLast >= 80) {          // 12.5fps：云飘得很慢，省电
    cloudLast = now;
    paintOnce(now);
  }
  cloudRAF = requestAnimationFrame(pumpCloud);
}

if (cloud && ctx) {
  sizeCloud();
  if (!reduceMotion) { cloudRAF = requestAnimationFrame(pumpCloud); }
  addEventListener("resize", () => {
    sizeCloud();
    if (reduceMotion) { paintOnce(performance.now()); }
  });
}

// ---------------------------------------------------------------- 口令
const form = document.getElementById("gateForm");
const pw = document.getElementById("gatePw");
const go = document.getElementById("gateGo");
const err = document.getElementById("gateErr");
const card = document.querySelector(".gate-card");
let busy = false;

function fail(msg) {
  if (err) { err.textContent = msg; }
  if (card) {
    card.classList.remove("is-shake");
    void card.offsetWidth;              // 强制重排，连续输错也能重新抖
    card.classList.add("is-shake");
  }
  if (pw) { pw.select(); pw.focus(); }
}

// 只允许跳到本目录的 app.html，别被 ?next= 带去外站
function nextUrl() {
  let raw = "";
  try { raw = new URLSearchParams(location.search).get("next") || ""; } catch (e) { raw = ""; }
  if (/^app\.html(\?|$)/.test(raw)) { return "./" + raw; }
  return APP_URL;
}

function unlock() {
  if (busy) { return; }
  const value = (pw && pw.value ? pw.value : "").trim();
  if (!value) { fail("请输入口令"); return; }
  if (value !== GATE_PASSWORD) { fail("口令不对，请再试一次"); return; }

  busy = true;
  if (err) { err.textContent = ""; }
  if (go) { go.disabled = true; go.textContent = "正在进入…"; }
  if (pw) { pw.blur(); }

  let saved = true;
  try { sessionStorage.setItem("tjt_gate", "ok"); } catch (e) { saved = false; }
  document.body.classList.add("is-out");

  const dst = nextUrl();
  const url = saved ? dst : dst + (dst.indexOf("?") >= 0 ? "&" : "?") + "gate=ok";
  setTimeout(() => { location.replace(url); }, reduceMotion ? 60 : 300);
}

if (form) {
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    unlock();
  });
}

if (pw) {
  pw.addEventListener("input", () => { if (err && err.textContent) { err.textContent = ""; } });
  pw.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); unlock(); }
  });
  setTimeout(() => { try { pw.focus({ preventScroll: true }); } catch (e) { /* 老浏览器 */ } }, 120);
}

if (go) {
  go.addEventListener("click", (ev) => {
    ev.preventDefault();
    unlock();
  });
}
