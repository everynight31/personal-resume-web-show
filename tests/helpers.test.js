/* 纯函数工具测试：node tests/helpers.test.js
   覆盖：新建模块的版式推荐、data URL 体积估算、数组交换、头像取景几何，
   以及占位头像 SVG 的构图约束（它以前在圆形头像框里偏下、肩膀被切）。 */
'use strict';

const fs = require('fs');
const path = require('path');
const H = require(path.resolve(__dirname, '../js/helpers.js'));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; return true; }
  fail++;
  failures.push(label + (extra ? '  →  ' + extra : ''));
  return false;
}

console.log('\n══════ 工具函数 ══════');

/* ---------------------------------------------------------- 版式推荐 */
console.log('\n-- 新建模块的版式推荐 --');
{
  const cases = [
    ['荣誉奖项', 'list'],
    ['发表论文', 'cards'],
    ['校园经历', 'list'],
    ['专业技能', 'tags'],
    ['教育背景', 'timeline'],
    ['实习经历', 'cards'],
    ['项目经历', 'cards'],
    ['奖学金', 'list'],
    ['自我评价', 'list'],
    ['编程语言', 'tags'],
    ['竞赛获奖', 'list'],
    ['科研成果', 'cards']
  ];
  cases.forEach(function (c, i) {
    const got = H.inferSort(c[0]);
    ok(got === c[1], '2.' + (i + 1) + ' 「' + c[0] + '」应推荐 ' + c[1], got);
  });

  /* 边界 */
  ok(H.inferSort('') === 'list', '2.13 空名称应回落到 list', H.inferSort(''));
  ok(H.inferSort(null) === 'list', '2.14 null 应回落到 list', H.inferSort(null));
  ok(H.inferSort(undefined) === 'list', '2.15 undefined 应回落到 list', H.inferSort(undefined));
  ok(H.inferSort('随便起个名') === 'list', '2.16 无关键词时回落 list', H.inferSort('随便起个名'));

  /* 返回值必须是渲染层认得的 sort */
  const VALID = ['list', 'cards', 'timeline', 'tags'];
  const names = ['荣誉奖项', '教育背景', '技能', '项目', 'xxx'];
  ok(names.every(n => VALID.indexOf(H.inferSort(n)) !== -1),
    '2.17 返回值必须落在合法 sort 集合内');

  ok(H.sortLabel('tags') === '标签', '2.18 sortLabel 应给出中文名', H.sortLabel('tags'));
  ok(H.sortLabel('未知') === '未知', '2.19 未知 sort 原样返回', H.sortLabel('未知'));
}

/* ------------------------------------------------------ data URL 体积 */
console.log('\n-- data URL 体积估算 --');
{
  /* 已知长度的手工样本：base64 每 4 字符 = 3 字节 */
  const b64 = 'AAAA';                       /* 4 字符 → 3 字节 */
  const url = 'data:image/png;base64,' + b64;
  ok(H.dataUrlBytes(url) === 3, '3.1 4 个 base64 字符应算 3 字节', String(H.dataUrlBytes(url)));

  /* 带 1 个填充：3 字符有效 → 2 字节 */
  const url2 = 'data:image/png;base64,AAA=';
  ok(H.dataUrlBytes(url2) === 2, '3.2 带 1 个填充应算 2 字节', String(H.dataUrlBytes(url2)));

  /* 带 2 个填充：2 字符有效 → 1 字节 */
  const url3 = 'data:image/png;base64,AA==';
  ok(H.dataUrlBytes(url3) === 1, '3.3 带 2 个填充应算 1 字节', String(H.dataUrlBytes(url3)));

  ok(H.dataUrlBytes('') === 0, '3.4 空串应返回 0');
  ok(H.dataUrlBytes('assets/avatar.svg') === 0, '3.5 普通路径应返回 0');
  ok(H.dataUrlBytes(null) === 0, '3.6 null 应返回 0');
  ok(H.dataUrlBytes(undefined) === 0, '3.7 undefined 应返回 0');

  /* 与真实 base64 长度对得上：模拟一张 480x640 的 jpeg 量级 */
  const body = 'A'.repeat(4 * 25000);       /* 25 KB 数据 */
  ok(H.dataUrlBytes('data:image/jpeg;base64,' + body) === 75000,
    '3.8 应能估算 100KB 级别的图片', String(H.dataUrlBytes('data:image/jpeg;base64,' + body)));

  ok(H.formatBytes(512) === '512 B', '3.9 小于 1KB 用 B', H.formatBytes(512));
  ok(H.formatBytes(2048) === '2 KB', '3.10 KB 级', H.formatBytes(2048));
  ok(/MB$/.test(H.formatBytes(3 * 1024 * 1024)), '3.11 MB 级', H.formatBytes(3 * 1024 * 1024));
  ok(H.formatBytes(0) === '0 B', '3.12 0 字节', H.formatBytes(0));
  ok(H.formatBytes(null) === '0 B', '3.13 null 不炸', H.formatBytes(null));
}

