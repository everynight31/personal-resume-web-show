/* 风吹花瓣：三种缓存花瓣、远近翻转和可衰减的阵风，零外部依赖。 */
(function (global) {
  'use strict';

  function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }

  function create(ctx, w, h, density, dark, rnd) {
    var time = 0, gust = 0, lastScroll = null;
    var pointer = { x: w / 2, y: h / 2, time: -10 };
    var sky = ctx.createLinearGradient(0, 0, w * .6, h);
    sky.addColorStop(0, dark ? '#211b30' : '#fff5f1');
    sky.addColorStop(.55, dark ? '#302033' : '#f9e9ed');
    sky.addColorStop(1, dark ? '#1d2534' : '#f3eee4');
    var glow = ctx.createRadialGradient(w * .8, h * .12, 0, w * .8, h * .12, Math.max(w, h) * .7);
    glow.addColorStop(0, dark ? 'rgba(220,151,181,.13)' : 'rgba(255,253,229,.8)');
    glow.addColorStop(1, 'rgba(255,237,223,0)');

    var palettes = dark
      ? [['#ffe2ea', '#d578a4'], ['#f7d9f2', '#ae7cb4'], ['#ffe7d2', '#cf9b95']]
      : [['#fff1f4', '#d77a9c'], ['#ffe1e9', '#ba5e88'], ['#fff3df', '#d69a85']];
    var sprites = [];
    for (var i = 0; i < palettes.length; i++) {
      var image = document.createElement('canvas');
      image.width = 64; image.height = 80;
      var brush = image.getContext('2d');
      if (!brush) continue;
      var color = brush.createLinearGradient(12, 8, 48, 70);
      color.addColorStop(0, palettes[i][0]);
      color.addColorStop(1, palettes[i][1]);
      brush.fillStyle = color;
      /* 顶端的凹口与收尖的瓣根使它呈花瓣形，翻转时露出细窄侧面。 */
      brush.beginPath(); brush.moveTo(32, 18);
      brush.bezierCurveTo(17, -2, 1, 17, 11, 39);
      brush.bezierCurveTo(17, 54, 29, 65, 34, 74);
      brush.bezierCurveTo(40, 58, 58, 40, 56, 22);
      brush.bezierCurveTo(54, 7, 40, 3, 32, 18);
      brush.closePath(); brush.fill();
      brush.strokeStyle = dark ? 'rgba(255,238,247,.4)' : 'rgba(255,255,255,.7)';
      brush.lineWidth = 1.2;
      brush.beginPath(); brush.moveTo(34, 68);
      brush.bezierCurveTo(27, 51, 38, 35, 32, 22); brush.stroke();
      sprites.push(image);
    }
    function background() {
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    }
    if (!sprites.length) return { frame: background };

    var strength = clamp(Number(density) || 1, .4, 2);
    var total = Math.round(clamp(55 * Math.sqrt(w * h / (1440 * 900)) * strength, 18, 100));
    var petals = [];
    function spawn(initial, index) {
      var depth = .3 + (index % 3) * .35;
      return {
        x: rnd() * (w + 80) - 40, y: initial ? rnd() * h : -40,
        size: (8 + rnd() * 8) * (.55 + depth * .8),
        speed: 12 + depth * 21 + rnd() * 12, depth: depth,
        phase: rnd() * Math.PI * 2, rotation: rnd() * Math.PI * 2,
        spin: (rnd() - .5) * 1.4, flutter: .7 + rnd() * 1.2,
        vx: 0, vy: 0, alpha: .32 + depth * .5, sprite: index % sprites.length
      };
    }
    for (var p = 0; p < total; p++) petals.push(spawn(true, p));

    function disturb(x, y, force) {
      if (!isFinite(x) || !isFinite(y) || (!force && time - pointer.time < 1 / 30)) return;
      var dx = time - pointer.time < .3 ? x - pointer.x : (x - w / 2) * .04;
      gust = clamp(gust + dx * .8 + (force ? (x < w / 2 ? 32 : -32) : 0), -100, 100);
      pointer.x = x; pointer.y = y; pointer.time = time;
      if (!force) return;
      petals.forEach(function (petal) {
        var px = petal.x - x, py = petal.y - y;
        var distance = Math.sqrt(px * px + py * py);
        if (distance >= 220) return;
        var push = (1 - distance / 220) * 65;
        petal.vx = clamp(petal.vx + px / Math.max(1, distance) * push, -100, 100);
        petal.vy = clamp(petal.vy - push * .7, -65, 0);
      });
    }

    return {
      disturb: disturb,
      scroll: function (y) {
        if (!isFinite(y)) return;
        if (lastScroll !== null) gust = clamp(gust + clamp(y - lastScroll, -120, 120) * .15, -100, 100);
        lastScroll = y;
      },
      frame: function (dt) {
        dt = clamp(Number(dt) || 0, 0, .05);
        time += dt; gust *= Math.exp(-dt * 1.3);
        background();
        var wind = 18 + Math.sin(time * .42) * 12 + Math.sin(time * .17) * 9 + gust;
        for (var j = 0; j < petals.length; j++) {
          var petal = petals[j];
          petal.x += (wind * petal.depth + Math.sin(time * petal.flutter + petal.phase) * 15 + petal.vx) * dt;
          petal.y += (petal.speed + Math.cos(time * .8 + petal.phase) * 6 + petal.vy) * dt;
          petal.vx *= Math.exp(-dt * 2); petal.vy *= Math.exp(-dt * 2);
          if (petal.y > h + 40) { petals[j] = spawn(false, j); petal = petals[j]; }
          if (petal.x > w + 40) petal.x = -40;
          if (petal.x < -40) petal.x = w + 40;
          var turn = Math.cos(time * petal.flutter + petal.phase);
          var fold = (turn < 0 ? -1 : 1) * Math.max(.14, Math.abs(turn));
          ctx.save();
          ctx.translate(petal.x, petal.y);
          ctx.rotate(petal.rotation + time * petal.spin + Math.sin(time + petal.phase) * .35);
          ctx.scale(fold, 1);
          ctx.globalAlpha = petal.alpha * (.75 + Math.abs(turn) * .25);
          ctx.drawImage(sprites[petal.sprite], -petal.size / 2, -petal.size * .625, petal.size, petal.size * 1.25);
          ctx.restore();
        }
      }
    };
  }
  global.ResumePetals = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
