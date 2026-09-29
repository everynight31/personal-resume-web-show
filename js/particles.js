/* =============================================================================
 *  particles.js —— 背景特效（自绘 Canvas，零外部依赖）
 * -----------------------------------------------------------------------------
 *  设计：一张全屏 canvas + 一组「特效策略」。每个特效只需要实现
 *      { meta, init(w, h, rnd), frame(ctx, w, h, dt) }
 *  公共的尺寸/DPR/主题取色/事件/暂停逻辑都由外层统一处理，加新特效只要往
 *  EFFECTS 里再写一个对象即可，不用碰其它代码。
 *
 *  对外接口：
 *    ResumeParticles.EFFECTS           特效元数据列表（供设置页渲染选项）
 *    ResumeParticles.setEffect(id)     切换特效
 *    ResumeParticles.setDensity(n)     调整粒子密度（0.4 ~ 2）
 *    ResumeParticles.redraw()          尺寸或配色变化后重建（主题切换、窗口缩放）
 * ========================================================================== */
(function (global) {
  'use strict';

  var canvas = document.getElementById('particle-canvas');
  if (!canvas) return;

  var ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) { canvas.style.display = 'none'; return; }

  var reduceMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var DPR = Math.min(global.devicePixelRatio || 1, 2);
  var W = 0, H = 0;
  var colors = { line: 'rgba(0,113,227,.22)', dot: 'rgba(0,113,227,.55)' };
  var mouse = { x: -9999, y: -9999, active: false };
  var current = null;          /* 当前特效实例 */
  var currentId = 'network';
  var density = 1;
  var paused = false;
  var rafId = null;

  /* ------------------------------------------------------------ 工具函数 */

  /* 主题色从 CSS 变量读，浅色/深色自动适配 */
  function themeColors() {
    var cs = global.getComputedStyle ? getComputedStyle(document.documentElement) : null;
    if (!cs) return colors;
    return {
      dot: (cs.getPropertyValue('--particle-dot') || colors.dot).trim() || colors.dot,
      line: (cs.getPropertyValue('--particle-line') || colors.line).trim() || colors.line
    };
  }

  /* 把 rgba(...) 里的 alpha 换掉，方便同一颜色做深浅层次 */
  function withAlpha(str, alpha) {
    var m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(String(str));
    if (!m) return 'rgba(0,113,227,' + alpha + ')';
    return 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',' + alpha + ')';
  }

  /* 带固定种子的伪随机：保证「同样的窗口尺寸得到同样的布局」，resize 后画面稳定 */
  function makeRnd(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function areaScale(w, h) { return Math.sqrt((w * h) / (1440 * 900)); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  /* 基础粒子数量：跟着可视面积缩放，再乘密度系数，最后夹在合理区间 */
  function count(base, w, h, lo, hi) {
    return Math.round(clamp(base * areaScale(w, h) * density, lo, hi));
  }

  /* 画布已按 DPR 缩放，这里给的是 CSS 像素坐标 */
  function clear(w, h) { ctx.clearRect(0, 0, w, h); }

  /* 鼠标附近的排斥力，默认特效用来做视差 */
  function repel(p, radius, strength) {
    if (!mouse.active) return;
    var dx = p.x - mouse.x, dy = p.y - mouse.y;
    var d2 = dx * dx + dy * dy;
    if (d2 > radius * radius || d2 < 1) return;
    var d = Math.sqrt(d2);
    var f = (1 - d / radius) * strength;
    p.x += (dx / d) * f;
    p.y += (dy / d) * f;
  }

  /* ================================================================ 特效库 */

  var EFFECTS = {

    /* ---------------------------------------------- 1. 粒子连线（默认款） */
    network: {
      meta: { id: 'network', name: '粒子连线', desc: '漂浮的光点自动连成网，鼠标能推开它们' },
      init: function (w, h, rnd) {
        var n = count(58, w, h, 22, 110);
        var ps = [];
        for (var i = 0; i < n; i++) {
          ps.push({
            x: rnd() * w, y: rnd() * h,
            vx: (rnd() - 0.5) * 0.22, vy: (rnd() - 0.5) * 0.22,
            r: 1 + rnd() * 1.8, a: 0.35 + rnd() * 0.45
          });
        }
        return {
          linkDist: clamp(Math.min(w, h) * 0.16, 96, 170),
          ps: ps,
          frame: function (dt) {
            var k = dt * 60;                    /* 以 60fps 为基准归一化 */
            for (var i = 0; i < ps.length; i++) {
              var p = ps[i];
              p.x += p.vx * k;
              p.y += p.vy * k;
              repel(p, 130, 0.9);
              if (p.x < -20) p.x = w + 20;
              if (p.x > w + 20) p.x = -20;
              if (p.y < -20) p.y = h + 20;
              if (p.y > h + 20) p.y = -20;
            }
            clear(w, h);
            var ld = this.linkDist;
            for (var a = 0; a < ps.length; a++) {
              var pa = ps[a];
              for (var b = a + 1; b < ps.length; b++) {
                var pb = ps[b];
                var dx = pa.x - pb.x, dy = pa.y - pb.y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist >= ld) continue;
                ctx.strokeStyle = withAlpha(colors.line, (1 - dist / ld) * 0.9);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(pa.x, pa.y);
                ctx.lineTo(pb.x, pb.y);
                ctx.stroke();
              }
            }
            for (var c = 0; c < ps.length; c++) {
              var q = ps[c];
              ctx.fillStyle = withAlpha(colors.dot, q.a * 0.75);
              ctx.beginPath();
              ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        };
      }
    },

    /* ------------------------------------------------------ 2. 气泡上浮 */
    bubbles: {
      meta: { id: 'bubbles', name: '气泡上浮', desc: '大小不一的空心气泡缓缓上升，鼠标附近会加速' },
      init: function (w, h, rnd) {
        var n = count(30, w, h, 12, 58);
        var bs = [];
        function spawn(initial) {
          var r = 4 + rnd() * 16;
          return {
            x: rnd() * w,
            y: initial ? rnd() * h : h + r + 10,
            r: r,
            vy: -(0.16 + rnd() * 0.42) * (1 - r / 30),
            sway: 0.4 + rnd() * 1.3,
            phase: rnd() * Math.PI * 2,
            a: 0.16 + rnd() * 0.3
          };
        }
        for (var i = 0; i < n; i++) bs.push(spawn(true));

        return {
          bs: bs,
          frame: function (dt) {
            var k = dt * 60;
            clear(w, h);
            for (var i = 0; i < bs.length; i++) {
              var b = bs[i];
              b.phase += 0.012 * k;
              b.y += b.vy * k;
              b.x += Math.sin(b.phase) * b.sway * 0.35 * k;

              /* 鼠标附近的气泡被「吹」得快一点，制造一点交互感 */
              if (mouse.active) {
                var dx = b.x - mouse.x, dy = b.y - mouse.y;
                if (dx * dx + dy * dy < 22000) b.y -= 0.5 * k;
              }
              if (b.y + b.r < -10) {
                bs[i] = spawn(false);
                continue;
              }

              ctx.strokeStyle = withAlpha(colors.dot, b.a);
              ctx.lineWidth = 1.2;
              ctx.beginPath();
              ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
              ctx.stroke();

              /* 左上角一点高光，让气泡有体积感 */
              ctx.fillStyle = withAlpha(colors.dot, b.a * 0.5);
              ctx.beginPath();
              ctx.arc(b.x - b.r * 0.34, b.y - b.r * 0.34, Math.max(0.8, b.r * 0.16), 0, Math.PI * 2);
              ctx.fill();
            }
          }
        };
      }
    },

    /* ------------------------------------------------------ 3. 星空闪烁 */
    starfield: {
      meta: { id: 'starfield', name: '星空闪烁', desc: '深浅不一的星点在呼吸式明灭，偶尔划过一颗流星' },
      init: function (w, h, rnd) {
        var n = count(140, w, h, 45, 240);
        var stars = [];
        for (var i = 0; i < n; i++) {
          stars.push({
            x: rnd() * w, y: rnd() * h,
            r: 0.5 + rnd() * 1.7,
            base: 0.15 + rnd() * 0.5,
            speed: 0.5 + rnd() * 1.8,
            phase: rnd() * Math.PI * 2
          });
        }
        var meteor = null;
        var nextIn = 2.5 + rnd() * 3;
        var t = 0;

        return {
          stars: stars,
          frame: function (dt) {
            t += dt;
            clear(w, h);

            for (var i = 0; i < stars.length; i++) {
              var s = stars[i];
              s.phase += 0.02 * s.speed * dt * 60;
              var tw = 0.62 + 0.38 * Math.sin(s.phase);
              ctx.fillStyle = withAlpha(colors.dot, s.base * tw);
              ctx.beginPath();
              ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
              ctx.fill();
            }

            /* 流星：每隔几秒来一颗 */
            if (!meteor && t > nextIn) {
              meteor = {
                x: rnd() * w * 0.7 + w * 0.2,
                y: -20,
                vx: -(2.6 + rnd() * 2.4),
                vy: 3.4 + rnd() * 2.2,
                life: 1
              };
              t = 0;
              nextIn = 3.5 + rnd() * 5;
            }
            if (meteor) {
              var m = meteor;
              m.x += m.vx * dt * 60;
              m.y += m.vy * dt * 60;
              m.life -= dt * 0.34;

              var tail = 78;
              var g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * tail * 0.5, m.y - m.vy * tail * 0.5);
              g.addColorStop(0, withAlpha(colors.dot, clamp(m.life, 0, 1) * 0.85));
              g.addColorStop(1, withAlpha(colors.dot, 0));
              ctx.strokeStyle = g;
              ctx.lineWidth = 1.8;
              ctx.beginPath();
              ctx.moveTo(m.x, m.y);
              ctx.lineTo(m.x - m.vx * tail * 0.5, m.y - m.vy * tail * 0.5);
              ctx.stroke();

              if (m.life <= 0 || m.y > h + 60 || m.x < -60) meteor = null;
            }
          }
        };
      }
    },

    /* ------------------------------------------------------ 4. 声波流动 */
    waves: {
      meta: { id: 'waves', name: '声波流动', desc: '多条正弦曲线横向流动，随鼠标起伏' },
      init: function (w, h, rnd) {
        var lines = [];
        var n = Math.round(clamp(4 * density, 2, 6));
        for (var i = 0; i < n; i++) {
          lines.push({
            amp: (h * 0.045) * (0.6 + rnd() * 0.9),
            wave: (Math.PI * 2) / (w * (0.5 + rnd() * 0.7)),
            speed: 0.18 + rnd() * 0.3,
            phase: rnd() * Math.PI * 2,
            y: h * (0.18 + 0.62 * (i / Math.max(1, n - 1))),
            a: 0.16 + rnd() * 0.18,
            width: 1 + rnd() * 0.9
          });
        }
        return {
          lines: lines,
          frame: function (dt) {
            clear(w, h);
            for (var i = 0; i < lines.length; i++) {
              var L = lines[i];
              L.phase += L.speed * dt;

              /* 鼠标位置把附近的波峰抬高一点 */
              var lift = 0;
              if (mouse.active) {
                var d = Math.abs(mouse.y - L.y);
                lift = clamp(1 - d / (h * 0.22), 0, 1) * 16;
              }

              ctx.strokeStyle = withAlpha(colors.line, L.a + lift / 90);
              ctx.lineWidth = L.width;
              ctx.beginPath();
              var step = Math.max(6, w / 110);
              for (var x = -step; x <= w + step; x += step) {
                var y = L.y + Math.sin(x * L.wave + L.phase) * (L.amp + lift);
                if (x <= -step) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.stroke();
            }
          }
        };
      }
    },

    /* ------------------------------------------------------ 5. 流星拖尾 */
    comets: {
      meta: { id: 'comets', name: '流星拖尾', desc: '几道流光缓慢划过，留下渐隐的长尾' },
      init: function (w, h, rnd) {
        var n = Math.round(clamp(6 * density, 3, 12));
        var cs = [];
        function respawn(c, initial) {
          var fromLeft = rnd() > 0.45;
          var speed = 0.5 + rnd() * 1.5;
          var ang = (rnd() - 0.5) * 0.7;
          c.x = initial ? rnd() * w : (fromLeft ? -60 : w + 60);
          c.y = initial ? rnd() * h : rnd() * h;
          c.vx = (fromLeft ? 1 : -1) * speed * Math.cos(ang);
          c.vy = speed * Math.sin(ang) * 0.6;
          c.len = 70 + rnd() * 150;
          c.r = 0.8 + rnd() * 1.6;
          c.a = 0.3 + rnd() * 0.4;
          return c;
        }
        for (var i = 0; i < n; i++) cs.push(respawn({}, true));

        return {
          cs: cs,
          frame: function (dt) {
            var k = dt * 60;
            clear(w, h);
            for (var i = 0; i < cs.length; i++) {
              var c = cs[i];
              c.x += c.vx * k;
              c.y += c.vy * k;

              if (c.x < -140 || c.x > w + 140 || c.y < -140 || c.y > h + 140) {
                respawn(c, false);
                continue;
              }

              var tx = c.x - c.vx * c.len;
              var ty = c.y - c.vy * c.len;
              var g = ctx.createLinearGradient(c.x, c.y, tx, ty);
              g.addColorStop(0, withAlpha(colors.dot, c.a));
              g.addColorStop(0.45, withAlpha(colors.line, c.a * 0.6));
              g.addColorStop(1, withAlpha(colors.line, 0));
              ctx.strokeStyle = g;
              ctx.lineWidth = c.r;
              ctx.lineCap = 'round';
              ctx.beginPath();
              ctx.moveTo(c.x, c.y);
              ctx.lineTo(tx, ty);
              ctx.stroke();

              ctx.fillStyle = withAlpha(colors.dot, c.a + 0.25);
              ctx.beginPath();
              ctx.arc(c.x, c.y, c.r * 1.15, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        };
      }
    },

    /* ---------------------------------------------------------- 6. 关闭 */
    off: {
      meta: { id: 'off', name: '关闭（纯色背景）', desc: '不绘制任何背景，页面最轻量' },
      init: function (w, h) {
        return { frame: function () { clear(w, h); } };
      }
    }
  };

  /* 元数据列表，顺序即设置页里的显示顺序 */
  var EFFECT_LIST = ['network', 'bubbles', 'starfield', 'waves', 'comets', 'off'].map(function (id) {
    return EFFECTS[id].meta;
  });

  /* ============================================================ 生命周期 */

  function resize() {
    W = canvas.clientWidth || global.innerWidth;
    H = canvas.clientHeight || global.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
  }

  function build() {
    var eff = EFFECTS[currentId] || EFFECTS.network;
    var rnd = makeRnd((Math.round(W) * 73856093) ^ (Math.round(H) * 19349663));
    current = eff.init(W, H, rnd);
    if (reduceMotion && current) current.frame(1 / 60, W, H);   /* 静态画一帧 */
  }

  var lastTs = 0;
  function loop(ts) {
    rafId = global.requestAnimationFrame(loop);
    if (paused || !current) { lastTs = ts; return; }
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60;  /* 夹住，避免切回标签页时跳帧 */
    lastTs = ts;
    if (!reduceMotion) current.frame(dt, W, H);
  }

  function start() {
    if (!rafId) rafId = global.requestAnimationFrame(loop);
  }

  function setEffect(id) {
    if (!EFFECTS[id]) return false;
    currentId = id;
    canvas.style.display = (id === 'off') ? 'none' : '';
    build();
    return true;
  }

  function setDensity(n) {
    density = clamp(Number(n) || 1, 0.4, 2);
    build();
  }

  /* ============================================================ 事件绑定 */

  var resizeTimer = null;
  global.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 160);
  }, { passive: true });

  global.addEventListener('pointermove', function (e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  }, { passive: true });

  global.addEventListener('pointerleave', function () { mouse.active = false; }, { passive: true });

  /* 标签页不可见时停掉绘制，省电 */
  document.addEventListener('visibilitychange', function () {
    paused = document.hidden;
    if (!paused && current) current.frame(1 / 60, W, H);
  });

  /* 主题切换后重新取色并重建（部分特效的颜色在 init 时就固化了） */
  if (global.MutationObserver) {
    new MutationObserver(function () {
      colors = themeColors();
      build();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* 打印时隐藏背景，别把粒子印进 PDF */
  global.addEventListener('beforeprint', function () {
    paused = true;
    canvas.style.display = 'none';
  });
  global.addEventListener('afterprint', function () {
    paused = document.hidden;
    canvas.style.display = (currentId === 'off') ? 'none' : '';
    resize();
  });

  /* ================================================================ 启动 */

  colors = themeColors();
  resize();
  if (!reduceMotion) start();

  global.ResumeParticles = {
    EFFECTS: EFFECT_LIST,
    setEffect: setEffect,
    getEffect: function () { return currentId; },
    setDensity: setDensity,
    getDensity: function () { return density; },
    redraw: function () { colors = themeColors(); resize(); },
    stop: function () { if (rafId) global.cancelAnimationFrame(rafId); rafId = null; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