/* ---------------------------------------------------------- 数组交换 */
console.log('\n-- 数组交换 --');
{
  const a = [1, 2, 3];
  H.swap(a, 0, 1);
  ok(a.join('') === '213', '4.1 相邻交换', a.join(''));
  H.swap(a, 1, 2);
  ok(a.join('') === '231', '4.2 再交换', a.join(''));

  const b = [1, 2, 3];
  H.swap(b, 0, -1);
  ok(b.join('') === '123', '4.3 越界（负数）不应改变数组', b.join(''));
  H.swap(b, 0, 9);
  ok(b.join('') === '123', '4.4 越界（超长）不应改变数组', b.join(''));
  H.swap(null, 0, 1);
  ok(true, '4.5 传 null 不应抛异常');
  H.swap([], 0, 1);
  ok(true, '4.6 空数组不应抛异常');
}

/* ------------------------------------------------------ 头像取景几何 */
console.log('\n-- 头像取景（cropRectFor）--');
{
  const OUT_W = 480, OUT_H = 640;          /* 3:4 证件照 */

  /* 5.1 横图：必须取满高度，宽度按比例 */
  {
    const r = H.cropRectFor({ iw: 1600, ih: 1200, outW: OUT_W, outH: OUT_H });
    ok(Math.abs(r.sw / r.sh - OUT_W / OUT_H) < 1e-9, '5.1 裁剪框宽高比应等于输出比例',
      (r.sw / r.sh).toFixed(4) + ' vs ' + (OUT_W / OUT_H).toFixed(4));
    ok(r.sh <= 1200 + 1e-6 && r.sw <= 1600 + 1e-6, '5.2 裁剪框不应超出源图',
      JSON.stringify(r));
    ok(r.sh === 1200, '5.3 横图应取满高度', String(r.sh));
    ok(r.sw === 900, '5.4 宽度应为 1200×3/4=900', String(r.sw));
  }

  /* 5.5 竖图（手机照片常见）：取满宽度 */
  {
    const r = H.cropRectFor({ iw: 1200, ih: 1600, outW: OUT_W, outH: OUT_H });
    ok(r.sw === 1200, '5.5 竖图应取满宽度', String(r.sw));
    ok(Math.abs(r.sh - 1600) < 1e-6, '5.6 高度应为 1200÷(3/4)=1600', String(r.sh));
  }

  /* 5.7 裁剪框必须完整落在源图内 —— 各种尺寸组合都试一遍 */
  {
    const sizes = [[100, 100], [1600, 1200], [1200, 1600], [800, 800], [4000, 3000], [100, 500], [500, 100]];
    let bad = 0;
    sizes.forEach(function (s) {
      [null, { x: 0, y: 0 }, { x: s[0], y: s[1] }, { x: s[0] / 2, y: s[1] / 2 },
       { x: -50, y: -50 }, { x: s[0] + 99, y: s[1] + 99 }].forEach(function (f) {
        const r = H.cropRectFor({
          iw: s[0], ih: s[1], outW: OUT_W, outH: OUT_H,
          faceCx: f && f.x, faceCy: f && f.y
        });
        if (r.sx < -1e-6 || r.sy < -1e-6 ||
            r.sx + r.sw > s[0] + 1e-6 || r.sy + r.sh > s[1] + 1e-6) bad++;
      });
    });
    ok(bad === 0, '5.7 任意尺寸 / 任意人脸位置都不应越界', bad + ' 组越界');
  }

  /* 5.8 人脸水平居中：人脸在左 / 中 / 右，裁剪框应跟着移动 */
  {
    const left = H.cropRectFor({ iw: 1600, ih: 1200, outW: OUT_W, outH: OUT_H, faceCx: 300, faceCy: 600 });
    const mid = H.cropRectFor({ iw: 1600, ih: 1200, outW: OUT_W, outH: OUT_H, faceCx: 800, faceCy: 600 });
    const right = H.cropRectFor({ iw: 1600, ih: 1200, outW: OUT_W, outH: OUT_H, faceCx: 1300, faceCy: 600 });
    ok(left.sx < mid.sx && mid.sx < right.sx, '5.8 人脸越靠右，裁剪框越靠右',
      [left.sx, mid.sx, right.sx].map(Math.round).join(' / '));

    /* 人脸应该落在裁剪框水平中心 */
    ok(Math.abs((mid.sx + mid.sw / 2) - 800) < 1e-6, '5.9 人脸应落在裁剪框水平中心',
      String(mid.sx + mid.sw / 2));
  }

  /* 5.10 人脸垂直位置：应落在裁剪框「从顶部往下 38%」处。
     要让竖直方向有余量，源图必须比目标比例**更高**（例如竖拍全身照 1200×3600）。
     3:4 或 3:2 的图裁 3:4 时竖直方向是被锁死的，没有可挪空间。 */
  {
    const r = H.cropRectFor({ iw: 1200, ih: 3600, outW: OUT_W, outH: OUT_H, faceCx: 600, faceCy: 1400 });
    ok(Math.abs(r.sw - 1200) < 1e-6 && Math.abs(r.sh - 1600) < 1e-6,
      '5.10a 1200×3600 的竖图应裁出 1200×1600', JSON.stringify({ w: r.sw, h: r.sh }));
    ok(r.sy > 0, '5.10b 这种图应该有竖直余量', String(r.sy));
    const rel = (1400 - r.sy) / r.sh;
    ok(Math.abs(rel - 0.38) < 1e-6, '5.10c 人脸应在裁剪框高度 38% 处', rel.toFixed(4));
  }

  /* 5.11 没检测到人脸时按「偏上」兜底，而不是正中间 */
  {
    const noFace = H.cropRectFor({ iw: 1200, ih: 3600, outW: OUT_W, outH: OUT_H });
    const faceTop = H.cropRectFor({ iw: 1200, ih: 3600, outW: OUT_W, outH: OUT_H, faceCx: 600, faceCy: 1332 });
    ok(Math.abs(noFace.sy - faceTop.sy) < 1e-6,
      '5.11 无人脸时默认取景应与「人脸在上 37%」一致',
      noFace.sy.toFixed(1) + ' vs ' + faceTop.sy.toFixed(1));
  }

  /* 5.12 手动微调：nudge 为负上移、为正下移，且不越界 */
  {
    const O = { iw: 1200, ih: 3600, outW: OUT_W, outH: OUT_H, faceCx: 600, faceCy: 1800 };
    const base = H.cropRectFor(O);
    const up = H.cropRectFor(Object.assign({}, O, { nudge: -1 }));
    const down = H.cropRectFor(Object.assign({}, O, { nudge: 1 }));
    ok(up.sy < base.sy, '5.12 nudge=-1 应向上看', up.sy.toFixed(1) + ' < ' + base.sy.toFixed(1));
    ok(down.sy > base.sy, '5.13 nudge=+1 应向下看', down.sy.toFixed(1) + ' > ' + base.sy.toFixed(1));
    ok(up.sy >= 0 && down.sy + down.sh <= 3600 + 1e-6, '5.14 微调后仍不应越界',
      JSON.stringify({ upSy: up.sy, downBottom: down.sy + down.sh }));

    /* 人脸在最上方时，裁剪框本来就该被贴边夹住 */
    const topFace = H.cropRectFor({ iw: 1200, ih: 3600, outW: OUT_W, outH: OUT_H, faceCx: 600, faceCy: 100 });
    ok(topFace.sy === 0, '5.15 人脸贴顶时裁剪框应贴顶', String(topFace.sy));
  }

  /* 5.16 源图比例与目标一致时没有可裁余量，这是正确行为 */
  {
    const r = H.cropRectFor({ iw: 1200, ih: 1600, outW: OUT_W, outH: OUT_H, faceCx: 100, faceCy: 100 });
    ok(r.sx === 0 && r.sy === 0 && r.sw === 1200 && r.sh === 1600,
      '5.16 比例相同 → 整图即裁剪框', JSON.stringify(r));
  }

  /* 5.17 比目标比例更宽的图：竖直方向锁死、水平方向可挪 */
  {
    const r = H.cropRectFor({ iw: 2400, ih: 1800, outW: OUT_W, outH: OUT_H, faceCx: 400, faceCy: 300 });
    ok(r.sh === 1800 && r.sy === 0, '5.17 3:2 横图裁 3:4 时竖直锁死，贴顶是正确结果',
      JSON.stringify({ sh: r.sh, sy: r.sy }));
    ok(r.sw === 1350, '5.18 裁剪框宽度应为 1800×3/4=1350', String(r.sw));
    ok(r.sx === 0, '5.19 人脸太靠左时裁剪框被左边界夹住', String(r.sx));

    /* 人脸在中间，才能看出裁剪框真的跟着走 */
    const mid = H.cropRectFor({ iw: 2400, ih: 1800, outW: OUT_W, outH: OUT_H, faceCx: 1500, faceCy: 300 });
    ok(mid.sx === 825, '5.20 人脸居中时 sx 应为 1500-1350/2=825', String(mid.sx));
    const right = H.cropRectFor({ iw: 2400, ih: 1800, outW: OUT_W, outH: OUT_H, faceCx: 2200, faceCy: 300 });
    ok(right.sx === 1050, '5.21 人脸靠右时裁剪框右移且被右边界夹住', String(right.sx));
  }

  /* 5.22 异常输入不应抛错、不应返回 NaN */
  {
    let threw = false, nan = false;
    [[0, 0], [1, 1], [-5, -5], [NaN, 100], [100, NaN]].forEach(function (s) {
      try {
        const r = H.cropRectFor({ iw: s[0], ih: s[1], outW: OUT_W, outH: OUT_H });
        if ([r.sx, r.sy, r.sw, r.sh].some(function (v) { return !isFinite(v); })) nan = true;
      } catch (e) { threw = true; }
    });
    try { H.cropRectFor(); } catch (e) { threw = true; }
    try { H.cropRectFor({}); } catch (e) { threw = true; }
    ok(!threw, '5.22 异常输入不应抛异常');
    ok(!nan, '5.23 结果不应是 NaN / Infinity');
  }

  /* 5.24 极限扁平图（超宽）也能得到合法裁剪框 */
  {
    const r = H.cropRectFor({ iw: 4000, ih: 200, outW: OUT_W, outH: OUT_H });
    ok(r.sh === 200 && r.sw === 150, '5.24 超宽图应取满高度、宽度 200×3/4=150',
      JSON.stringify({ w: r.sw, h: r.sh }));
    ok(r.sx >= 0 && r.sx + r.sw <= 4000, '5.25 超宽图裁剪框应落在源图内', String(r.sx));
  }
}

