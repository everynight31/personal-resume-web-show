/* 标签页标题派生逻辑测试：node tests/render.test.js
   render.js 里的 applyTitle() 需要 DOM，这里用最小桩件加载它。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; return true; }
  fail++;
  failures.push(label + (extra ? '  →  ' + extra : ''));
  return false;
}

/** 造一个够用的 DOM 桩：render.js 只在 applyTitle / renderInto 用到少量接口 */
function makeEnv() {
  const titleEl = { textContent: '简历', tagName: 'TITLE' };
  const doc = {
    title: '简历',
    _titleEl: titleEl,
    getElementById: () => null,
    querySelector: (sel) => (sel === 'title' ? titleEl : null),
    querySelectorAll: () => [],
    createElement: (tag) => ({
      tagName: String(tag).toUpperCase(), className: '', style: {}, dataset: {},
      children: [], appendChild(c) { this.children.push(c); return c; },
      setAttribute() {}, addEventListener() {}, querySelectorAll: () => [],
      querySelector: () => null, innerHTML: '', textContent: ''
    }),
    addEventListener() {},
    head: { appendChild() {} },
    documentElement: { getAttribute: () => 'light', setAttribute() {} },
    body: { style: {} }
  };
  const win = {
    document: doc,
    innerWidth: 1200,
    innerHeight: 900,
    devicePixelRatio: 1,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    addEventListener() {},
    requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0),
    cancelAnimationFrame() {},
    IntersectionObserver: undefined,
    MutationObserver: undefined
  };
  win.window = win;
  win.globalThis = win;
  Object.defineProperty(doc, 'title', {
    get() { return win.__title || ''; },
    set(v) { win.__title = String(v); },
    configurable: true
  });

  const sandbox = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/render.js'), 'utf8'), sandbox, { filename: 'render.js' });
  return { Render: sandbox.ResumeRender, doc, win };
}

console.log('\n══════ 标签页标题派生 ══════');

/* 1. 有 meta.title 时优先用它 */
{
  const { Render, doc } = makeEnv();
  const t = Render.applyTitle({ meta: { title: '张三 - 简历' }, profile: { name: '张三' } });
  ok(t === '张三 - 简历', '1.1 有 meta.title 时用它', t);
  ok(doc.title === '张三 - 简历', '1.2 应写入 document.title', doc.title);
}

/* 2. 没有 meta.title 时由姓名拼出来 */
{
  const { Render, doc } = makeEnv();
  const t = Render.applyTitle({ meta: {}, profile: { name: '李四' } });
  ok(t === '李四 - 简历', '2.1 无 meta.title 时按姓名拼', t);
  ok(doc.title === '李四 - 简历', '2.2 应写入 document.title', doc.title);
}

/* 3. meta.title 是空白串也要走派生 */
{
  const { Render } = makeEnv();
  ok(Render.applyTitle({ meta: { title: '   ' }, profile: { name: '王五' } }) === '王五 - 简历',
    '3.1 空白 meta.title 应视为未设置');
}

/* 4. 两者都没有时保持原标题，不能变成 "undefined - 简历" */
{
  const { Render, doc } = makeEnv();
  const before = doc.title;
  const t = Render.applyTitle({ meta: {}, profile: {} });
  ok(t === before, '4.1 无数据时应保持原标题', t);
  ok(t.indexOf('undefined') === -1, '4.2 不应出现 undefined', t);
  ok(t.indexOf('null') === -1, '4.3 不应出现 null', t);
}

/* 5. 姓名里带空格 / 英文名 */
{
  const { Render } = makeEnv();
  ok(Render.applyTitle({ profile: { name: 'San Zhang' } }) === 'San Zhang - 简历',
    '5.1 英文名也能拼');
}

/* 6. 真实 data.js 走一遍：标题应与 meta.title 一致 */
{
  const { Render } = makeEnv();
  const dataSandbox = vm.createContext({ console, JSON, Math, Date, RegExp });
  dataSandbox.window = dataSandbox; dataSandbox.globalThis = dataSandbox;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'), dataSandbox, { filename: 'data.js' });
  const real = dataSandbox.RESUME_DATA;

  const t = Render.applyTitle(real);
  ok(t === real.meta.title, '6.1 真实 data.js 的标题取自 meta.title', t);
  ok(t.length > 0 && t !== '简历', '6.2 标题不应还是占位值', t);
  ok(!/undefined|null/.test(t), '6.3 标题里不应出现 undefined/null', t);

  /* 派生兜底：把 meta.title 去掉后，应该用 profile.name */
  ok(Render.applyTitle({ meta: {}, profile: real.profile }) === real.profile.name + ' - 简历',
    '6.4 去掉 meta.title 后按 profile.name 兜底');
}

console.log('\n' + '═'.repeat(60));
console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
if (fail) { console.log('\n  失败明细：'); failures.forEach(f => console.log('   ✗ ' + f)); }
console.log('═'.repeat(60) + '\n');
process.exit(fail ? 1 : 0);
