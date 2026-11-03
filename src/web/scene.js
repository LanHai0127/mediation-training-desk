/* 调解台 · 2.5D 场景引擎
 *
 * 目标：一块画布画出"能走进去看"的现场，而不是一张平面示意图。
 *
 * 三件事必须一起想清楚，否则会互相打架：
 *   1. 投影 —— 世界坐标 (x, y) → 屏幕坐标。y 越大越靠前，物体与人按 y 放大，
 *      这就是"2.5D"的全部来源：没有真 3D，只有透视缩放 + 画家算法。
 *   2. 寻路 —— 走不上去的地方必须和画出来的地面边界是**同一个常量**（BACKDROP_Y）。
 *      拆成两个值就会出现"看着是地面、点过去站不动"，这种 bug 现场演示必翻车。
 *   3. 遮挡 —— 所有可绘制物按 y 排序后再画，人夹在中间，才有前后关系。
 *
 * 移动端：指针事件统一走 Pointer Events，点一下就走过去，不依赖鼠标。
 */
(function (global) {
  "use strict";

  // ============================================================ 常量
  // ★ BACKDROP_Y 同时是「地平线（画出来的地面从这开始）」和「寻路走不上去的边界」。
  //   只此一处定义，不许在别处写死 96 之类的数字。
  var BACKDROP_Y = 96;

  var WORLD = { w: 1400, h: 820 };
  var TILE = 28;              // A* 网格
  var PLAYER_R = 14;          // 人物碰撞半径
  var PLAYER_SPEED = 230;     // 世界坐标 px/s
  var DEPTH = 0.8;            // 纵深压缩：世界 y 差 1 → 屏幕 y 差 0.8
  var INTERACT_RANGE = 120;   // 走到多近才能"查看"

  // 地面材质配色：[远端, 近端]。同一间屋子和一块球场必须一眼分得开。
  var GROUND_COLORS = {
    wood: ["#e6d9c4", "#dccbb0"],
    tile: ["#ecebe6", "#e0ded6"],
    concrete: ["#dfdcd2", "#d3cfc3"],
    dirt: ["#d8c8ac", "#cbb894"],
    grass: ["#cfd9bd", "#bccda6"],
    court: ["#5f7fa6", "#4d6c92"]
  };

  var PALETTE = {
    wallFar: "#dfe3ea",
    wallNear: "#e9ecf1",
    floor: "#e7e2d8",
    floorAlt: "#e2dccf",
    floorLine: "#d5cec0",
    wood: "#b98b5e",
    woodDark: "#8a6240",
    metal: "#9aa3ae",
    metalDark: "#6b7480",
    fabric: "#8fa3bf",
    fabricDark: "#6d80a0",
    white: "#fbfaf8",
    ink: "#2b3138",
    inkSoft: "#6b7480",
    brand: "#1d4ed8",
    brandSoft: "#dbe6ff",
    warn: "#b45309",
    plant: "#5b8c63",
    plantDark: "#3f6a47",
    screen: "#20262e",
    accent: "#c05c3a"
  };

  // ============================================================ 场景物件绘制
  // 约定：每个 draw 函数以「物体脚底中心」为原点 (0,0)，向上为负 y，
  //       k 是当前纵深缩放系数（0.62~1.24）。所有尺寸都乘 k，不做例外。

  function rect(ctx, x, y, w, h, fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }

  function roundRect(ctx, x, y, w, h, r, fill) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function shadow(ctx, w, k) {
    ctx.beginPath();
    ctx.ellipse(0, 0, w * k, w * 0.34 * k, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(60,50,40,.14)";
    ctx.fill();
  }

  var SPOT_KINDS = {
    // -------------------------------------------------- 派出所调解室
    table_mediation: function (ctx, k) {
      var w = 96 * k, h = 34 * k;
      shadow(ctx, 62, k);
      roundRect(ctx, -w / 2, -h - 26 * k, w, h, 6 * k, PALETTE.wood);
      roundRect(ctx, -w / 2, -h - 26 * k, w, 8 * k, 4 * k, "#c99a6b");
      rect(ctx, -w / 2 + 6 * k, -26 * k, 8 * k, 26 * k, PALETTE.woodDark);
      rect(ctx, w / 2 - 14 * k, -26 * k, 8 * k, 26 * k, PALETTE.woodDark);
      // 桌上：笔记本 + 两支笔，暗示"正在调解"
      roundRect(ctx, -22 * k, -h - 24 * k, 26 * k, 16 * k, 2 * k, PALETTE.white);
      rect(ctx, 8 * k, -h - 20 * k, 14 * k, 2.4 * k, PALETTE.inkSoft);
    },
    bench_long: function (ctx, k) {
      var w = 88 * k;
      shadow(ctx, 54, k);
      roundRect(ctx, -w / 2, -34 * k, w, 12 * k, 4 * k, PALETTE.fabric);
      roundRect(ctx, -w / 2, -56 * k, w, 12 * k, 4 * k, PALETTE.fabricDark);
      rect(ctx, -w / 2 + 8 * k, -22 * k, 6 * k, 22 * k, PALETTE.metalDark);
      rect(ctx, w / 2 - 14 * k, -22 * k, 6 * k, 22 * k, PALETTE.metalDark);
    },
    gavel_stand: function (ctx, k) {
      // 中性化的"调解席"小木托：一块木座 + 一枚木槌，不含任何徽标元素
      shadow(ctx, 26, k);
      roundRect(ctx, -18 * k, -14 * k, 36 * k, 10 * k, 3 * k, PALETTE.woodDark);
      rect(ctx, -3 * k, -34 * k, 6 * k, 20 * k, PALETTE.wood);
      roundRect(ctx, -12 * k, -40 * k, 24 * k, 9 * k, 3 * k, PALETTE.wood);
    },
    cabinet: function (ctx, k) {
      shadow(ctx, 40, k);
      roundRect(ctx, -34 * k, -104 * k, 68 * k, 104 * k, 4 * k, "#cfd6de");
      for (var i = 0; i < 3; i++) {
        rect(ctx, -30 * k, -96 * k + i * 32 * k, 60 * k, 26 * k, "#dde3ea");
        rect(ctx, -30 * k, -72 * k + i * 32 * k, 60 * k, 2 * k, "#b9c1cb");
        rect(ctx, -6 * k, -88 * k + i * 32 * k, 12 * k, 4 * k, PALETTE.metalDark);
      }
    },
    water_cooler: function (ctx, k) {
      shadow(ctx, 28, k);
      roundRect(ctx, -20 * k, -74 * k, 40 * k, 74 * k, 5 * k, "#eef1f4");
      roundRect(ctx, -13 * k, -104 * k, 26 * k, 30 * k, 6 * k, "#cbe3f2");
      rect(ctx, -20 * k, -46 * k, 40 * k, 4 * k, "#cfd6de");
      rect(ctx, -10 * k, -52 * k, 8 * k, 6 * k, "#3b82f6");
      rect(ctx, 2 * k, -52 * k, 8 * k, 6 * k, "#ef4444");
    },
    camera_dome: function (ctx, k) {
      ctx.beginPath();
      ctx.ellipse(0, -96 * k, 14 * k, 9 * k, 0, Math.PI, 0);
      ctx.fillStyle = "#e6eaf0";
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, -96 * k, 9 * k, 6 * k, 0, Math.PI, 0);
      ctx.fillStyle = PALETTE.screen;
      ctx.fill();
      rect(ctx, -1.5 * k, -132 * k, 3 * k, 36 * k, "#c3cad4");
    },
    board_notice: function (ctx, k) {
      shadow(ctx, 34, k);
      rect(ctx, -3 * k, -70 * k, 6 * k, 70 * k, PALETTE.metalDark);
      roundRect(ctx, -36 * k, -108 * k, 72 * k, 46 * k, 3 * k, "#f3f5f8");
      rect(ctx, -36 * k, -108 * k, 72 * k, 10 * k, PALETTE.brand);
      for (var i = 0; i < 3; i++) {
        rect(ctx, -28 * k, -92 * k + i * 10 * k, 40 * k - i * 6 * k, 3 * k, "#c3cad4");
      }
    },
    desk_office: function (ctx, k) {
      var w = 78 * k;
      shadow(ctx, 50, k);
      roundRect(ctx, -w / 2, -52 * k, w, 10 * k, 3 * k, "#c9a17a");
      rect(ctx, -w / 2 + 6 * k, -42 * k, 7 * k, 42 * k, PALETTE.woodDark);
      rect(ctx, w / 2 - 13 * k, -42 * k, 7 * k, 42 * k, PALETTE.woodDark);
      roundRect(ctx, -26 * k, -50 * k, 30 * k, 20 * k, 2 * k, PALETTE.white);
      rect(ctx, 10 * k, -56 * k, 16 * k, 12 * k, PALETTE.screen);
    },
    ledger_stack: function (ctx, k) {
      shadow(ctx, 26, k);
      for (var i = 0; i < 4; i++) {
        roundRect(ctx, -20 * k, -8 * k - i * 7 * k, 40 * k, 7 * k, 2 * k, i % 2 ? "#e8e2d4" : "#f2eee4");
      }
      rect(ctx, -20 * k, -8 * k, 40 * k, 2 * k, "#cfc6b4");
    },
    board_village: function (ctx, k) {
      shadow(ctx, 46, k);
      rect(ctx, -30 * k, -84 * k, 5 * k, 84 * k, PALETTE.woodDark);
      rect(ctx, 25 * k, -84 * k, 5 * k, 84 * k, PALETTE.woodDark);
      roundRect(ctx, -40 * k, -136 * k, 80 * k, 56 * k, 3 * k, "#f6f3ea");
      rect(ctx, -40 * k, -136 * k, 80 * k, 12 * k, "#8a6240");
      for (var i = 0; i < 3; i++) {
        rect(ctx, -32 * k, -118 * k + i * 12 * k, 64 * k, 3 * k, "#bfb6a2");
      }
    },
    radiator: function (ctx, k) {
      shadow(ctx, 34, k);
      for (var i = 0; i < 7; i++) {
        roundRect(ctx, -32 * k + i * 9 * k, -46 * k, 6 * k, 44 * k, 2 * k, "#dfe3e8");
      }
      rect(ctx, -34 * k, -50 * k, 68 * k, 4 * k, "#c7ccd3");
    },
    clock_wall: function (ctx, k) {
      ctx.beginPath();
      ctx.arc(0, -118 * k, 20 * k, 0, Math.PI * 2);
      ctx.fillStyle = "#f7f5ef";
      ctx.fill();
      ctx.lineWidth = 2.5 * k;
      ctx.strokeStyle = PALETTE.woodDark;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -118 * k);
      ctx.lineTo(0, -130 * k);
      ctx.moveTo(0, -118 * k);
      ctx.lineTo(9 * k, -114 * k);
      ctx.lineWidth = 2 * k;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
    },
    // -------------------------------------------------- 居民家中
    sofa: function (ctx, k) {
      var w = 104 * k;
      shadow(ctx, 58, k);
      roundRect(ctx, -w / 2, -40 * k, w, 34 * k, 8 * k, PALETTE.fabric);
      roundRect(ctx, -w / 2, -72 * k, w, 34 * k, 8 * k, PALETTE.fabricDark);
      roundRect(ctx, -w / 2 - 6 * k, -52 * k, 14 * k, 30 * k, 6 * k, PALETTE.fabricDark);
      roundRect(ctx, w / 2 - 8 * k, -52 * k, 14 * k, 30 * k, 6 * k, PALETTE.fabricDark);
      rect(ctx, -w / 2 + 12 * k, -8 * k, 6 * k, 8 * k, PALETTE.woodDark);
      rect(ctx, w / 2 - 18 * k, -8 * k, 6 * k, 8 * k, PALETTE.woodDark);
    },
    tea_table: function (ctx, k) {
      var w = 68 * k;
      shadow(ctx, 40, k);
      roundRect(ctx, -w / 2, -26 * k, w, 10 * k, 4 * k, "#a9805a");
      rect(ctx, -w / 2 + 6 * k, -16 * k, 6 * k, 16 * k, PALETTE.woodDark);
      rect(ctx, w / 2 - 12 * k, -16 * k, 6 * k, 16 * k, PALETTE.woodDark);
      roundRect(ctx, -14 * k, -38 * k, 16 * k, 12 * k, 2 * k, PALETTE.white);
    },
    tv: function (ctx, k) {
      shadow(ctx, 36, k);
      roundRect(ctx, -34 * k, -64 * k, 68 * k, 42 * k, 4 * k, PALETTE.screen);
      rect(ctx, -30 * k, -60 * k, 60 * k, 34 * k, "#2f3946");
      rect(ctx, -4 * k, -22 * k, 8 * k, 14 * k, PALETTE.metalDark);
      roundRect(ctx, -18 * k, -10 * k, 36 * k, 6 * k, 3 * k, PALETTE.metalDark);
    },
    shoe_cabinet: function (ctx, k) {
      shadow(ctx, 32, k);
      roundRect(ctx, -28 * k, -48 * k, 56 * k, 48 * k, 3 * k, "#d8cbb6");
      rect(ctx, -28 * k, -34 * k, 56 * k, 2 * k, "#bfae94");
      rect(ctx, -24 * k, -46 * k, 10 * k, 8 * k, "#8a6240");
      rect(ctx, -6 * k, -46 * k, 10 * k, 8 * k, "#8a6240");
    },
    dining_table: function (ctx, k) {
      var w = 88 * k;
      shadow(ctx, 52, k);
      roundRect(ctx, -w / 2, -40 * k, w, 9 * k, 4 * k, "#c8a377");
      rect(ctx, -w / 2 + 10 * k, -31 * k, 6 * k, 31 * k, PALETTE.woodDark);
      rect(ctx, w / 2 - 16 * k, -31 * k, 6 * k, 31 * k, PALETTE.woodDark);
      for (var i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(-20 * k + i * 20 * k, -44 * k, 6 * k, 0, Math.PI * 2);
        ctx.fillStyle = "#f2efe8";
        ctx.fill();
      }
    },
    toys: function (ctx, k) {
      shadow(ctx, 22, k);
      roundRect(ctx, -14 * k, -12 * k, 14 * k, 12 * k, 2 * k, "#e6b422");   // 小方块
      ctx.beginPath();
      ctx.arc(8 * k, -9 * k, 8 * k, 0, Math.PI * 2);
      ctx.fillStyle = "#d0605c";
      ctx.fill();
      rect(ctx, -2 * k, -22 * k, 3 * k, 10 * k, "#7aa7d8");
    },
    plant: function (ctx, k) {
      shadow(ctx, 20, k);
      roundRect(ctx, -12 * k, -16 * k, 24 * k, 16 * k, 3 * k, "#b98b5e");
      ctx.beginPath();
      ctx.ellipse(-6 * k, -30 * k, 12 * k, 18 * k, -0.3, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.plant;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(7 * k, -34 * k, 11 * k, 17 * k, 0.35, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.plantDark;
      ctx.fill();
    },
    door: function (ctx, k) {
      roundRect(ctx, -24 * k, -96 * k, 48 * k, 96 * k, 3 * k, "#a88a68");
      roundRect(ctx, -19 * k, -90 * k, 38 * k, 40 * k, 2 * k, "#b99a76");
      roundRect(ctx, -19 * k, -44 * k, 38 * k, 34 * k, 2 * k, "#b99a76");
      ctx.beginPath();
      ctx.arc(16 * k, -50 * k, 3 * k, 0, Math.PI * 2);
      ctx.fillStyle = "#e3c98d";
      ctx.fill();
    },
    window: function (ctx, k) {
      roundRect(ctx, -30 * k, -92 * k, 60 * k, 58 * k, 3 * k, "#cfe0ef");
      rect(ctx, -30 * k, -92 * k, 60 * k, 58 * k, "rgba(255,255,255,.25)");
      ctx.strokeStyle = "#e8edf3";
      ctx.lineWidth = 3 * k;
      ctx.beginPath();
      ctx.moveTo(0, -92 * k); ctx.lineTo(0, -34 * k);
      ctx.moveTo(-30 * k, -63 * k); ctx.lineTo(30 * k, -63 * k);
      ctx.stroke();
      rect(ctx, -33 * k, -94 * k, 66 * k, 4 * k, "#b9c1cb");
      rect(ctx, -33 * k, -36 * k, 66 * k, 4 * k, "#b9c1cb");
    },
    // -------------------------------------------------- 派出所值班室
    duty_desk: function (ctx, k) {
      var w = 110 * k;
      shadow(ctx, 56, k);
      roundRect(ctx, -w / 2, -52 * k, w, 12 * k, 3 * k, "#b9b4ac");
      roundRect(ctx, -w / 2, -52 * k, w, 4 * k, 2 * k, "#cfcac2");
      rect(ctx, -w / 2 + 8 * k, -40 * k, 8 * k, 40 * k, "#8f8a83");
      rect(ctx, w / 2 - 16 * k, -40 * k, 8 * k, 40 * k, "#8f8a83");
      // 台面上的显示器与座机
      roundRect(ctx, -30 * k, -86 * k, 34 * k, 26 * k, 3 * k, PALETTE.screen);
      rect(ctx, -26 * k, -82 * k, 26 * k, 18 * k, "#33414f");
      rect(ctx, -14 * k, -60 * k, 4 * k, 8 * k, "#6b7480");
      roundRect(ctx, 14 * k, -62 * k, 22 * k, 10 * k, 2 * k, "#3f4a56");
      rect(ctx, 24 * k, -66 * k, 12 * k, 5 * k, "#2b323a");
      // 登记簿
      roundRect(ctx, -48 * k, -60 * k, 18 * k, 10 * k, 2 * k, PALETTE.white);
    },
    phone_set: function (ctx, k) {
      shadow(ctx, 16, k);
      roundRect(ctx, -14 * k, -20 * k, 28 * k, 10 * k, 2 * k, "#3f4a56");
      rect(ctx, -6 * k, -26 * k, 12 * k, 7 * k, "#2b323a");
      ctx.strokeStyle = "#3f4a56";
      ctx.lineWidth = 2.5 * k;
      ctx.beginPath();
      ctx.moveTo(-12 * k, -20 * k);
      ctx.quadraticCurveTo(-18 * k, -34 * k, -10 * k, -40 * k);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-10 * k, -42 * k, 3.5 * k, 0, Math.PI * 2);
      ctx.fillStyle = "#3f4a56";
      ctx.fill();
    },
    notice_wall: function (ctx, k) {
      roundRect(ctx, -46 * k, -96 * k, 92 * k, 62 * k, 3 * k, "#f2f1ec");
      rect(ctx, -46 * k, -96 * k, 92 * k, 10 * k, PALETTE.brand);
      var colors = ["#ffffff", "#fdf3e3", "#eef4ff", "#ffffff"];
      for (var i = 0; i < 4; i++) {
        rect(ctx, -40 * k + (i % 2) * 44 * k, -82 * k + Math.floor(i / 2) * 26 * k,
             36 * k, 20 * k, colors[i]);
        rect(ctx, -36 * k + (i % 2) * 44 * k, -76 * k + Math.floor(i / 2) * 26 * k,
             26 * k, 2 * k, "#c9c4ba");
      }
    },
    radio_stand: function (ctx, k) {
      shadow(ctx, 18, k);
      roundRect(ctx, -18 * k, -14 * k, 36 * k, 8 * k, 2 * k, "#2b323a");
      for (var i = 0; i < 2; i++) {
        rect(ctx, -12 * k + i * 14 * k, -34 * k, 7 * k, 20 * k, "#3f4a56");
        rect(ctx, -12 * k + i * 14 * k, -38 * k, 7 * k, 5 * k, "#6b7480");
      }
      rect(ctx, 10 * k, -20 * k, 4 * k, 2 * k, "#7ac47f");
    },

    // -------------------------------------------------- 篮球场
    hoop: function (ctx, k) {
      shadow(ctx, 26, k);
      rect(ctx, -4 * k, -150 * k, 8 * k, 150 * k, "#5b6672");
      rect(ctx, -26 * k, -150 * k, 52 * k, 5 * k, "#4c5661");
      roundRect(ctx, -34 * k, -148 * k, 68 * k, 46 * k, 3 * k, "#e9eef2");
      rect(ctx, -34 * k, -148 * k, 68 * k, 3 * k, "#d3dae0");
      ctx.strokeStyle = "#c8593f";
      ctx.lineWidth = 2 * k;
      ctx.strokeRect(-9 * k, -128 * k, 18 * k, 14 * k);
      ctx.beginPath();
      ctx.arc(0, -118 * k, 9 * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -104 * k, 8 * k, 0, Math.PI);
      ctx.strokeStyle = "#e0642f";
      ctx.lineWidth = 2.5 * k;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = 1 * k;
      for (var i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 2.4 * k, -104 * k);
        ctx.lineTo(i * 2.4 * k, -94 * k);
        ctx.stroke();
      }
      for (var j = 0; j < 3; j++) {
        ctx.beginPath();
        ctx.moveTo(-7 * k, -101 * k + j * 3.5 * k);
        ctx.quadraticCurveTo(0, -99 * k + j * 3.5 * k, 7 * k, -101 * k + j * 3.5 * k);
        ctx.stroke();
      }
    },
    speaker_box: function (ctx, k) {
      shadow(ctx, 20, k);
      roundRect(ctx, -16 * k, -26 * k, 32 * k, 26 * k, 3 * k, "#2f3742");
      ctx.beginPath();
      ctx.arc(0, -13 * k, 8 * k, 0, Math.PI * 2);
      ctx.fillStyle = "#4b5563";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -13 * k, 3.4 * k, 0, Math.PI * 2);
      ctx.fillStyle = "#8b95a1";
      ctx.fill();
      ctx.strokeStyle = "#3f4a56";
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.arc(0, -30 * k, 9 * k, Math.PI, 0);
      ctx.stroke();
      rect(ctx, 10 * k, -22 * k, 3 * k, 2 * k, "#7ac47f");
    },
    bench_park: function (ctx, k) {
      var w = 76 * k;
      shadow(ctx, 44, k);
      for (var i = 0; i < 3; i++) {
        rect(ctx, -w / 2, -36 * k + i * 7 * k, w, 5 * k, "#a9805a");
      }
      for (var j = 0; j < 2; j++) {
        rect(ctx, -w / 2 + 4 * k, -58 * k + j * 8 * k, w - 8 * k, 5 * k, "#b98b5e");
      }
      rect(ctx, -w / 2 + 6 * k, -30 * k, 4 * k, 30 * k, "#4c5661");
      rect(ctx, w / 2 - 10 * k, -30 * k, 4 * k, 30 * k, "#4c5661");
    },
    lamp_post: function (ctx, k) {
      rect(ctx, -2.5 * k, -170 * k, 5 * k, 170 * k, "#7d8792");
      roundRect(ctx, -18 * k, -178 * k, 36 * k, 10 * k, 3 * k, "#5b6672");
      rect(ctx, -14 * k, -176 * k, 28 * k, 4 * k, "#fff4d6");
      ctx.beginPath();
      ctx.moveTo(-16 * k, -176 * k);
      ctx.lineTo(16 * k, -176 * k);
      ctx.lineTo(34 * k, -120 * k);
      ctx.lineTo(-34 * k, -120 * k);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,226,160,.16)";
      ctx.fill();
    },
    fence: function (ctx, k) {
      rect(ctx, -2 * k, -78 * k, 4 * k, 78 * k, "#7d8792");
      rect(ctx, 54 * k, -74 * k, 4 * k, 74 * k, "#7d8792");
      ctx.strokeStyle = "rgba(120,130,140,.55)";
      ctx.lineWidth = 0.8 * k;
      for (var i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.moveTo(-2 * k + i * 8 * k, -76 * k);
        ctx.lineTo(-2 * k + i * 8 * k, -2 * k);
        ctx.stroke();
      }
      for (var j = 0; j < 6; j++) {
        ctx.beginPath();
        ctx.moveTo(-2 * k, -76 * k + j * 13 * k);
        ctx.lineTo(58 * k, -76 * k + j * 13 * k);
        ctx.stroke();
      }
      rect(ctx, -2 * k, -78 * k, 60 * k, 3 * k, "#7d8792");
    },
    trash_bin: function (ctx, k) {
      shadow(ctx, 22, k);
      roundRect(ctx, -18 * k, -40 * k, 17 * k, 40 * k, 3 * k, "#6b7480");
      roundRect(ctx, 1 * k, -40 * k, 17 * k, 40 * k, 3 * k, "#4a7fa5");
      rect(ctx, -18 * k, -44 * k, 17 * k, 5 * k, "#8b95a1");
      rect(ctx, 1 * k, -44 * k, 17 * k, 5 * k, "#5a8fb5");
    },

    // -------------------------------------------------- 院墙与排水沟
    ditch: function (ctx, k) {
      roundRect(ctx, -70 * k, -14 * k, 140 * k, 14 * k, 3 * k, "#8d8779");
      roundRect(ctx, -66 * k, -11 * k, 132 * k, 8 * k, 2 * k, "#7c9aa8");
      ctx.globalAlpha = .55;
      roundRect(ctx, -60 * k, -9 * k, 60 * k, 3 * k, 1.5 * k, "#a8c4cf");
      ctx.globalAlpha = 1;
      for (var i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(-40 * k + i * 32 * k, -8 * k, 5 * k, 2.2 * k, .3, 0, Math.PI * 2);
        ctx.fillStyle = "#b98b5e";
        ctx.fill();
      }
    },
    marker_stone: function (ctx, k) {
      shadow(ctx, 22, k);
      // 土堆
      ctx.beginPath();
      ctx.ellipse(0, -4 * k, 26 * k, 8 * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#b8a488";
      ctx.fill();
      // 石身
      roundRect(ctx, -12 * k, -46 * k, 24 * k, 44 * k, 4 * k, "#cfc9be");
      roundRect(ctx, -12 * k, -46 * k, 24 * k, 6 * k, 3 * k, "#e2dcd1");
      // 刻痕
      ctx.strokeStyle = "#a49d92";
      ctx.lineWidth = 1.6 * k;
      ctx.beginPath(); ctx.moveTo(-6 * k, -36 * k); ctx.lineTo(6 * k, -36 * k); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6 * k, -28 * k); ctx.lineTo(3 * k, -28 * k); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6 * k, -20 * k); ctx.lineTo(6 * k, -20 * k); ctx.stroke();
    },

    haystack: function (ctx, k) {
      shadow(ctx, 34, k);
      for (var i = 0; i < 4; i++) {
        roundRect(ctx, -30 * k, -12 * k - i * 11 * k, 60 * k - i * 4 * k, 10 * k, 4 * k,
                  i % 2 ? "#b98b5e" : "#a9805a");
      }
      roundRect(ctx, -34 * k, -58 * k, 68 * k, 8 * k, 3 * k, "#8a6240");
    },
    eave: function (ctx, k) {
      shadow(ctx, 54, k);
      // 屋檐主体压得很低，像贴着院墙的顶
      roundRect(ctx, -54 * k, -26 * k, 108 * k, 8 * k, 2 * k, "#8a6240");
      // 瓦垄：一排半圆瓦
      for (var i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.arc(-48 * k + i * 12 * k, -26 * k, 6 * k, Math.PI, 0);
        ctx.fillStyle = i % 2 ? "#a5553f" : "#b8624a";
        ctx.fill();
      }
      // 瓦当与滴水
      rect(ctx, -54 * k, -20 * k, 108 * k, 3 * k, "#6b4f3a");
      for (var j = 0; j < 9; j++) {
        ctx.beginPath();
        ctx.arc(-48 * k + j * 12 * k, -17 * k, 1.8 * k, 0, Math.PI);
        ctx.fillStyle = "#8a6240";
        ctx.fill();
      }
      // 檐下的阴影
      ctx.globalAlpha = .18;
      roundRect(ctx, -54 * k, -14 * k, 108 * k, 10 * k, 2 * k, "#3b3025");
      ctx.globalAlpha = 1;
    },


    // -------------------------------------------------- 院外 / 楼道
    steps: function (ctx, k) {
      for (var i = 0; i < 3; i++) {
        var w = 84 * k - i * 8 * k;
        roundRect(ctx, -w / 2, -8 * k - i * 8 * k, w, 8 * k, 2 * k, i % 2 ? "#cfc8ba" : "#d9d2c4");
      }
    },
    wall_yard: function (ctx, k) {
      shadow(ctx, 72, k);
      // 墙体
      roundRect(ctx, -70 * k, -62 * k, 140 * k, 62 * k, 2 * k, "#d7cdbb");
      // 砖缝：横缝 + 错缝竖线，靠它才像"墙"而不是一块板
      ctx.strokeStyle = "rgba(150,138,118,.55)";
      ctx.lineWidth = 1 * k;
      var rows = 5;
      for (var r = 0; r < rows; r++) {
        var y = -62 * k + (r + 1) * (62 / rows) * k;
        ctx.beginPath(); ctx.moveTo(-70 * k, y); ctx.lineTo(70 * k, y); ctx.stroke();
        var cols = 8;
        for (var c = 0; c < cols; c++) {
          var x = -70 * k + (c + (r % 2 ? 0.5 : 0)) * (140 / cols) * k;
          if (x > 68 * k) { continue; }
          ctx.beginPath();
          ctx.moveTo(x, y - (62 / rows) * k);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
      }
      // 墙帽与墙脚
      rect(ctx, -72 * k, -66 * k, 144 * k, 5 * k, "#c0b49e");
      rect(ctx, -70 * k, -3 * k, 140 * k, 3 * k, "rgba(120,105,85,.28)");
      // 墙根一点苔痕
      ctx.globalAlpha = .35;
      roundRect(ctx, -66 * k, -8 * k, 42 * k, 6 * k, 3 * k, "#9aa87f");
      ctx.globalAlpha = 1;
    },

    water_vat: function (ctx, k) {
      shadow(ctx, 26, k);
      ctx.beginPath();
      ctx.ellipse(0, -30 * k, 22 * k, 26 * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#9aa3ae";
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, -56 * k, 20 * k, 6 * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#b7bec8";
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, -56 * k, 15 * k, 4 * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#6f8fa0";
      ctx.fill();
    },
    clothesline: function (ctx, k) {
      rect(ctx, -56 * k, -86 * k, 4 * k, 86 * k, "#8a7a63");
      rect(ctx, 52 * k, -86 * k, 4 * k, 86 * k, "#8a7a63");
      ctx.strokeStyle = "#b8b0a2";
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.moveTo(-54 * k, -82 * k);
      ctx.quadraticCurveTo(0, -70 * k, 54 * k, -82 * k);
      ctx.stroke();
      var cloths = ["#dfe7f2", "#f2e2d8", "#dcecdf"];
      for (var i = 0; i < 3; i++) {
        roundRect(ctx, -40 * k + i * 28 * k, -78 * k + Math.abs(i - 1) * 4 * k, 20 * k, 30 * k, 2 * k, cloths[i]);
      }
    },
    e_bike: function (ctx, k) {
      shadow(ctx, 30, k);
      ctx.beginPath();
      ctx.arc(-22 * k, -12 * k, 11 * k, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.screen;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(22 * k, -12 * k, 11 * k, 0, Math.PI * 2);
      ctx.fill();
      roundRect(ctx, -26 * k, -44 * k, 52 * k, 14 * k, 5 * k, "#4a6f9c");
      rect(ctx, -6 * k, -56 * k, 5 * k, 14 * k, PALETTE.metalDark);
      ctx.strokeStyle = PALETTE.metalDark;
      ctx.lineWidth = 3 * k;
      ctx.beginPath();
      ctx.moveTo(18 * k, -44 * k); ctx.lineTo(24 * k, -58 * k);
      ctx.moveTo(18 * k, -44 * k); ctx.lineTo(-20 * k, -44 * k);
      ctx.stroke();
    },
    tree: function (ctx, k) {
      shadow(ctx, 34, k);
      rect(ctx, -5 * k, -60 * k, 10 * k, 60 * k, "#7a6248");
      var blobs = [[-18, -78, 26], [16, -84, 30], [0, -104, 32]];
      for (var i = 0; i < blobs.length; i++) {
        ctx.beginPath();
        ctx.arc(blobs[i][0] * k, blobs[i][1] * k, blobs[i][2] * k, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 ? PALETTE.plantDark : PALETTE.plant;
        ctx.fill();
      }
    },
    manhole: function (ctx, k) {
      ctx.beginPath();
      ctx.ellipse(0, -4 * k, 22 * k, 9 * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#9b968c";
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, -5 * k, 17 * k, 6.5 * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#b3ada2";
      ctx.fill();
    },
    pole: function (ctx, k) {
      rect(ctx, -3 * k, -150 * k, 6 * k, 150 * k, "#a8a29a");
      rect(ctx, -28 * k, -146 * k, 56 * k, 4 * k, "#8f8a83");
      ctx.strokeStyle = "#6b7480";
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.moveTo(-24 * k, -142 * k); ctx.lineTo(-40 * k, -120 * k);
      ctx.moveTo(24 * k, -142 * k); ctx.lineTo(40 * k, -120 * k);
      ctx.stroke();
    }
  };

  // ============================================================ 投影
  // 纵深缩放：远处 0.62、最前排 1.24 —— 只负责"近大远小"。
  // 物件本身的绝对大小交给 ART 这个系数：两个数分开调，才不会一改缩放
  // 就连带把"一间屋子能看见多少家具"也一起改掉。
  function depthScale(y) {
    return 0.62 + 0.62 * (y / WORLD.h);
  }

  var ART = 1.8;      // 物件与人物的整体放大系数（世界坐标不动，只放大画面）
  // 手机上画布窄，全量放大就只剩"人和一台电视"——按画布宽度收一档，
  // 桌面维持原尺寸；0.6 是下限，再小就看不清是什么东西了。
  var HORIZON = 0.20; // 画布上"墙与地的交界"位置比例。投影、墙面、地砖三处共用。

  // 挂墙/靠墙的物件：脚下位置固定在地平线上，且不按 ART 全量放大 ——
  // 否则一扇 96 高的门会顶出画布。它们的高度按墙高单独收一档。
  var WALL_KINDS = {
    window: 1, clock_wall: 1, camera_dome: 1, board_notice: 1, board_village: 1,
    door: 1, radiator: 1
  };
  var WALL_ART = 0.62;
  // 挂墙件的"标称高度"（世界单位）：缩放要收着用，不然一块 136 高的公开栏会顶出画布顶部。
  var WALL_HEIGHT = {
    window: 92, clock_wall: 140, camera_dome: 132,
    board_notice: 108, board_village: 136, door: 96, radiator: 50
  };

  // ============================================================ A* 寻路
  var COLS = Math.ceil(WORLD.w / TILE);
  var ROWS = Math.ceil((WORLD.h - BACKDROP_Y) / TILE);

  function cellCenter(col, row) {
    return { x: col * TILE + TILE / 2, y: BACKDROP_Y + row * TILE + TILE / 2 };
  }

  function buildGrid(spots) {
    var blocked = [];
    for (var r = 0; r < ROWS; r++) {
      blocked.push(new Array(COLS).fill(false));
    }
    (spots || []).forEach(function (s) {
      if (s.passable) { return; }
      // 用物体脚印的外接框挡格子，左右各留一点余量，免得"贴脸穿模"
      var x0 = s.x - PLAYER_R, x1 = s.x + s.w + PLAYER_R;
      var y0 = s.y - PLAYER_R, y1 = s.y + s.h + PLAYER_R;
      for (var r = 0; r < ROWS; r++) {
        var cy = BACKDROP_Y + r * TILE + TILE / 2;
        if (cy < y0 || cy > y1) { continue; }
        for (var c = 0; c < COLS; c++) {
          var cx = c * TILE + TILE / 2;
          if (cx >= x0 && cx <= x1) { blocked[r][c] = true; }
        }
      }
    });
    return blocked;
  }

  function gridPos(x, y) {
    var col = Math.max(0, Math.min(COLS - 1, Math.floor(x / TILE)));
    var row = Math.max(0, Math.min(ROWS - 1, Math.floor((y - BACKDROP_Y) / TILE)));
    return { col: col, row: row };
  }

  function nearestFree(blocked, col, row) {
    if (!blocked[row][col]) { return { col: col, row: row }; }
    for (var r = 1; r < 12; r++) {
      for (var dr = -r; dr <= r; dr++) {
        for (var dc = -r; dc <= r; dc++) {
          if (Math.abs(dr) !== r && Math.abs(dc) !== r) { continue; }
          var rr = row + dr, cc = col + dc;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) { continue; }
          if (!blocked[rr][cc]) { return { col: cc, row: rr }; }
        }
      }
    }
    return null;
  }

  function astar(blocked, from, to) {
    var key = function (c, r) { return c + "," + r; };
    var open = [from];
    var came = {};
    var g = {};
    g[key(from.col, from.row)] = 0;
    var h = function (n) {
      return Math.abs(n.col - to.col) + Math.abs(n.row - to.row);
    };
    var f = {}; f[key(from.col, from.row)] = h(from);
    var seen = {};
    while (open.length) {
      // 小规模网格直接线性取最小 f，够用且没有额外依赖
      var bi = 0;
      for (var i = 1; i < open.length; i++) {
        if (f[key(open[i].col, open[i].row)] < f[key(open[bi].col, open[bi].row)]) { bi = i; }
      }
      var cur = open.splice(bi, 1)[0];
      var ck = key(cur.col, cur.row);
      if (cur.col === to.col && cur.row === to.row) {
        var path = [cur];
        var k2 = ck;
        while (came[k2]) { path.unshift(came[k2]); k2 = key(came[k2].col, came[k2].row); }
        return path;
      }
      seen[ck] = true;
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (var d = 0; d < dirs.length; d++) {
        var nc = cur.col + dirs[d][0], nr = cur.row + dirs[d][1];
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) { continue; }
        if (blocked[nr][nc]) { continue; }
        // 斜走不许切角：两个正交点都得通
        if (dirs[d][0] && dirs[d][1]) {
          if (blocked[cur.row][nc] || blocked[nr][cur.col]) { continue; }
        }
        var nk = key(nc, nr);
        var ng = g[ck] + (dirs[d][0] && dirs[d][1] ? 1.414 : 1);
        if (g[nk] === undefined || ng < g[nk]) {
          came[nk] = cur;
          g[nk] = ng;
          f[nk] = ng + h({ col: nc, row: nr });
          if (!seen[nk] && !open.some(function (o) { return o.col === nc && o.row === nr; })) {
            open.push({ col: nc, row: nr });
          }
        }
      }
    }
    return null;
  }

  // ============================================================ 场景
  function Scene(canvas, data) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.data = data || { spots: [], setting: "room" };
    this.spots = (this.data.spots || []).slice();
    this.chars = (this.data.characters || []).slice();
    this.chars.forEach(function (c) { c._char = true; });   // 拾取时靠它区分"人"和"物件"
    this.blocked = buildGrid(this.spots);
    this.player = { x: this.data.spawn ? this.data.spawn.x : 300, y: this.data.spawn ? this.data.spawn.y : 700 };
    this.path = null;
    this.facing = 1;
    this.walkPhase = 0;
    this.cam = { x: this.player.x, y: this.player.y };
    this.hover = null;
    this.onSpot = null;          // (spot) => void，由外部接管
    this.pending = null;         // 走到位后要触发的 spot
    this.time = 0;
    this.dpr = 1;
    this._bindInput();
    this.resize();
    // 容器宽度会随右侧卡片加载、滚动条出现而变，只在 window.resize 里重算会漏
    // ——漏了就会出现"画布只铺了半个舞台，右边一条空白"。用 ResizeObserver 盯住它。
    var self = this;
    if (global.ResizeObserver) {
      var box = canvas.parentElement || canvas;
      this._ro = new global.ResizeObserver(function () { self.resize(); });
      this._ro.observe(box);
    }
  }

  Scene.prototype.resize = function () {
    var box = this.canvas.parentElement || this.canvas;
    var cssW = Math.max(320, box.clientWidth);
    // 桌面 3:2；手机竖屏给高一点（画面更大，不然人只有指甲盖大）
    var ratio = cssW < 520 ? 0.86 : 2 / 3;
    var cssH = Math.round(cssW * ratio);
    if (this.w === cssW && this.h === cssH && this.canvas.width) {
      return;                     // 尺寸没变就不重画，避免 ResizeObserver 自激
    }
    this.dpr = Math.min(2, global.devicePixelRatio || 1);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = cssW + "px";
    this.canvas.style.height = cssH + "px";
    this.w = cssW;
    this.h = cssH;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  // 纵向不做滚动：地平线固定在画布 10% 处、世界最前排固定在 98% 处，
  // 这样一眼能看全整间屋子；横向跟人平移。少一个自由度，移动端才不会"跑出画面"。
  Scene.prototype._clampCam = function (x) {
    var halfNear = (this.w / 2) / depthScale(WORLD.h);
    var halfFar = (this.w / 2) / depthScale(BACKDROP_Y);
    var lo = Math.min(halfNear, halfFar) + 20;
    return Math.max(lo, Math.min(WORLD.w - lo, x));
  };

  Scene.prototype.artScale = function () {
    return ART * Math.min(1, Math.max(0.6, this.w / 900));
  };

  Scene.prototype.depthRatio = function () {
    return (this.h * (0.96 - HORIZON)) / (WORLD.h - BACKDROP_Y);
  };

  Scene.prototype.project = function (x, y) {
    var k = depthScale(y);
    return {
      sx: this.w / 2 + (x - this.cam.x) * k,
      sy: this.h * HORIZON + (y - BACKDROP_Y) * this.depthRatio(),
      k: k
    };
  };

  Scene.prototype.unproject = function (sx, sy) {
    var y = BACKDROP_Y + (sy - this.h * HORIZON) / this.depthRatio();
    var k = depthScale(y);
    var x = this.cam.x + (sx - this.w / 2) / k;
    return { x: x, y: y };
  };

  Scene.prototype._bindInput = function () {
    var self = this;
    var down = null;
    var drag = null;

    this.canvas.addEventListener("pointerdown", function (ev) {
      if (ev.button !== undefined && ev.button !== 0) { return; }
      down = { x: ev.clientX, y: ev.clientY, t: Date.now() };
      drag = { x: ev.clientX, cam: self.cam.x, moved: false };
      self.canvas.setPointerCapture && self.canvas.setPointerCapture(ev.pointerId);
    });

    this.canvas.addEventListener("pointerup", function (ev) {
      var wasDrag = !!(drag && drag.moved);
      drag = null;
      if (!down) { return; }
      var moved = Math.abs(ev.clientX - down.x) + Math.abs(ev.clientY - down.y);
      var dt = Date.now() - down.t;
      down = null;
      if (wasDrag || moved > 12 || dt > 900) { return; }   // 拖动/长按不算点击
      var r = self.canvas.getBoundingClientRect();
      self.tap(ev.clientX - r.left, ev.clientY - r.top);
    });

    var lastMove = 0;
    this.canvas.addEventListener("pointerdown", function (ev) {
      self.canvas.style.cursor = "grabbing";
    });
    this.canvas.addEventListener("pointerup", function () {
      self.canvas.style.cursor = "default";
    });

    this.canvas.addEventListener("pointermove", function (ev) {
      // 按住拖动 = 平移镜头。手机画布窄，不拖根本看不全一间屋子。
      if (drag) {
        var dx = ev.clientX - drag.x;
        if (Math.abs(dx) > 6) {
          drag.moved = true;
          self._freeCam = true;
          var k = depthScale((BACKDROP_Y + WORLD.h) / 2);
          self.cam.x = self._clampCam(drag.cam - dx / k);
          self.canvas.style.cursor = "grabbing";
        }
        return;
      }
      var now = Date.now();
      if (now - lastMove < 60) { return; }     // 拾取要遍历+排序，60ms 一次足够
      lastMove = now;
      var r = self.canvas.getBoundingClientRect();
      var p = self.unproject(ev.clientX - r.left, ev.clientY - r.top);
      var hit = self.pick(p.x, p.y);
      self.hover = hit ? hit.id : null;
      self.canvas.style.cursor = hit ? "pointer" : "default";
    });

    global.addEventListener("resize", function () {
      self.resize();
    });
  };

  Scene.prototype.pick = function (x, y) {
    // 人物是小目标，先让人——不然站在沙发前的人永远点不到
    for (var j = 0; j < this.chars.length; j++) {
      var c = this.chars[j];
      if (Math.abs(x - c.x) <= 20 && y >= c.y - 60 && y <= c.y + 10) { return c; }
    }
    // 从后往前找：后画的（更靠前的）优先命中
    var list = this.spots.slice().sort(function (a, b) { return b.y - a.y; });
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (x >= s.x && x <= s.x + s.w && y >= s.y - 10 && y <= s.y + s.h + 18) { return s; }
    }
    return null;
  };

  Scene.prototype.tap = function (sx, sy) {
    var p = this.unproject(sx, sy);
    var spot = this.pick(p.x, p.y);
    if (spot && spot._char) {
      // 选中一个人：走近，然后交给上层打开谈话
      if (Math.hypot(this.player.x - spot.x, this.player.y - spot.y) <= INTERACT_RANGE) {
        if (this.onPerson) { this.onPerson(spot); }
        return;
      }
      this.walkTo(spot.x, spot.y + 34, null);
      this._pendingPerson = spot;
      return;
    }
    if (spot) {
      var cx = spot.x + spot.w / 2, cy = spot.y + spot.h / 2;
      if (Math.hypot(this.player.x - cx, this.player.y - cy) <= INTERACT_RANGE) {
        this.pending = null;
        if (this.onSpot) { this.onSpot(spot); }
        return;
      }
      this.walkTo(cx, cy + spot.h * 0.5 + 26, spot);
      return;
    }
    if (p.y < BACKDROP_Y + 8) {                  // 点到了墙面/地平线以上
      if (this.onBlocked) { this.onBlocked("那边是墙，走不过去"); }
      return;
    }
    if (!this.walkTo(p.x, p.y, null) && this.onBlocked) {
      this.onBlocked("过不去，换个地方试试");
    }
  };

  Scene.prototype.walkTo = function (x, y, thenSpot) {
    // 返回是否找到了路：找不到时调用方要提示，不然玩家会以为"点了没反应"
    var from = this.player;
    var start = nearestFree(this.blocked, gridPos(from.x, from.y).col, gridPos(from.x, from.y).row);
    var goal = nearestFree(this.blocked, gridPos(x, Math.max(BACKDROP_Y + TILE, y)).col,
                          gridPos(x, Math.max(BACKDROP_Y + TILE, y)).row);
    if (!start || !goal) { return false; }
    var cells = astar(this.blocked, start, goal);
    if (!cells || !cells.length) { return false; }
    this.path = cells.map(function (c) { return cellCenter(c.col, c.row); });
    this.pending = thenSpot || null;
    return true;
  };

  Scene.prototype.update = function (dt) {
    this.time += dt;
    var p = this.player;

    if (this.path && this.path.length) {
      var target = this.path[0];
      var dx = target.x - p.x, dy = target.y - p.y;
      var dist = Math.hypot(dx, dy);
      if (dist < 2) {
        this.path.shift();
        if (!this.path.length) {
          this.path = null;
          if (this._pendingPerson) {
            var pc = this._pendingPerson;
            this._pendingPerson = null;
            if (this.onPerson) { this.onPerson(pc); }
            return;
          }
          if (this.pending && this.onSpot) {
            var s = this.pending;
            this.pending = null;
            this.onSpot(s);
          }
        }
      } else {
        var step = Math.min(dist, PLAYER_SPEED * dt);
        p.x += dx / dist * step;
        p.y += dy / dist * step;
        if (Math.abs(dx) > 0.5) { this.facing = dx > 0 ? 1 : -1; }
        this.walkPhase += dt * 9;
      }
    } else {
      this.walkPhase = 0;
    }

    if (this.path) { this._freeCam = false; }   // 一走动就恢复跟随
    if (!this._freeCam && Math.abs(p.x - this.cam.x) > 40) {
      this.cam.x += (p.x - this.cam.x) * Math.min(1, dt * 4);
    }
    this.cam.x = this._clampCam(this.cam.x);
    this.cam.y = (BACKDROP_Y + WORLD.h) / 2;             // 纵向固定，不滚动
  };

  // ------------------------------------------------------------ 绘制
  Scene.prototype.render = function () {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawShell(ctx);
    this.drawFloor(ctx);

    // 画家算法：先画远的（y 小的），人插在中间
    // 排序键 = 脚底 y + 显式层级。屋檐这类"必须压在墙上面"的物件靠 layer 调，
    // 光靠 y 排会出现"瓦檐被墙挡住一半"。
    var items = this.spots.map(function (s) {
      return { y: s.y + s.h + (s.layer || 0), kind: "spot", s: s };
    });
    this.chars.forEach(function (c) { items.push({ y: c.y, kind: "char", c: c }); });
    items.push({ y: this.player.y, kind: "player" });
    items.sort(function (a, b) { return a.y - b.y; });

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.kind === "player") { this.drawPlayer(ctx); }
      else if (it.kind === "char") { this.drawCharacter(ctx, it.c); }
      else { this.drawSpot(ctx, it.s); }
    }
    this.drawExitHint(ctx);
  };

  Scene.prototype.drawShell = function (ctx) {
    var key = this.h + "|wall";
    if (!this._wallGrad || this._wallKey !== key) {
      var g = ctx.createLinearGradient(0, 0, 0, this.h * 0.5);
      g.addColorStop(0, PALETTE.wallFar);
      g.addColorStop(1, PALETTE.wallNear);
      this._wallGrad = g;
      this._wallKey = key;
    }
    ctx.fillStyle = this._wallGrad;
    ctx.fillRect(0, 0, this.w, this.h);
    // 墙裙：给"室内"一点纵向层次
    if (this.data.setting === "room") {
      var horizon = this.h * HORIZON;
      var wallBottom = this.h * 0.10 + (BACKDROP_Y - this.cam.y) * DEPTH * (this.h / 600) + 40;
      ctx.fillStyle = "rgba(255,255,255,.45)";
      ctx.fillRect(0, horizon, this.w, Math.max(0, wallBottom - horizon));
      ctx.fillStyle = "rgba(120,110,96,.10)";
      ctx.fillRect(0, wallBottom - 6, this.w, 6);
    }
  };

  Scene.prototype.drawFloor = function (ctx) {
    var self = this;
    var horizon = this.h * HORIZON;
    var topLeft = this.project(0, BACKDROP_Y);
    var topRight = this.project(WORLD.w, BACKDROP_Y);
    var bottomLeft = this.project(0, WORLD.h);
    var bottomRight = this.project(WORLD.w, WORLD.h);

    ctx.beginPath();
    ctx.moveTo(topLeft.sx, topLeft.sy);
    ctx.lineTo(topRight.sx, topRight.sy);
    ctx.lineTo(bottomRight.sx, bottomRight.sy);
    ctx.lineTo(bottomLeft.sx, bottomLeft.sy);
    ctx.closePath();
    var ground = this.data.ground || "";
    var fkey = Math.round(topLeft.sy) + "|" + Math.round(bottomLeft.sy) + "|" + ground;
    if (!this._floorGrad || this._floorKey !== fkey) {
      var g = ctx.createLinearGradient(0, topLeft.sy, 0, bottomLeft.sy);
      var pair = GROUND_COLORS[ground] || GROUND_COLORS.concrete;
      g.addColorStop(0, pair[0]);
      g.addColorStop(1, pair[1]);
      this._floorGrad = g;
      this._floorKey = fkey;
    }
    ctx.fillStyle = this._floorGrad;
    ctx.fill();

    // 地面纹理：不同场地差别很大，靠它一眼认出"这是什么地方"
    ctx.save();
    ctx.clip();
    if (ground === "court") {
      this._courtLines(ctx);
    } else if (ground === "grass") {
      ctx.strokeStyle = "rgba(120,150,120,.18)";
      ctx.lineWidth = 1;
      for (var gx0 = -40; gx0 < WORLD.w + 40; gx0 += 46) {
        var a0 = self.project(gx0, BACKDROP_Y), b0 = self.project(gx0 + 20, WORLD.h);
        ctx.beginPath(); ctx.moveTo(a0.sx, a0.sy); ctx.lineTo(b0.sx, b0.sy); ctx.stroke();
      }
    }
    ctx.strokeStyle = PALETTE.floorLine;
    ctx.lineWidth = 1;
    for (var gy = BACKDROP_Y + 60; gy < WORLD.h; gy += 60) {
      var a = self.project(0, gy), b = self.project(WORLD.w, gy);
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }
    for (var gx = 0; gx <= WORLD.w; gx += 120) {
      var c = self.project(gx, BACKDROP_Y), d = self.project(gx, WORLD.h);
      ctx.globalAlpha = 0.22;
      ctx.beginPath(); ctx.moveTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // 地平线：与寻路边界同一个 BACKDROP_Y，画出来就是为了让人看见"只能走到这"
    var hl = this.project(0, BACKDROP_Y), hr = this.project(WORLD.w, BACKDROP_Y);
    ctx.strokeStyle = "rgba(90,80,66,.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hl.sx, hl.sy);
    ctx.lineTo(hr.sx, hr.sy);
    ctx.stroke();
  };

  // 半场白线：边线 + 罚球圈 + 底线。尺寸取自真实半场比例，缩到世界里刚好认得出。
  Scene.prototype._courtLines = function (ctx) {
    var self = this;
    ctx.strokeStyle = "rgba(255,255,255,.72)";
    ctx.lineWidth = 2.4;
    function line(x1, y1, x2, y2) {
      var a = self.project(x1, y1), b = self.project(x2, y2);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }
    line(120, 180, 1280, 180);          // 底线
    line(120, 180, 120, 760);           // 左边线
    line(1280, 180, 1280, 760);         // 右边线
    line(120, 480, 1280, 480);          // 中线
    // 罚球圈
    var cx = 600, cy = 480;
    ctx.beginPath();
    for (var i = 0; i <= 36; i++) {
      var ang = Math.PI * 2 * i / 36;
      var p = self.project(cx + Math.cos(ang) * 110, cy + Math.sin(ang) * 52);
      if (i === 0) { ctx.moveTo(p.sx, p.sy); } else { ctx.lineTo(p.sx, p.sy); }
    }
    ctx.closePath();
    ctx.stroke();
  };

  Scene.prototype.drawSpot = function (ctx, s) {
    var wall = WALL_KINDS[s.kind];
    var p = wall
      ? this.project(s.x + s.w / 2, BACKDROP_Y)
      : this.project(s.x + s.w / 2, s.y + s.h);
    var fn = SPOT_KINDS[s.kind];
    if (!fn) {
      // 认不出的 kind 必须**当场看得见**：画一个红色问号框，
      // 而不是静默回落成默认物件（那种 bug 页面不报错、断言全绿，场景里少一件东西）。
      ctx.strokeStyle = "#d92d20";
      ctx.lineWidth = 2;
      ctx.strokeRect(p.sx - 16, p.sy - 40, 32, 40);
      ctx.fillStyle = "#d92d20";
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("?", p.sx, p.sy - 16);
      return;
    }
    var scale = this.artScale();
    if (wall) {
      scale *= WALL_ART;
      // 墙高是硬约束：墙只有 HORIZON 那么高，物件再高就会被画布切掉一截
      var room = this.h * HORIZON - 10;
      var cap = room / (WALL_HEIGHT[s.kind] || 100);
      if (scale > cap) { scale = cap; }
    }
    ctx.save();
    ctx.translate(p.sx, p.sy);
    fn(ctx, p.k * scale);
    ctx.restore();

    if (this.hover === s.id || this.nearSpot === s.id) {
      var top = p.sy - 78 * p.k * this.artScale();
      ctx.fillStyle = "rgba(29,78,216,.92)";
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      var label = s.label || s.kind;
      var tw = ctx.measureText(label).width + 16;
      roundRect(ctx, p.sx - tw / 2, top - 20, tw, 19, 6, "rgba(29,78,216,.92)");
      ctx.fillStyle = "#fff";
      ctx.fillText(label, p.sx, top - 6);
    }
  };

  // 站位人物：固定位置、只有待机微动（呼吸感的上下浮），不走路。
  Scene.prototype.drawCharacter = function (ctx, ch) {
    var p = this.project(ch.x, ch.y);
    var k = p.k * this.artScale();
    var sit = ch.pose === "sit";
    var breathe = Math.sin(this.time * 1.4 + (ch.x + ch.y) * 0.01) * 0.8 * k;
    ctx.save();
    ctx.translate(p.sx, p.sy + (sit ? 6 * k : 0));
    ctx.scale(ch.facing === -1 ? -1 : 1, 1);

    // 影子
    ctx.beginPath();
    ctx.ellipse(0, 0, 13 * k, 4.5 * k, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(50,40,30,.18)";
    ctx.fill();

    var bodyTop = sit ? -30 : -40;
    var headY = sit ? -37 : -47;

    // 腿
    ctx.strokeStyle = ch.pants || "#3c4652";
    ctx.lineWidth = 5 * k;
    ctx.lineCap = "round";
    ctx.beginPath();
    if (sit) {
      ctx.moveTo(-3 * k, -14 * k); ctx.lineTo(-6 * k, -4 * k);
      ctx.moveTo(3 * k, -14 * k); ctx.lineTo(9 * k, -6 * k);
    } else {
      ctx.moveTo(-3 * k, -16 * k); ctx.lineTo(-3 * k, -1 * k);
      ctx.moveTo(3 * k, -16 * k); ctx.lineTo(3 * k, -1 * k);
    }
    ctx.stroke();

    // 身体
    roundRect(ctx, -9 * k, (bodyTop - 10) * k + breathe, 18 * k, 26 * k, 5 * k, ch.color || "#7c8a99");
    if (ch.vest) {
      roundRect(ctx, -8 * k, (bodyTop - 4) * k + breathe, 16 * k, 18 * k, 3 * k, ch.vest);
    }

    // 头与头发
    ctx.beginPath();
    ctx.arc(0, headY * k + breathe, 8 * k, 0, Math.PI * 2);
    ctx.fillStyle = "#e8c9a8";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, headY * k - 3 * k + breathe, 8 * k, Math.PI, 0);
    ctx.fillStyle = ch.hair || "#2b3138";
    ctx.fill();
    if (ch.bun) {
      ctx.beginPath();
      ctx.arc(-6 * k, headY * k - 6 * k + breathe, 3 * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 名牌：悬停或走近时显示
    if (this.hover === ch.id || this.nearChar === ch.id) {
      var top = p.sy - (headY - 20) * k;
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      var label = ch.label || "";
      var tw = ctx.measureText(label).width + 16;
      roundRect(ctx, p.sx - tw / 2, top - 19, tw, 19, 6, "rgba(29,78,216,.92)");
      ctx.fillStyle = "#fff";
      ctx.fillText(label, p.sx, top - 5);
    }
  };

  Scene.prototype.drawPlayer = function (ctx) {
    var p = this.project(this.player.x, this.player.y);
    var k = p.k * this.artScale();
    var bob = this.path ? Math.sin(this.walkPhase) * 1.6 * k : 0;
    ctx.save();
    ctx.translate(p.sx, p.sy + bob);

    // 影子
    ctx.beginPath();
    ctx.ellipse(0, 0, 13 * k, 5 * k, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(50,40,30,.20)";
    ctx.fill();

    // 腿
    var swing = this.path ? Math.sin(this.walkPhase) * 5 * k : 0;
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 5 * k;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-3 * k, -16 * k);
    ctx.lineTo(-3 * k + swing, -1 * k);
    ctx.moveTo(3 * k, -16 * k);
    ctx.lineTo(3 * k - swing, -1 * k);
    ctx.stroke();

    // 身体（制服色，但不带任何真实警务标识）
    roundRect(ctx, -9 * k, -40 * k, 18 * k, 26 * k, 5 * k, "#2f4a6d");
    rect(ctx, -9 * k, -26 * k, 18 * k, 3 * k, "#22374f");

    // 头
    ctx.beginPath();
    ctx.arc(0, -47 * k, 8 * k, 0, Math.PI * 2);
    ctx.fillStyle = "#e8c9a8";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -50 * k, 8 * k, Math.PI, 0);
    ctx.fillStyle = "#2b3138";
    ctx.fill();

    ctx.restore();
  };

  Scene.prototype.drawExitHint = function (ctx) {
    if (this.path) { return; }
    var near = null;
    for (var i = 0; i < this.spots.length; i++) {
      var s = this.spots[i];
      var cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      if (Math.hypot(this.player.x - cx, this.player.y - cy) <= INTERACT_RANGE) { near = s; break; }
    }
    if (!near) { return; }
    var p = this.project(near.x + near.w / 2, near.y + near.h);
    ctx.fillStyle = "rgba(29,78,216,.10)";
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("点它 · " + (near.label || ""), p.sx, p.sy + 16);
  };

  Scene.prototype.setSpots = function (spots) {
    this.spots = (spots || []).slice();
    this.chars = (this.data.characters || []).slice();
    this.chars.forEach(function (c) { c._char = true; });   // 拾取时靠它区分"人"和"物件"
    this.blocked = buildGrid(this.spots);
  };

  // ============================================================ 导出
  global.MediationScene = {
    BACKDROP_Y: BACKDROP_Y,
    WORLD: WORLD,
    TILE: TILE,
    SPOT_KINDS: SPOT_KINDS,
    depthScale: depthScale,
    buildGrid: buildGrid,
    astar: astar,
    Scene: Scene
  };
})(window);
