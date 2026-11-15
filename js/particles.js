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
  var currentId = 'water';
  var density = 1;
  var paused = false;
  var printing = false;
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

  /* 部分特效在深色下使用叠加发光，浅色下改用柔和配色 */
  function isDark() {
    var root = document.documentElement;
    return !!(root && root.getAttribute && root.getAttribute('data-theme') === 'dark');
  }

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

    petals: {
      meta: { id: 'petals', name: '风吹花瓣', desc: '远近花瓣随风飘落与翻转，划动改变风向，点击扬起花瓣，文字搭配樱粉与夜樱配色' },
      init: function (w, h, rnd) {
        if (!global.ResumePetals) return EFFECTS.waves.init(w, h, rnd);
        return global.ResumePetals.create(ctx, w, h, density, document.documentElement.getAttribute('data-theme') === 'dark', rnd);
      }
    },

    clouds: {
      meta:{id:'clouds',name:'云海晨雾',desc:'晨光、远山和三层云絮缓慢流动，鼠标拨雾，滚动产生远近视差'},
      init:function(w,h,rnd){
        if(!global.ResumeClouds)return EFFECTS.waves.init(w,h,rnd);
        return global.ResumeClouds.create(ctx,w,h,density,document.documentElement.getAttribute('data-theme')==='dark',rnd);
      }
    },

    ink: {
      meta: { id:'ink',name:'水墨晕染',desc:'宣纸与淡墨缓慢洇开，点击落墨、滑动留下柔和墨痕，文字同步切换墨青配色' },
      init:function(w,h,rnd){
        if(!global.ResumeInk)return EFFECTS.waves.init(w,h,rnd);
        return global.ResumeInk.create(ctx,w,h,density,document.documentElement.getAttribute('data-theme')==='dark',rnd);
      }
    },

    /* 星光漫游：保留原星空选项，另加有星云、星芒和交互拖尾的背景。 */
    starlight: {
      meta: { id: 'starlight', name: '星光漫游', desc: '星云与星芒缓慢闪烁，划过留下星尘，点击绽放星光，偶尔有流星经过' },
      init: function (w, h, rnd) {
        var dark = document.documentElement.getAttribute('data-theme') === 'dark';
        var stars = [], sparks = [], meteors = [];
        var elapsed = 0, lastTrail = -1, nextMeteor = 2 + rnd() * 3;
        var offset = { x: 0, y: 0 }, scroll = 0, targetScroll = 0;
        var palette = dark ? ['185,209,255','222,194,255','255,226,174'] : ['73,94,169','124,84,161','151,108,40'];
        var n = count(170, w, h, 65, 280);
        for (var i=0;i<n;i++) stars.push({
          x:rnd()*w, y:rnd()*h, r:.5+rnd()*1.35,
          phase:rnd()*Math.PI*2, speed:.6+rnd()*1.2,
          depth:.25+rnd()*.75, color:palette[i%3], bright:i%13===0
        });
        function halo(x,y,r,color,alpha) {
          var g=ctx.createRadialGradient(x,y,0,x,y,r);
          g.addColorStop(0,'rgba('+color+','+alpha+')');
          g.addColorStop(1,'rgba('+color+',0)');
          return g;
        }
        var clouds = [
          halo(w*.15,h*.25,Math.max(w,h)*.65,dark?'86,55,162':'172,176,233',dark?.28:.22),
          halo(w*.85,h*.75,Math.max(w,h)*.55,dark?'38,92,139':'150,196,234',dark?.21:.23)
        ];
        function star(x,y,r,color,alpha,cross) {
          ctx.fillStyle='rgba('+color+','+alpha+')';
          ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
          if (!cross) return;
          ctx.fillStyle=halo(x,y,r*7,color,alpha*.35);
          ctx.fillRect(x-r*7,y-r*7,r*14,r*14);
          ctx.strokeStyle='rgba('+color+','+alpha*.8+')'; ctx.lineWidth=.8;
          ctx.beginPath(); ctx.moveTo(x-r*3.5,y); ctx.lineTo(x+r*3.5,y);
          ctx.moveTo(x,y-r*4.5); ctx.lineTo(x,y+r*4.5); ctx.stroke();
        }
        function disturb(x,y,force) {
          if (!isFinite(x) || !isFinite(y) || (!force && elapsed-lastTrail<.05)) return;
          lastTrail=elapsed;
          for (var k=0;k<(force?10:1);k++) {
            var angle=rnd()*Math.PI*2;
            sparks.push({x:x,y:y,vx:Math.cos(angle)*(force?38:12),vy:Math.sin(angle)*(force?38:12)-8,life:1,color:palette[k%3]});
          }
          if (sparks.length>32) sparks.splice(0,sparks.length-32);
        }
        return {
          disturb:disturb,
          scroll:function(y){targetScroll=y*.025;},
          frame:function(dt){
            elapsed+=dt;
            offset.x+=((mouse.active?(mouse.x-w/2)*.018:0)-offset.x)*Math.min(1,dt*3);
            offset.y+=((mouse.active?(mouse.y-h/2)*.018:0)-offset.y)*Math.min(1,dt*3);
            scroll+=(targetScroll-scroll)*Math.min(1,dt*3);
            ctx.fillStyle=dark?'#0b1024':'#f2f2fc'; ctx.fillRect(0,0,w,h);
            clouds.forEach(function(g){ctx.fillStyle=g;ctx.fillRect(0,0,w,h);});
            stars.forEach(function(s){
              var twinkle=.58+.42*Math.sin(s.phase+elapsed*s.speed);
              var y=((s.y+offset.y*s.depth-scroll*s.depth)%h+h)%h;
              star(s.x+offset.x*s.depth,y,s.r,s.color,(dark?.35:.24)+twinkle*(dark?.58:.35),s.bright);
            });
            for(var j=sparks.length-1;j>=0;j--){
              var p=sparks[j]; p.life-=dt*.85;
              if(p.life<=0){sparks.splice(j,1);continue;}
              p.x+=p.vx*dt;p.y+=p.vy*dt;
              star(p.x,p.y,.7+p.life,p.color,p.life*.85,true);
            }
            if(elapsed>nextMeteor){
              meteors.push({x:w*(.25+rnd()*.7),y:h*(.05+rnd()*.3),life:1});
              if(meteors.length>2) meteors.shift();
              nextMeteor=elapsed+4+rnd()*5;
            }
            for(var m=meteors.length-1;m>=0;m--){
              var meteor=meteors[m];meteor.life-=dt*.55;
              if(meteor.life<=0){meteors.splice(m,1);continue;}
              meteor.x-=dt*210;meteor.y+=dt*115;
              var tail=ctx.createLinearGradient(meteor.x,meteor.y,meteor.x+95,meteor.y-52);
              tail.addColorStop(0,'rgba('+palette[0]+','+meteor.life*.8+')');
              tail.addColorStop(1,'rgba('+palette[0]+',0)');
              ctx.strokeStyle=tail;ctx.lineWidth=1.5;
              ctx.beginPath();ctx.moveTo(meteor.x,meteor.y);ctx.lineTo(meteor.x+95,meteor.y-52);ctx.stroke();
              star(meteor.x,meteor.y,1.3,palette[0],meteor.life,false);
            }
          }
        };
      }
    },

    water: {
      meta: { id: 'water', name: '流动水面', desc: '水光缓慢流动，鼠标划过或手指滑动泛起涟漪，滚动带来轻微视差' },
      init: function (w, h, rnd) {
        if (!global.ResumeWater) return EFFECTS.waves.init(w, h, rnd);
        return global.ResumeWater.create(ctx, w, h, density,
          document.documentElement.getAttribute('data-theme') === 'dark');
      }
    },

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

    /* ------------------------------------------------------ 极光流彩
       几团大面积柔光色块缓慢漂移、交融，类似系统壁纸的流体渐变；
       鼠标会把最亮的一团轻轻牵过去，点击让色块短暂膨胀。 */
    aurora: {
      meta: { id: 'aurora', name: '极光流彩', desc: '大块柔光渐变缓慢流动交融，鼠标牵引光团，点击光晕膨胀' },
      init: function (w, h, rnd) {
        var dark = isDark();
        var palette = dark
          ? ['10,132,255', '191,90,242', '255,55,95', '48,209,88', '100,210,255', '255,159,10']
          : ['90,200,250', '175,130,255', '255,140,180', '120,230,190', '255,200,120', '120,160,255'];
        var n = Math.round(clamp(5 * density, 3, 8));
        var big = Math.max(w, h);
        var blobs = [];
        for (var i = 0; i < n; i++) {
          blobs.push({
            cx: rnd(), cy: rnd(),
            ax: 0.18 + rnd() * 0.22, ay: 0.14 + rnd() * 0.2,
            sx: 0.05 + rnd() * 0.08, sy: 0.04 + rnd() * 0.07,
            px: rnd() * 6.28, py: rnd() * 6.28,
            r: big * (0.32 + rnd() * 0.26),
            color: palette[i % palette.length]
          });
        }
        var t = rnd() * 100, pulse = 0, lead = { x: w * 0.5, y: h * 0.4 };
        var alpha = dark ? 0.42 : 0.5;
        return {
          disturb: function (x, y, force) { if (force) pulse = 1; },
          frame: function (dt) {
            t += dt;
            pulse = Math.max(0, pulse - dt * 0.8);
            clear(w, h);
            ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
            for (var i = 0; i < blobs.length; i++) {
              var b = blobs[i];
              var x = (b.cx + Math.sin(t * b.sx + b.px) * b.ax) * w;
              var y = (b.cy + Math.cos(t * b.sy + b.py) * b.ay) * h;
              if (i === 0) {
                var tx = mouse.active ? mouse.x : x, ty = mouse.active ? mouse.y : y;
                lead.x += (tx - lead.x) * Math.min(1, dt * 0.9);
                lead.y += (ty - lead.y) * Math.min(1, dt * 0.9);
                x = lead.x; y = lead.y;
              }
              var r = b.r * (1 + pulse * 0.25);
              var g = ctx.createRadialGradient(x, y, 0, x, y, r);
              g.addColorStop(0, 'rgba(' + b.color + ',' + alpha + ')');
              g.addColorStop(0.55, 'rgba(' + b.color + ',' + (alpha * 0.35) + ')');
              g.addColorStop(1, 'rgba(' + b.color + ',0)');
              ctx.fillStyle = g;
              ctx.fillRect(0, 0, w, h);
            }
            ctx.globalCompositeOperation = 'source-over';
          }
        };
      }
    },

    /* ------------------------------------------------------ 霓虹网格
       复古未来风：条纹落日 + 向观众滚动的透视网格。
       鼠标左右移动改变消失点，滚动页面让网格加速。 */
    synthwave: {
      meta: { id: 'synthwave', name: '霓虹网格', desc: '条纹落日与透视霓虹网格向你驶来，鼠标转向，滚动加速' },
      init: function (w, h, rnd) {
        var dark = isDark();
        var horizon = h * 0.7;            /* 压低地平线，避开首屏的姓名和联系方式 */
        var sunR = Math.min(w, h) * 0.14;
        var grid = dark ? '255,60,200' : '214,51,132';
        var glow = dark ? '0,229,255' : '0,150,199';
        var a = dark ? 0.75 : 0.45;
        var offset = 0, boost = 0, vx = w / 2, lastScroll = null;
        var stars = [];
        var ns = dark ? count(70, w, h, 30, 140) : 0;
        for (var i = 0; i < ns; i++) stars.push({ x: rnd() * w, y: rnd() * horizon * 0.9, r: 0.4 + rnd() * 1.1, p: rnd() * 6.28 });

        function lineAlpha(y) { return clamp((y - horizon) / (h - horizon), 0, 1); }

        return {
          scroll: function (y) {
            if (lastScroll !== null) boost = Math.min(4, boost + Math.abs(y - lastScroll) * 0.02);
            lastScroll = y;
          },
          disturb: function (x, y, force) { if (force) boost = Math.min(4, boost + 1.5); },
          frame: function (dt) {
            boost = Math.max(0, boost - dt * 1.6);
            offset += dt * (0.55 + boost);
            var target = mouse.active ? w / 2 + (mouse.x - w / 2) * 0.35 : w / 2;
            vx += (target - vx) * Math.min(1, dt * 2);
            clear(w, h);

            for (var s = 0; s < stars.length; s++) {
              var st = stars[s];
              st.p += dt * 1.5;
              ctx.fillStyle = 'rgba(255,255,255,' + (0.25 + 0.25 * Math.sin(st.p)) + ')';
              ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.283); ctx.fill();
            }

            /* 落日：竖向渐变圆，下半部用 clearRect 切出越来越宽的条纹 */
            var sx = vx, sy = horizon - sunR * 0.35;
            var sg = ctx.createLinearGradient(0, sy - sunR, 0, sy + sunR);
            sg.addColorStop(0, dark ? 'rgba(255,214,102,0.7)' : 'rgba(255,190,90,0.45)');
            sg.addColorStop(1, dark ? 'rgba(255,61,139,0.75)' : 'rgba(255,90,150,0.4)');
            ctx.fillStyle = sg;
            ctx.beginPath(); ctx.arc(sx, sy, sunR, 0, 6.283); ctx.fill();
            for (var k = 0; k < 6; k++) {
              var band = sy + sunR * (0.12 + k * 0.15);
              ctx.clearRect(sx - sunR - 2, band, sunR * 2 + 4, 1.5 + k * 1.3);
            }
            ctx.clearRect(0, horizon, w, h - horizon);

            /* 地平线辉光 */
            var hg = ctx.createLinearGradient(0, horizon - 30, 0, horizon + 6);
            hg.addColorStop(0, 'rgba(' + glow + ',0)');
            hg.addColorStop(1, 'rgba(' + glow + ',' + (a * 0.5) + ')');
            ctx.fillStyle = hg;
            ctx.fillRect(0, horizon - 30, w, 36);

            /* 纵线：从消失点放射到底边，越靠近地平线越淡 */
            var vg = ctx.createLinearGradient(0, horizon, 0, h);
            vg.addColorStop(0, 'rgba(' + grid + ',0)');
            vg.addColorStop(1, 'rgba(' + grid + ',' + a + ')');
            ctx.strokeStyle = vg;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            var spread = w * 0.16;
            for (var j = -14; j <= 14; j++) {
              ctx.moveTo(vx + j * spread * 0.03, horizon);
              ctx.lineTo(vx + j * spread * 1.6, h + 40);
            }
            ctx.stroke();

            /* 横线：按透视间距排布，整体随 offset 向观众移动 */
            var frac = offset % 1;
            for (var d = 0; d < 22; d++) {
              var z = d + 1 - frac;
              var y = horizon + (h - horizon) * (1 / (z * 0.42 + 0.58));
              if (y > h + 2) continue;
              var la = lineAlpha(y);
              ctx.strokeStyle = 'rgba(' + grid + ',' + (a * la) + ')';
              ctx.lineWidth = 0.6 + la * 1.4;
              ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
            }
          }
        };
      }
    },

    /* ------------------------------------------------------ 星际穿梭
       曲速飞行：星点从消失点向四周拉成光线；鼠标偏转航向，点击跃迁加速。 */
    hyperspace: {
      meta: { id: 'hyperspace', name: '星际穿梭', desc: '星光从中心拉成光线扑面而来，鼠标转向，点击跃迁加速' },
      init: function (w, h, rnd) {
        var n = count(240, w, h, 100, 480);
        var depth = Math.max(w, h);
        var stars = [];
        function spawn(s, far) {
          s.x = (rnd() * 2 - 1) * depth;
          s.y = (rnd() * 2 - 1) * depth;
          s.z = far ? depth : rnd() * depth + 1;
          s.pz = s.z;
          return s;
        }
        for (var i = 0; i < n; i++) stars.push(spawn({}, false));
        var cx = w / 2, cy = h / 2, warp = 0;
        var f = Math.min(w, h) * 0.5;
        return {
          disturb: function (x, y, force) { if (force) warp = 1; },
          frame: function (dt) {
            warp = Math.max(0, warp - dt * 0.6);
            var tx = mouse.active ? w / 2 - (mouse.x - w / 2) * 0.3 : w / 2;
            var ty = mouse.active ? h / 2 - (mouse.y - h / 2) * 0.3 : h / 2;
            cx += (tx - cx) * Math.min(1, dt * 1.5);
            cy += (ty - cy) * Math.min(1, dt * 1.5);
            var speed = depth * (0.22 + warp * 1.6) * dt;
            clear(w, h);
            ctx.lineCap = 'round';
            for (var i = 0; i < stars.length; i++) {
              var s = stars[i];
              s.pz = s.z;
              s.z -= speed;
              if (s.z < 1) { spawn(s, true); continue; }
              var x = cx + s.x / s.z * f, y = cy + s.y / s.z * f;
              var tz = s.z + speed * 6;          /* 拖尾按多帧长度画，静止截图也能看出速度感 */
              var px = cx + s.x / tz * f, py = cy + s.y / tz * f;
              if (x < -50 || x > w + 50 || y < -50 || y > h + 50) { spawn(s, true); continue; }
              var near = 1 - s.z / depth;
              ctx.strokeStyle = withAlpha(colors.dot, clamp(near * 1.3, 0.08, 0.95));
              ctx.lineWidth = 0.6 + near * 2.6;
              ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
            }
            ctx.lineCap = 'butt';
          }
        };
      }
    },

    /* ------------------------------------------------------ 烟花绽放
       每隔一两秒自动升起一枚，点击空白处在指定位置放一枚。 */
    fireworks: {
      meta: { id: 'fireworks', name: '烟花绽放', desc: '烟花升空后绚烂炸开、拖尾下坠，点击任意空白处亲手放一枚' },
      init: function (w, h, rnd) {
        var dark = isDark();
        var rockets = [], sparks = [];
        var cap = Math.round(clamp(700 * density, 250, 1400));
        var next = 0.4;
        function launch(x, y) {
          var sx = x === undefined ? w * (0.15 + rnd() * 0.7) : x;
          var ty = y === undefined ? h * (0.12 + rnd() * 0.35) : y;
          rockets.push({ x: sx + (rnd() - 0.5) * 60, y: h + 10, tx: sx, ty: ty, hue: Math.floor(rnd() * 360) });
        }
        function explode(r) {
          var m = Math.round(clamp(70 * density, 40, 120));
          var hue2 = (r.hue + 40 + rnd() * 60) % 360;
          for (var i = 0; i < m && sparks.length < cap; i++) {
            var ang = (i / m) * 6.283 + rnd() * 0.2;
            var sp = 160 + rnd() * 200;
            sparks.push({
              x: r.x, y: r.y, px: r.x, py: r.y,
              vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
              life: 1, decay: 0.45 + rnd() * 0.45,
              hue: rnd() < 0.7 ? r.hue : hue2
            });
          }
        }
        var light = dark ? 62 : 52;
        return {
          disturb: function (x, y, force) { if (force && rockets.length < 6) launch(x, y); },
          frame: function (dt) {
            next -= dt;
            if (next <= 0) { launch(); next = 0.9 + rnd() * 1.4; }
            clear(w, h);
            ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
            ctx.lineCap = 'round';

            for (var i = rockets.length - 1; i >= 0; i--) {
              var r = rockets[i];
              var oy = r.y, ox = r.x;
              r.y -= dt * (h * 0.9);
              r.x += (r.tx - r.x) * Math.min(1, dt * 2);
              ctx.strokeStyle = 'hsla(' + r.hue + ',100%,' + light + '%,0.9)';
              ctx.lineWidth = 2;
              ctx.beginPath(); ctx.moveTo(ox, oy + 14); ctx.lineTo(r.x, r.y); ctx.stroke();
              if (r.y <= r.ty) { explode(r); rockets.splice(i, 1); }
            }

            var drag = Math.pow(0.3, dt);
            for (var j = sparks.length - 1; j >= 0; j--) {
              var s = sparks[j];
              s.px = s.x; s.py = s.y;
              s.vx *= drag; s.vy = s.vy * drag + 140 * dt;
              s.x += s.vx * dt; s.y += s.vy * dt;
              s.life -= s.decay * dt;
              if (s.life <= 0) { sparks.splice(j, 1); continue; }
              ctx.strokeStyle = 'hsla(' + s.hue + ',100%,' + light + '%,' + clamp(s.life, 0, 1) + ')';
              ctx.lineWidth = 1 + s.life * 1.6;
              ctx.beginPath(); ctx.moveTo(s.px - s.vx * 0.03, s.py - s.vy * 0.03); ctx.lineTo(s.x, s.y); ctx.stroke();
            }
            ctx.lineCap = 'butt';
            ctx.globalCompositeOperation = 'source-over';
          }
        };
      }
    },

    /* ------------------------------------------------------ 萤火微光
       暖色光点忽明忽暗地游走，靠近鼠标时被吸引，点击会把它们惊散。 */
    fireflies: {
      meta: { id: 'fireflies', name: '萤火微光', desc: '暖色光点忽明忽暗地游走，靠近鼠标会被吸引，点击惊散' },
      init: function (w, h, rnd) {
        var dark = isDark();
        var color = dark ? '255,224,102' : '230,150,20';
        var n = count(55, w, h, 22, 110);
        var flies = [];
        for (var i = 0; i < n; i++) {
          flies.push({
            x: rnd() * w, y: rnd() * h,
            ang: rnd() * 6.283, sp: 14 + rnd() * 22,
            r: 1.4 + rnd() * 1.8,
            ph: rnd() * 6.283, rate: 0.6 + rnd() * 1.4,
            kx: 0, ky: 0
          });
        }
        return {
          disturb: function (x, y, force) {
            if (!force) return;
            for (var i = 0; i < flies.length; i++) {
              var f = flies[i], dx = f.x - x, dy = f.y - y, d = Math.sqrt(dx * dx + dy * dy) || 1;
              if (d < 260) { f.kx += dx / d * 260 * (1 - d / 260); f.ky += dy / d * 260 * (1 - d / 260); }
            }
          },
          frame: function (dt) {
            clear(w, h);
            ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
            for (var i = 0; i < flies.length; i++) {
              var f = flies[i];
              f.ang += (rnd() - 0.5) * 2.4 * dt;
              var vx = Math.cos(f.ang) * f.sp, vy = Math.sin(f.ang) * f.sp;
              if (mouse.active) {
                var dx = mouse.x - f.x, dy = mouse.y - f.y, d2 = dx * dx + dy * dy;
                if (d2 < 48000 && d2 > 900) { var d = Math.sqrt(d2); vx += dx / d * 26; vy += dy / d * 26; }
              }
              f.kx *= Math.pow(0.05, dt); f.ky *= Math.pow(0.05, dt);
              f.x += (vx + f.kx) * dt; f.y += (vy + f.ky) * dt;
              if (f.x < -20) f.x = w + 20; else if (f.x > w + 20) f.x = -20;
              if (f.y < -20) f.y = h + 20; else if (f.y > h + 20) f.y = -20;
              f.ph += f.rate * dt;
              var glowA = Math.max(0, Math.sin(f.ph)) * (dark ? 0.9 : 0.7) + 0.08;
              var R = f.r * 9;
              var g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, R);
              g.addColorStop(0, 'rgba(' + color + ',' + glowA + ')');
              g.addColorStop(0.18, 'rgba(' + color + ',' + (glowA * 0.45) + ')');
              g.addColorStop(1, 'rgba(' + color + ',0)');
              ctx.fillStyle = g;
              ctx.beginPath(); ctx.arc(f.x, f.y, R, 0, 6.283); ctx.fill();
            }
            ctx.globalCompositeOperation = 'source-over';
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
  var EFFECT_LIST = ['water', 'starlight', 'ink', 'clouds', 'petals', 'aurora', 'synthwave', 'hyperspace', 'fireworks', 'fireflies', 'network', 'bubbles', 'starfield', 'waves', 'comets', 'off'].map(function (id) {
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
    document.documentElement.setAttribute('data-background', currentId);
    var eff = EFFECTS[currentId] || EFFECTS.water;
    var rnd = makeRnd((Math.round(W) * 73856093) ^ (Math.round(H) * 19349663));
    current = eff.init(W, H, rnd);
    if (current.scroll) current.scroll(global.scrollY || 0);
    current.frame(0, W, H);   /* 立即绘制；减少动态效果时保留这一帧 */
  }

  /* 大面积渐变类特效约 30 帧即可流畅，省一半绘制 */
  var THROTTLED = { water: 1, starlight: 1, ink: 1, clouds: 1, petals: 1, aurora: 1, synthwave: 1 };

  var lastTs = 0;
  function loop(ts) {
    rafId = null;
    if (paused || printing || reduceMotion || currentId === 'off' || !current) return;
    rafId = global.requestAnimationFrame(loop);
    if (THROTTLED[currentId] && lastTs && ts - lastTs < 32) return;
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60;  /* 夹住，避免切回标签页时跳帧 */
    lastTs = ts;
    if (!reduceMotion) current.frame(dt, W, H);
  }

  function start() {
    if (!rafId && !paused && !printing && !reduceMotion && currentId !== 'off') {
      lastTs = 0;
      rafId = global.requestAnimationFrame(loop);
    }
  }

  function stop() {
    if (rafId) global.cancelAnimationFrame(rafId);
    rafId = null;
  }

  function setEffect(id) {
    if (!EFFECTS[id]) return false;
    currentId = id;
    canvas.style.display = (id === 'off') ? 'none' : '';
    build();
    if (id === 'off') stop(); else start();
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

  function interact(e, force) {
    if (reduceMotion || paused || printing) return;
    if (e.target && e.target.closest && e.target.closest('.drawer, .fab-wrap, button, input, textarea, select, a')) return;
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
    if (current && current.disturb) current.disturb(e.clientX, e.clientY, force);
  }
  global.addEventListener('pointermove', function (e) { interact(e, false); }, { passive: true });
  global.addEventListener('pointerdown', function (e) { interact(e, true); }, { passive: true });
  global.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches[0]) {
      var touch = e.touches[0];
      interact({ clientX: touch.clientX, clientY: touch.clientY, target: e.target }, false);
    }
  }, { passive: true });
  global.addEventListener('scroll', function () {
    if (!reduceMotion && current && current.scroll) current.scroll(global.scrollY || 0);
  }, { passive: true });

  global.addEventListener('pointerleave', function () { mouse.active = false; }, { passive: true });

  /* 标签页不可见时停掉绘制，省电 */
  document.addEventListener('visibilitychange', function () {
    paused = document.hidden;
    if (paused) stop(); else start();
  });

  if (global.matchMedia) {
    var motionQuery = global.matchMedia('(prefers-reduced-motion: reduce)');
    var motionChanged = function (e) {
      reduceMotion = e.matches;
      if (reduceMotion) { stop(); build(); } else start();
    };
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', motionChanged);
    else if (motionQuery.addListener) motionQuery.addListener(motionChanged);
  }

  /* 主题切换后重新取色并重建（部分特效的颜色在 init 时就固化了） */
  if (global.MutationObserver) {
    new MutationObserver(function () {
      colors = themeColors();
      build();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* 打印时隐藏背景，别把粒子印进 PDF */
  global.addEventListener('beforeprint', function () {
    printing = true;
    stop();
    canvas.style.display = 'none';
  });
  global.addEventListener('afterprint', function () {
    paused = document.hidden;
    printing = false;
    canvas.style.display = (currentId === 'off') ? 'none' : '';
    resize();
    start();
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
    stop: stop
  };
})(typeof window !== 'undefined' ? window : globalThis);
