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

/* 7. hidden 区块不应渲染：取消勾选 = 不显示，而不是删数据 */
{
  const { Render, doc } = makeEnv();

  function sectionTitles(data) {
    const root = doc.createElement('main');
    Render.renderInto(root, data, {});
    return root.children.filter(n => n.className === 'resume-section')
      .map(n => {
        /* el(tag, cls, html) 第三个参数写的是 innerHTML，桩件也照此实现 */
        const h2 = n.children[0];
        return (h2 && (h2.innerHTML || h2.textContent)) || '';
      });
  }

  const base = {
    meta: {}, profile: { name: '示例姓名' },
    sections: [
      { id: 'a', title: '教育背景', sort: 'list', items: [{ title: 'x', text: 'y' }] },
      { id: 'b', title: '项目经历', sort: 'list', items: [{ title: 'x', text: 'y' }] }
    ]
  };
  ok(sectionTitles(base).length === 2, '7.1 两个区块都应渲染',
    JSON.stringify(sectionTitles(base)));

  const withHidden = JSON.parse(JSON.stringify(base));
  withHidden.sections[1].hidden = true;
  const titles = sectionTitles(withHidden);
  ok(titles.length === 1, '7.2 标了 hidden 的区块不应渲染', JSON.stringify(titles));
  ok(titles[0] === '教育背景', '7.3 该渲染的仍是可见的那个', titles[0]);

  /* hidden: false 与没有该字段等价 */
  const explicitFalse = JSON.parse(JSON.stringify(base));
  explicitFalse.sections[1].hidden = false;
  ok(sectionTitles(explicitFalse).length === 2, '7.4 hidden:false 应正常渲染');

  /* 全部 hidden → 不应崩，也不应渲染任何区块 */
  const allHidden = JSON.parse(JSON.stringify(base));
  allHidden.sections.forEach(s => { s.hidden = true; });
  ok(sectionTitles(allHidden).length === 0, '7.5 全部隐藏时不应渲染区块');
}

console.log('\n' + '═'.repeat(60));
console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
if (fail) { console.log('\n  失败明细：'); failures.forEach(f => console.log('   ✗ ' + f)); }
console.log('═'.repeat(60) + '\n');
process.exit(fail ? 1 : 0);