/* ------------------------------------------------ 占位头像构图约束 */
console.log('\n-- 占位头像 SVG 构图 --');
{
  const ROOT = path.resolve(__dirname, '..');
  const svg = fs.readFileSync(path.join(ROOT, 'assets/avatar.svg'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const printCss = fs.readFileSync(path.join(ROOT, 'print.css'), 'utf8');

  /* 6.1 object-position 必须是居中的中性值。
     以前这里写死过 50% 8%，等于把某一张照片的构图硬编码进 CSS。 */
  const avatarRule = /\.avatar\s*\{[^}]*\}/.exec(css);
  ok(!!avatarRule, '6.1 style.css 里应有 .avatar 规则');
  if (avatarRule) {
    const pos = /object-position:\s*([^;]+);/.exec(avatarRule[0]);
    ok(!!pos, '6.2 .avatar 应显式写 object-position');
    if (pos) {
      ok(/50%\s+50%/.test(pos[1].trim()), '6.3 .avatar 的 object-position 应为 50% 50%', pos[1].trim());
    }
    ok(/object-fit:\s*cover/.test(avatarRule[0]), '6.4 .avatar 应使用 object-fit: cover');
  }
  ok(!/object-position:\s*50%\s+8%/.test(css), '6.5 不应再有写死的 50% 8%');
  ok(!/object-position:\s*50%\s+8%/.test(printCss), '6.6 打印样式里也不应再有 50% 8%');

  /* 6.7 SVG 的 viewBox 与圆裁切参数 */
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  ok(!!vb, '6.7 SVG 应有 viewBox');
  const VW = vb ? Number(vb[1]) : 320;
  const VH = vb ? Number(vb[2]) : 400;
  ok(VW === 320 && VH === 400, '6.8 viewBox 应为 320×400', VW + '×' + VH);

  const ring = /<clipPath id="ring">\s*<circle cx="(\d+)" cy="(\d+)" r="(\d+)"\/>/.exec(svg);
  ok(!!ring, '6.9 SVG 应定义圆形裁切区域（页面是按圆显示的）');
  const RCX = ring ? Number(ring[1]) : 0;
  const RCY = ring ? Number(ring[2]) : 0;
  const RR = ring ? Number(ring[3]) : 0;
  ok(Math.abs(RCX - VW / 2) < 1e-6, '6.10 圆应水平居中', String(RCX));
  ok(RR >= VW / 2, '6.11 圆应覆盖整个宽度', String(RR));
  /* 圆的水平内切：可见宽度就是整幅宽度；纵向只露出 2R 这么多 */
  ok(Math.abs(RCY - VH / 2) <= 20, '6.12 圆心应大致在画布纵向中间', String(RCY));

  /* 6.13 人像必须落在圆内。注意要跳过 clipPath 里那个圆，
     用「人像那一组」里的头部圆 —— 它的 cx 是水平居中且 r 明显更小。 */
  const allCircles = svg.match(/<circle[^>]*\/>/g) || [];
  let headCy = 0, headR = 0, headCx = 0;
  allCircles.forEach(function (c) {
    const m = /cx="(\d+)" cy="(\d+)" r="(\d+)"/.exec(c);
    if (!m) return;
    const r = Number(m[3]);
    /* clipPath 的圆 r=160 且 cy=200；头部圆 r 在 40~70 之间 */
    if (r >= 40 && r <= 70) { headCx = Number(m[1]); headCy = Number(m[2]); headR = r; }
  });
  ok(headR > 0, '6.13 应能读到人像头部圆（r 在 40~70 之间）', JSON.stringify(allCircles));
  const figureTop = headCy - headR;

  /* 肩部路径：M160 <shTop> ... 再整体 translate(0 N) */
  const shTopMatch = /M160\s+(\d+)\s*\n/.exec(svg) || /M160\s+(\d+)/.exec(svg);
  const shShift = /transform="translate\(0 (\d+)\)"/.exec(svg);
  const shift = shShift ? Number(shShift[1]) : 0;
  const shTop = (shTopMatch ? Number(shTopMatch[1]) : 0) + shift;
  /* 肩底 = 肩顶 + 76（c 曲线的竖直跨度）+ 12（圆角半径） */
  const figureBottom = shTop + 88;

  const circleTop = RCY - RR;
  const circleBottom = RCY + RR;
  const topPad = figureTop - circleTop;
  const bottomPad = circleBottom - figureBottom;

  ok(figureTop >= circleTop, '6.14 头顶不应超出圆顶',
    'figureTop=' + figureTop + ' circleTop=' + circleTop);
  ok(figureBottom <= circleBottom, '6.15 肩底不应超出圆底（否则会被切平）',
    'figureBottom=' + figureBottom + ' circleBottom=' + circleBottom);
  ok(topPad >= 8, '6.16 头顶留白应 ≥8（太小会显得贴顶）', String(topPad));
  ok(bottomPad >= 30, '6.17 底部留白应 ≥30（太小说明肩膀被切）', String(bottomPad));
  ok(topPad < bottomPad, '6.18 头顶留白应小于底部留白（人像自然偏上）',
    topPad + ' vs ' + bottomPad);

  /* 6.19 人像水平居中 */
  ok(headCx === VW / 2, '6.19 头部圆心应水平居中', String(headCx));

  /* 6.20 提示文字应写在圆外，避免在圆形头像里露一半 */
  const textY = /<text x="160" y="(\d+)"/.exec(svg);
  ok(!!textY, '6.20 应保留「替换为你的照片」提示');
  if (textY) {
    ok(Number(textY[1]) > circleBottom, '6.21 提示文字应放在圆外（圆形显示时看不到才正常）',
      'textY=' + textY[1] + ' circleBottom=' + circleBottom);
  }
}

/* ------------------------------------------ Hero 头像与文字的中轴对齐 */
console.log('\n-- Hero 中轴对齐 --');
{
  const ROOT = path.resolve(__dirname, '..');
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const printCss = fs.readFileSync(path.join(ROOT, 'print.css'), 'utf8');

  /* 7.1 #hero 靠 flex + align-items:center 居中一切 */
  const hero = /#hero\s*\{[^}]*\}/.exec(css);
  ok(!!hero, '7.1 应能找到 #hero 规则');
  if (hero) {
    ok(/display:\s*flex/.test(hero[0]), '7.2 #hero 应是 flex 容器');
    ok(/flex-direction:\s*column/.test(hero[0]), '7.3 #hero 应是纵向排列');
    ok(/align-items:\s*center/.test(hero[0]), '7.4 #hero 应横向居中子元素');
  }

  /* 7.5 关键：.hero-top 必须显式设成居中 flex。
     它只被 print.css 设过样式时，屏幕上会是 display:block ——
     作为 flex column 的子元素被撑到满宽，里面宽度由内容决定的 .avatar-ring
     就会被甩到左边，表现成「头像相对下面的姓名偏左」。 */
  const top = /#hero\s+\.hero-top\s*\{[^}]*\}/.exec(css);
  ok(!!top, '7.5 style.css 里必须给 #hero .hero-top 写样式（不能只靠 print.css）');
  if (top) {
    ok(/display:\s*flex/.test(top[0]), '7.6 .hero-top 应是 flex 容器');
    ok(/flex-direction:\s*column/.test(top[0]), '7.7 屏幕上 .hero-top 应纵向排列');
    ok(/align-items:\s*center/.test(top[0]), '7.8 .hero-top 应横向居中子元素');
  }

  /* 7.9 打印时反过来要横排 */
  const ptop = /#hero\s+\.hero-top\s*\{[^}]*\}/.exec(printCss);
  ok(!!ptop, '7.9 print.css 里应保留 .hero-top 规则');
  if (ptop) {
    ok(/display:\s*flex\s*!important/.test(ptop[0]) || /display:\s*flex/.test(ptop[0]),
      '7.10 打印时 .hero-top 应是 flex');
    ok(/flex-direction:\s*row/.test(ptop[0]) || !/flex-direction/.test(ptop[0]),
      '7.11 打印时应横排（或保持 flex 默认 row）', ptop[0].replace(/\s+/g, ' ').slice(0, 90));
  }

  /* 7.12 头像外圈宽度是固定的，不随容器拉伸 —— 这正是它容易被甩左的原因 */
  const ring = /\.avatar-ring\s*\{[^}]*\}/.exec(css);
  ok(!!ring, '7.12 应能找到 .avatar-ring 规则');
  if (ring) {
    ok(/width:\s*\d+px/.test(ring[0]), '7.13 .avatar-ring 应是固定像素宽（内容决定宽度）',
      (/width:[^;]*/.exec(ring[0]) || [''])[0]);
  }
}

