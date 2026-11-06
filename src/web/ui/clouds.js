// clouds.js · 云形绘制（加载页 / 口令页 / 地图传送共用同一朵云）
// -----------------------------------------------------------------------------
// 从 flight.js 抽出来的纯 Canvas 函数，不依赖 three：
//   paintClouds(ctx, W, H, k, t, opts)
//   · k = 云量 0~1（0 = 没有云，1 = 盖满）
//   · t = 毫秒时间，用来算漂浮相位
//   · opts.blobs 传自定义云表（加载页/口令页用更密的小云；转场用默认六团）
// 加载页 `#loadCloud`、口令页 `#gateCloud`、转场 `flight` 都调这一个函数，
// 三处的云必须长得一模一样，改形状只改这里。
// -----------------------------------------------------------------------------

const BLOBS = [
  { x: 0.10, y: 0.85, r: 0.55, ph: 0.0 },
  { x: 0.38, y: 0.95, r: 0.62, ph: 1.7 },
  { x: 0.72, y: 0.90, r: 0.58, ph: 3.1 },
  { x: 0.95, y: 0.18, r: 0.50, ph: 0.9 },
  { x: 0.20, y: 0.20, r: 0.48, ph: 2.4 },
  { x: 0.55, y: 0.50, r: 0.70, ph: 4.2 }
];

export function paintClouds(ctx, W, H, k, t, opts = {}) {
  if (!ctx || !(W > 0) || !(H > 0)) { return; }
  ctx.clearRect(0, 0, W, H);
  if (k <= 0.001) { return; }
  // scale：云团整体缩放。1 = 转场那套（会盖满整屏），加载页用 0.9 左右，
  // 让边角透出底色，云才看得出"云"，不然就是一整块奶油白。
  const scale = opts.scale ?? 1;
  const alpha = Math.min(1, 0.35 + 0.65 * k);
  // 外轮廓：把每团云的 5 个圆整体放大一圈、先垫一层墨色（"奶油白 + 0.08 的墨边"）。
  // 不能给 30 个圆各描一次边 —— 那样云团内部会露出一圈圈圆弧；放大一版垫底，
  // 只有并集的外缘看得见，云才不会在浅底上糊成一块白板。
  // blobs：云团清单。不给就用转场那六团（会把整屏盖满）；
  // 加载页 / 口令页要给一片"满天云"，自己传一张更密的小云表。
  const list = Array.isArray(opts.blobs) && opts.blobs.length ? opts.blobs : BLOBS;
  const grow = Math.max(3, Math.max(W, H) * 0.005);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(0.6 + 0.75 * k, 0.6 + 0.75 * k);
  ctx.translate(-W / 2, -H / 2);

  ctx.shadowBlur = 0;
  ctx.globalAlpha = alpha * (opts.rim ?? 0.16);
  ctx.fillStyle = opts.rimColor || "#355364";
  for (const b of list) { blobPath(ctx, b, W, H, k, t, grow, scale); }

  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#fffaf0";
  ctx.shadowColor = opts.shadowColor || "rgba(255,250,240,.9)";
  ctx.shadowBlur = opts.shadowBlur ?? 60;
  for (const b of list) { blobPath(ctx, b, W, H, k, t, 0, scale); }
  ctx.restore();
}

// 一团云 = 5 个叠起来的圆，带缓慢漂浮；grow 是给轮廓层用的外扩量。
// 5 个圆放进**同一条 path 一次填**：分开填的话每个圆都会把阴影投到前面那个圆上，
// 云团内部会露出一圈圈圆弧（看起来像几块盘子叠在一起，而不是一朵云）。
function blobPath(ctx, b, W, H, k, t, grow, scale = 1) {
  const drift = Math.sin(t * 0.0006 + b.ph) * 10 * scale;
  const bx = b.x * W + drift, by = b.y * H + Math.cos(t * 0.0005 + b.ph) * 8 * scale;
  const R = b.r * Math.max(W, H) * (0.55 + 0.45 * k) * scale;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + b.ph;
    const rr = R * (0.55 + 0.18 * Math.sin(i * 2.1 + b.ph)) + grow;
    const x = bx + Math.cos(a) * R * 0.42, y = by + Math.sin(a) * R * 0.28;
    ctx.moveTo(x + rr, y);
    ctx.arc(x, y, rr, 0, Math.PI * 2);
  }
  ctx.fill();
}