/* ---------------------------------------------------- 区块合并（面板用） */
console.log('\n-- 区块合并 mergeSections --');
{
  const S = (id, title, n) => ({
    id, title, sort: 'list',
    items: Array.from({ length: n || 1 }, (_, i) => ({ title: '条目' + (i + 1), text: 'x' }))
  });

  /* 8.1 本次识别到新模块 → 现有模块仍全部保留，新模块排在后面 */
  {
    const ex = [S('education', '教育背景'), S('custom-1', '发表论文')];
    const pa = [S('projects', '项目经历')];
    const m = H.mergeSections(ex, pa);
    ok(m.length === 3, '8.1 合并结果应包含全部区块', String(m.length));
    ok(m.map(e => e.section.id).join(',') === 'education,custom-1,projects',
      '8.2 顺序应为「现有在前、新的追加在后」', m.map(e => e.section.id).join(','));
    ok(m[0].fromParse === false && m[1].fromParse === false, '8.3 现有区块应标为未识别到');
    ok(m[2].fromParse === true, '8.4 本次识别的区块应标为已识别');
  }

  /* 8.5 同 id 被识别覆盖：用识别结果，但保留原有位置 */
  {
    const ex = [S('education', '教育背景'), S('custom-1', '发表论文'), S('skills', '相关技能')];
    const pa = [S('skills', '相关技能（新）'), S('education', '教育背景（新）')];
    const m = H.mergeSections(ex, pa);
    ok(m.length === 3, '8.5 同 id 不应产生重复', String(m.length));
    ok(m.map(e => e.section.id).join(',') === 'education,custom-1,skills',
      '8.6 被覆盖的区块应保持原位置', m.map(e => e.section.id).join(','));
    ok(m[0].section.title === '教育背景（新）', '8.7 应采用识别结果的内容', m[0].section.title);
    ok(m[1].section.title === '发表论文' && m[1].fromParse === false,
      '8.8 未识别到的自建模块应原样保留', JSON.stringify(m[1].section.title));
    ok(m[2].section.title === '相关技能（新）', '8.9 末尾区块也应被覆盖', m[2].section.title);
  }

  /* 8.10 空壳现有模块也要列出（方便就地补内容） */
  {
    const m = H.mergeSections([{ id: 'custom-9', title: '空模块', sort: 'list', items: [] }], []);
    ok(m.length === 1 && m[0].fromParse === false, '8.10 空内容的现有模块也应列出', JSON.stringify(m.length));
  }

  /* 8.11 识别结果为空时，等于列出全部现有模块 */
  {
    const ex = [S('a', 'A'), S('b', 'B')];
    const m = H.mergeSections(ex, []);
    ok(m.length === 2 && m.every(e => !e.fromParse), '8.11 无识别结果时应列出全部现有模块');
  }

  /* 8.12 没有现有模块时，就是纯识别结果 */
  {
    const m = H.mergeSections([], [S('a', 'A'), S('b', 'B')]);
    ok(m.length === 2 && m.every(e => e.fromParse), '8.12 无现有模块时应列出全部识别结果');
  }

  /* 8.13 异常输入不应抛错 */
  {
    let threw = false;
    try {
      H.mergeSections(null, null);
      H.mergeSections(undefined, undefined);
      H.mergeSections([], undefined);
      H.mergeSections([null, S('a', 'A')], [null, { title: '没有 id' }]);
    } catch (e) { threw = true; }
    ok(!threw, '8.13 异常输入不应抛异常');
    ok(H.mergeSections(null, null).length === 0, '8.14 null 输入应返回空数组');
  }

  /* 8.15 不应污染传入的数组 */
  {
    const ex = [S('a', 'A')];
    const pa = [S('a', 'A2'), S('b', 'B')];
    const exLen = ex.length, paLen = pa.length;
    H.mergeSections(ex, pa);
    ok(ex.length === exLen && pa.length === paLen, '8.15 不应修改传入数组',
      ex.length + '/' + pa.length);
  }
}

console.log('\n' + '═'.repeat(60));
console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
if (fail) { console.log('\n  失败明细：'); failures.forEach(f => console.log('   ✗ ' + f)); }
console.log('═'.repeat(60) + '\n');
process.exit(fail ? 1 : 0);
