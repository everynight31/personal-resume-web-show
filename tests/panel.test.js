/* 校对面板结构测试：node tests/panel.test.js
   用最小 DOM 桩件加载 ui.js，检查分组卡片的折叠结构、摘要文字与勾选联动。
   盯的是「面板太挤、看不出选了什么」那个问题不再回归。 */
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

/* ------------------------------------------------------------ 极简 DOM 桩件 */

function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentElement: null,
    dataset: {},
    style: {},
    attrs: {},
    _text: '',
    _html: '',
    _className: '',
    _listeners: {},
    classList: {
      _set: new Set(),
      add(...c) { c.forEach(x => this._set.add(x)); this._sync(); },
      remove(...c) { c.forEach(x => this._set.delete(x)); this._sync(); },
      contains(c) { return this._set.has(c); },
      toggle(c, force) {
        const on = force === undefined ? !this._set.has(c) : !!force;
        if (on) this._set.add(c); else this._set.delete(c);
        this._sync();
        return on;
      },
      /* 真实 DOM 里 className 和 classList 是同一份数据的两个视图，
         桩件也必须同步，否则断言「有某个 class」会假失败 */
      _sync() { el._className = Array.from(this._set).join(' '); }
    },    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    insertBefore(c) { c.parentElement = this; this.children.unshift(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    /* 浏览器里 .title 是独立属性（设置它不会写进 attrs），桩件照此实现 */
    get title() { return this._title || ''; },
    set title(v) { this._title = String(v); },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() {},
    dispatch(t, ev) {
      (this._listeners[t] || []).forEach(fn => fn(ev || {
        target: this,
        stopPropagation() {},
        preventDefault() {}
      }));
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 300, height: 40, bottom: 40, right: 300 }; },
    focus() {},
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    get innerHTML() { return this._html; },
    set innerHTML(v) {
      this._html = String(v);
      /* 真实 DOM 里 innerHTML = '' 会清空子节点。
         桩件必须照做，否则连续渲染会不断累积 —— 断言会假通过或假失败。 */
      if (this._html === '') {
        this.children.forEach(c => { c.parentElement = null; });
        this.children = [];
      }
    },
    get value() { return this._value === undefined ? '' : this._value; },
    set value(v) { this._value = String(v); },
    get checked() { return !!this._checked; },
    set checked(v) { this._checked = !!v; },
    /* 真实 DOM 里 rows/type 这类 IDL 属性会同步到 attribute，桩件也照做，便于断言 */
    get rows() { return this._rows; },
    set rows(v) { this._rows = Number(v); this.attrs.rows = String(v); },
    get type() { return this.attrs.type || ''; },
    set type(v) { this.attrs.type = String(v); },
    get placeholder() { return this.attrs.placeholder || ''; },
    set placeholder(v) { this.attrs.placeholder = String(v); },
    get className() { return this._className; },
    set className(v) {
      this._className = String(v || '');
      this.classList._set = new Set(this._className.split(/\s+/).filter(Boolean));
    }
  };
  /* 递归找后代，便于断言 */
  el.descendants = function (pred, out = []) {
    for (const c of el.children) {
      if (!pred || pred(c)) out.push(c);
      if (c.descendants) c.descendants(pred, out);
    }
    return out;
  };
  el.texts = function () {
    const out = [];
    const walk = (n) => {
      if (n._text) out.push(n._text);
      (n.children || []).forEach(walk);
    };
    walk(el);
    return out;
  };
  return el;
}

function makeEnv() {
  const byId = Object.create(null);

  const document = {
    readyState: 'complete',
    documentElement: makeEl('html'),
    head: makeEl('head'),
    body: makeEl('body'),
    title: '',
    createElement: makeEl,
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    /* 按 id 建一批真实元素，ui.js 初始化时会去取它们 */
    getElementById: (id) => byId[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}
  };

  /* ui.js 在模块顶层就会读取这些节点 */
  const NEEDED = [
    'resume-root', 'parser-drawer', 'parser-overlay', 'parser-fab', 'drawer-close',
    'theme-toggle', 'raw-input', 'parse-status', 'btn-parse', 'btn-template', 'btn-sample',
    'btn-load-file', 'file-input', 'review-list', 'btn-select-all', 'btn-select-none',
    'btn-expand-all', 'btn-collapse-all', 'btn-apply', 'btn-undo', 'btn-discard',
    'apply-status', 'mini-preview', 'mini-badge', 'toast',
    'llm-enabled', 'llm-key', 'llm-base', 'llm-model', 'llm-trigger', 'llm-status',
    'btn-llm-clear', 'btn-llm-test', 'btn-export', 'btn-import', 'import-input',
    'btn-reset', 'data-status', 'effect-grid', 'bg-density', 'bg-density-value',
    'btn-bg-reset', 'bg-status',
    /* 头像与模块管理（模块编辑器的测试要用） */
    'avatar-preview', 'avatar-input', 'btn-avatar-pick', 'btn-avatar-clear',
    'avatar-info', 'avatar-status', 'avatar-nudge', 'avatar-nudge-row', 'avatar-nudge-value',
    'module-list', 'new-module-title', 'new-module-hint', 'btn-add-module', 'module-status'
  ];
  NEEDED.forEach(function (id) {
    const el = makeEl(id.indexOf('btn-') === 0 || id === 'drawer-close' ? 'button' : 'div');
    el.id = id;
    el.hidden = false;
    byId[id] = el;
  });
  byId['raw-input'] = Object.assign(makeEl('textarea'), { id: 'raw-input', hidden: false });
  byId['review-list'] = Object.assign(makeEl('div'), { id: 'review-list', hidden: false });

  const win = {
    document,
    /* Store.save/load 需要 localStorage：模块管理与「应用」都依赖它 */
    localStorage: (function () {
      const mem = {};
      return {
        getItem: (k) => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: (k) => { delete mem[k]; }
      };
    })(),
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 1,
    location: { hash: '', search: '' },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    addEventListener() {},
    requestAnimationFrame: (fn) => setTimeout(() => fn(0), 0),
    cancelAnimationFrame() {},
    confirm: () => true,
    setTimeout, clearTimeout
  };
  win.window = win;
  win.globalThis = win;
  /* Store.load() 需要一份基准数据 */
  win.RESUME_DATA = {
    meta: { dataVersion: 1, title: '测试 - 简历', footer: '', footnote: '' },
    profile: { name: '示例姓名', headline: '', intent: '', contacts: [] },
    sections: []
  };

  const sandbox = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/helpers.js'), 'utf8'), sandbox, { filename: 'helpers.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/skills.js'), 'utf8'), sandbox, { filename: 'skills.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/parser.js'), 'utf8'), sandbox, { filename: 'parser.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8'), sandbox, { filename: 'store.js' });
  /* applyReview 里会调 renderMain → renderInto，所以渲染层也要加载 */
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/render.js'), 'utf8'), sandbox, { filename: 'render.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
  return win;
}

console.log('\n══════ 校对面板结构 ══════');

/* 1. 分组头部：必须有独立成行的标题 + 摘要 + 折叠按钮，不能再有挤在一行的计数 */
{
  const win = makeEnv();
  const UI = win.ResumeUI;
  ok(!!UI, '1.1 ResumeUI 应加载成功');

  /* 直接调内部渲染：灌一份 review 进去 */
  const rev = win.ResumeParser.parse(win.ResumeParser.TEMPLATE);
  UI._setReview(rev);
  UI._renderReviewForTest();

  const groups = UI._reviewGroups();
  ok(groups.length >= 5, '1.2 应渲染出多个分组', String(groups.length));

  const headText = groups[0].descendants(n => n.className && n.className.indexOf('group-head-text') !== -1);
  ok(headText.length === 1, '1.3 头部应有独立的文字容器', String(headText.length));

  const titles = groups[0].descendants(n => n.className === 'group-title');
  ok(titles.length === 1 && titles[0].textContent.length > 0, '1.4 分组标题应有文字',
    titles[0] ? titles[0].textContent : '(无)');

  const summaries = groups[0].descendants(n => n.className === 'group-summary');
  ok(summaries.length === 1, '1.5 头部应有摘要行', String(summaries.length));
  ok(/应用/.test(summaries[0].textContent), '1.6 摘要应说明「应用了几项」', summaries[0].textContent);

  const toggles = groups[0].descendants(n => n.className === 'group-toggle');
  ok(toggles.length === 1, '1.7 头部应有折叠按钮');
  ok(toggles[0].tagName === 'BUTTON', '1.8 折叠按钮应是 button（可聚焦）', toggles[0].tagName);
  ok(toggles[0].attrs['aria-label'], '1.9 折叠按钮应有 aria-label');

  const counts = groups[0].descendants(n => n.className === 'group-count');
  ok(counts.length === 0, '1.10 旧的 group-count 应已移除');
}

/* 2. 字段结构：勾选框与字段名同一行，输入框在下一行铺满 */
{
  const win = makeEnv();
  const UI = win.ResumeUI;
  UI._setReview(win.ResumeParser.parse(win.ResumeParser.TEMPLATE));
  UI._renderReviewForTest();
  const groups = UI._reviewGroups();
  const firstGroup = groups[0];

  /* 先展开第一组 */
  firstGroup._toggle(true);

  const rows = firstGroup._body.children;
  ok(rows.length > 0, '2.1 第一组应有字段');

  const row = rows[0];
  const headRows = row.descendants(n => n.className === 'field-head');
  ok(headRows.length === 1, '2.2 字段应有独立的头部行');

  const labels = row.descendants(n => n.className === 'field-label');
  ok(labels.length === 1, '2.3 字段名应有独立类名', String(labels.length));

  const badges = row.descendants(n => n.className === 'field-badge');
  ok(badges.length === 1, '2.4 字段应有「已识别/未识别到」徽标', String(badges.length));
  ok(/已识别|未识别到/.test(badges[0].textContent), '2.5 徽标文字应对', badges[0].textContent);

  const inputs = row.descendants(n => n.className === 'field-input');
  ok(inputs.length === 1, '2.6 输入框应有独立类名', String(inputs.length));
  ok(inputs[0].tagName === 'TEXTAREA', '2.7 输入框应用 textarea 以便长文本换行', inputs[0].tagName);
  ok(Number(inputs[0].attrs.rows) >= 2, '2.8 rows 至少 2 行', inputs[0].attrs.rows || '(未设置)');

  /* 字段名的父级应是头部行，而不是被塞进网格左列 */
  ok(labels[0].parentElement === headRows[0], '2.9 字段名应在头部行内');
  ok(inputs[0].parentElement === row, '2.10 输入框应直接铺在字段行里（占满整行）');
}

/* 3. 折叠行为 */
{
  const win = makeEnv();
  const UI = win.ResumeUI;
  UI._setReview(win.ResumeParser.parse(win.ResumeParser.TEMPLATE));
  UI._renderReviewForTest();
  const groups = UI._reviewGroups();

  ok(groups[0].classList.contains('is-collapsed') === false, '3.1 第一组默认展开');
  const collapsed = groups.filter(g => g.classList.contains('is-collapsed')).length;
  ok(collapsed === groups.length - 1, '3.2 其余分组默认折叠', collapsed + '/' + groups.length);

  groups[1]._toggle(true);
  ok(!groups[1].classList.contains('is-collapsed'), '3.3 可以展开');
  groups[1]._toggle(false);
  ok(groups[1].classList.contains('is-collapsed'), '3.4 可以收起');
}

/* 4. 勾选联动摘要 */
{
  const win = makeEnv();
  const UI = win.ResumeUI;
  UI._setReview(win.ResumeParser.parse(win.ResumeParser.TEMPLATE));
  UI._renderReviewForTest();
  const groups = UI._reviewGroups();
  const g = groups[0];
  const summary = g.descendants(n => n.className === 'group-summary')[0];

  g._refresh();
  const before = summary.textContent;
  /* 模板里没写「求职意向」，所以那个字段默认不勾，摘要应显示部分应用而不是「应用全部」——
     这正是「本次没抽到的字段不预选」的行为 */
  ok(/应用(全部)?\s*[\d/]*\s*项/.test(before), '4.1 摘要应说明应用了几项', before);
  ok(/应用 4\/5 项|应用全部 5 项/.test(before), '4.1b 摘要应反映实际勾选数', before);

  /* 把未抽到的字段也勾上，才应该变成「应用全部」 */
  const allBoxes = g._body.descendants(n => n.className === 'check');
  allBoxes.forEach(function (b) { b.checked = true; b.dispatch('change'); });
  g._refresh();
  ok(/应用全部 5 项/.test(summary.textContent), '4.1c 全部勾上后应显示「应用全部」', summary.textContent);

  /* 关掉一个字段的勾选 */
  const cb = g._body.children[0].descendants(n => n.className === 'check')[0];
  cb.checked = false;
  cb.dispatch('change');
  g._refresh();
  ok(/应用 \d+\/\d+ 项/.test(summary.textContent), '4.2 取消一项后摘要应显示部分应用', summary.textContent);

  /* 全不选 */
  const groupBox = g.descendants(n => n.dataset && n.dataset.group)[0];
  groupBox.checked = false;
  groupBox.dispatch('change');
  g._refresh();
  ok(/不应用/.test(summary.textContent), '4.3 整组取消后摘要应显示「不应用」', summary.textContent);
  ok(g.classList.contains('is-unchecked'), '4.4 整组取消后应加 is-unchecked 类便于弱化显示');
}

/* 5. 面板要列出「全部模块」：设置里新建的模块也必须出现
      —— 这正是用户报的「设置里添加的模块在校对与应用里没有体现」 */
{
  const win = makeEnv();
  const UI = win.ResumeUI, Store = win.ResumeStore;

  /* 在设置里新建一个模块（等价于模块管理的效果） */
  const seeded = Store.load();
  seeded.sections = [
    { id: 'education', title: '教育背景', sort: 'list', items: [{ title: '学历', text: '示例大学' }] },
    { id: 'custom-papers', title: '发表论文', sort: 'list', items: [{ title: '论文', text: '一篇' }] }
  ];
  Store.save(seeded);

  /* 5.1 没有任何识别结果时，也要列出全部现有模块 */
  UI._setReview(null);
  UI._renderReviewForTest();
  let groups = UI._reviewGroups();
  let titles = groups.map(g => g.descendants(n => n.className === 'group-title')[0].textContent);

  ok(groups.length === 3, '5.1 无识别结果时应列出 基本信息 + 2 个模块', String(groups.length));
  ok(titles.some(t => t.indexOf('发表论文') !== -1),
    '5.2 自建模块「发表论文」必须在面板里出现', JSON.stringify(titles));
  ok(titles.some(t => t.indexOf('教育背景') !== -1), '5.3 已有模块也应出现', JSON.stringify(titles));

  const notes = UI._reviewNotes();
  ok(notes.length === 1, '5.4 应有一句说明「显示的是已有全部内容」');
  ok(/全部/.test(notes[0].textContent), '5.5 说明文字应提到「全部」', notes[0].textContent);

  /* 5.6 本次只识别到教育背景：自建模块仍要列出，并标注「现有模块」 */
  UI._setReview({
    profile: {}, sections: [
      { id: 'education', title: '教育背景', sort: 'list', anchor: 'education', items: [{ title: '学历', text: '新的大学' }] }
    ],
    unparsed: [], warnings: []
  });
  UI._renderReviewForTest();
  groups = UI._reviewGroups();
  titles = groups.map(g => g.descendants(n => n.className === 'group-title')[0].textContent);


  ok(groups.length === 3, '5.6 合并后仍应是 3 组', String(groups.length));
  const paperGroup = groups.filter(g =>
    g.descendants(n => n.className === 'group-title')[0].textContent.indexOf('发表论文') !== -1)[0];
  ok(!!paperGroup, '5.7 本次没识别到的自建模块仍要在面板里', JSON.stringify(titles));
  ok(paperGroup.classList.contains('is-existing'),
    '5.8 未识别到的模块应带 is-existing 标记便于区分');
  ok(/现有模块/.test(paperGroup.descendants(n => n.className === 'group-title')[0].textContent),
    '5.9 标题里应写明「现有模块（本次未识别到）」',
    paperGroup.descendants(n => n.className === 'group-title')[0].textContent);

  /* 5.10 未识别到的模块：内容留空、默认不勾选（只列出来，不冒充识别结果） */
  const area = paperGroup._body.descendants(n => n.tagName === 'TEXTAREA')[0];
  ok(!!area, '5.10 未识别到的模块仍应给出可编辑输入框');
  ok(area.value === '', '5.11 未识别到的模块内容应留空，不回填旧值', JSON.stringify(area.value));

  const groupBox = paperGroup.descendants(n => n.dataset && n.dataset.group)[0];
  ok(groupBox && groupBox.checked === false, '5.12 未识别到的模块默认不勾选（不要选）');
  ok(UI._state.checked['section.custom-papers'] === false,
    '5.13 未识别到的模块勾选状态应为 false');
  ok(paperGroup.classList.contains('is-unchecked'),
    '5.14 未识别到的模块应加 is-unchecked 便于弱化显示');

  /* 5.15 识别到的模块照旧预填、默认勾选 */
  const eduGroup = groups.filter(g =>
    g.descendants(n => n.className === 'group-title')[0].textContent.indexOf('教育背景') !== -1)[0];
  const eduArea = eduGroup._body.descendants(n => n.tagName === 'TEXTAREA')[0];
  ok(eduArea.value.indexOf('新的大学') !== -1, '5.15 识别到的模块应预填识别结果', eduArea.value);
  const eduBox = eduGroup.descendants(n => n.dataset && n.dataset.group)[0];
  ok(eduBox && eduBox.checked === true, '5.16 识别到的模块应默认勾选');

  /* 5.17 说明文字应讲清「勾选 = 这一项要不要出现在简历里」 */
  const note5 = UI._reviewNotes()[0].textContent;
  ok(/勾选/.test(note5), '5.17 有识别结果时说明文字应解释勾选的含义', note5);
  ok(/简历/.test(note5), '5.18 说明文字应说明勾选与简历显示的关系', note5);
  ok(/设置/.test(note5), '5.19 说明文字应提示模块可以去设置里删', note5);
}

/* 5b. 未识别到的模块：输入后才自动勾上，且内容能存下来 */
console.log('\n-- 未识别到的模块：输入即勾选 --');
const unparsedEditDone = (async function () {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const win = makeEnv();
  const UI = win.ResumeUI, Store = win.ResumeStore;

  const seeded = Store.load();
  seeded.sections = [
    { id: 'education', title: '教育背景', sort: 'list', items: [{ title: '学历', text: '示例大学' }] },
    { id: 'custom-papers', title: '发表论文', sort: 'list', items: [{ title: '论文', text: '一篇重要的论文' }] }
  ];
  Store.save(seeded);

  /* 本次只识别到 education，custom-papers 没识别到 */
  UI._setReview({
    profile: {}, sections: [{
      id: 'education', title: '教育背景', sort: 'list', anchor: 'education',
      items: [{ title: '学历', text: '新的大学' }]
    }],
    unparsed: [], warnings: []
  });
  UI._renderReviewForTest();

  const paperGroup = UI._reviewGroups().filter(g =>
    g.descendants(n => n.className === 'group-title')[0].textContent.indexOf('发表论文') !== -1)[0];
  const area = paperGroup._body.descendants(n => n.tagName === 'TEXTAREA')[0];

  area.value = '深度学习图像分割 · 一作 · 2025';
  area.dispatch('input');
  await wait(500);

  ok(UI._state.edited['section.custom-papers'] === true, '5b.1 输入后应记为「已编辑」');
  ok(UI._state.checked['section.custom-papers'] === true, '5b.2 输入后应自动勾上');

  UI._applyReviewForTest();
  const after = Store.load();
  const papers = after.sections.filter(s => s.id === 'custom-papers')[0];
  ok(!!papers, '5b.3 应用后模块仍存在');
  ok(/深度学习图像分割/.test(JSON.stringify(papers.items)), '5b.4 手动补的内容应被保存',
    JSON.stringify(papers.items));
  ok(after.sections.length === 2, '5b.5 模块总数不应变化', String(after.sections.length));
})();

/* 6. 应用时不能把「本次没识别到的模块」弄丢 */
{
  const win = makeEnv();
  const UI = win.ResumeUI, Store = win.ResumeStore;

  const seeded = Store.load();
  seeded.sections = [
    { id: 'education', title: '教育背景', sort: 'list', items: [{ title: '学历', text: '示例大学' }] },
    { id: 'custom-papers', title: '发表论文', sort: 'list', items: [{ title: '论文', text: '一篇' }] }
  ];
  Store.save(seeded);

  /* 只识别到教育背景 */
  UI._setReview({
    profile: { name: '新名字' },
    sections: [
      { id: 'education', title: '教育背景', sort: 'list', anchor: 'education', items: [{ title: '学历', text: '新的大学' }] }
    ],
    unparsed: [], warnings: []
  });
  UI._renderReviewForTest();
  UI._applyReviewForTest();

  const after = Store.load();
  const ids = after.sections.map(s => s.id).join(',');
  ok(after.sections.length === 2, '6.1 应用后模块数不应减少', String(after.sections.length));
  ok(ids === 'education,custom-papers', '6.2 顺序与模块都应保留', ids);
  const papers = after.sections.filter(s => s.id === 'custom-papers')[0];
  ok(!!papers && papers.items[0].text === '一篇', '6.3 自建模块内容应原样保留',
    papers ? JSON.stringify(papers.items) : '(丢了)');
  const edu = after.sections.filter(s => s.id === 'education')[0];
  ok(edu.items[0].text === '新的大学', '6.4 识别到的模块应被更新', edu.items[0].text);
  ok(after.profile.name === '新名字', '6.5 姓名也应更新', after.profile.name);
}

/* 7. 在面板里直接编辑「现有模块」的内容，应用后必须存下来
      （面板现在能看到全部模块，就得真的能改它们）
      注意：输入框的写回是防抖的（350ms），断言前必须等它落地。 */
console.log('\n-- 面板内编辑现有模块 --');
const panelEditDone = (async function () {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const win = makeEnv();
  const UI = win.ResumeUI, Store = win.ResumeStore;

  const seeded = Store.load();
  seeded.sections = [
    { id: 'education', title: '教育背景', sort: 'list', items: [{ title: '学历', text: '示例大学' }] },
    { id: 'custom-papers', title: '发表论文', sort: 'list', items: [{ title: '论文', text: '一篇' }] }
  ];
  Store.save(seeded);

  UI._setReview(null);                 /* 没有识别结果，纯看现有模块 */
  UI._renderReviewForTest();

  const paperGroup = UI._reviewGroups().filter(g =>
    g.descendants(n => n.className === 'group-title')[0].textContent.indexOf('发表论文') !== -1)[0];
  ok(!!paperGroup, '7.1 应能定位到自建模块分组');
  if (!paperGroup) return;

  const area = paperGroup._body.descendants(n => n.tagName === 'TEXTAREA')[0];
  ok(!!area, '7.2 自建模块应有可编辑输入框');
  if (!area) return;

  area.value = '深度学习图像分割 · 一作 · 2025';
  area.dispatch('input');

  /* 等防抖写回 state.review */
  await wait(500);

  const rv = UI._state.review;
  const inReview = rv && rv.sections.filter(s => s.id === 'custom-papers')[0];
  ok(!!inReview && /深度学习图像分割/.test(JSON.stringify(inReview.items)),
    '7.3 输入应写回面板数据（state.review）',
    inReview ? JSON.stringify(inReview.items) : '(无)');

  UI._applyReviewForTest();
  const after = Store.load();
  const papers = after.sections.filter(s => s.id === 'custom-papers')[0];

  ok(!!papers, '7.4 应用后自建模块仍应存在');
  ok(!!papers && /深度学习图像分割/.test(JSON.stringify(papers.items)),
    '7.5 面板里输入的改动应被保存到数据里',
    papers ? JSON.stringify(papers.items) : '(丢了)');
  ok(after.sections.length === 2, '7.6 其余模块不应受影响', String(after.sections.length));
  ok(after.sections.filter(s => s.id === 'education')[0].items[0].text === '示例大学',
    '7.7 没动过的模块内容应原样保留');
})();

/* 8. 在「设置 → 简历模块」里打字时不能重建列表
      —— 重建会把正在输入的输入框删掉，焦点丢失，表现成「打一半像有人按了回车」 */
console.log('\n-- 模块编辑器：打字不丢焦点 --');
const moduleTypingDone = (async function () {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const win = makeEnv();
  const UI = win.ResumeUI, Store = win.ResumeStore;

  /* 造一个时间线模块（「学校 / 单位」字段就在这种版式里） */
  const seeded = Store.load();
  seeded.sections = [
    { id: 'education', title: '教育背景', sort: 'timeline', anchor: 'education',
      items: [{ org: '示例大学', date: '2021.09 – 2025.06', degree: '本科 · 通信工程', location: '北京', bullets: ['主修课程'] }] }
  ];
  Store.save(seeded);

  UI._renderModuleManagerForTest();
  const list = win.document.getElementById('module-list');

  /* 找到「学校 / 单位」那个输入框（el() 第三个参数写的是 innerHTML） */
  let target = null;
  list.descendants(function (n) {
    const labelText = (n.innerHTML || n.textContent || '').trim();
    if (n.tagName === 'LABEL' && labelText === '学校 / 单位') {
      /* label 的下一个兄弟就是输入框 */
      const kids = n.parentElement.children;
      const idx = kids.indexOf(n);
      if (kids[idx + 1] && kids[idx + 1].tagName === 'INPUT') target = kids[idx + 1];
    }
    return false;
  });

  ok(!!target, '8.1 应能找到「学校 / 单位」输入框');
  if (!target) return;

  const originalNode = target;
  ok(originalNode.value === '示例大学', '8.2 输入框应预填当前值', originalNode.value);

  /* 模拟用户连续打字：每次输入后等防抖落地 */
  const typed = '北京a\'da\'d';
  originalNode.value = typed;
  originalNode.dispatch('input');
  await wait(500);

  /* 关键断言：节点必须还是同一个（没被重建），且值没被覆盖 */
  const stillThere = list.descendants(n => n === originalNode).length === 1;
  ok(stillThere, '8.3 打字后输入框节点不应被重建（重建会丢焦点）');

  const inputAfter = list.descendants(n =>
    n.tagName === 'INPUT' && n.value === typed)[0];
  ok(!!inputAfter, '8.4 输入的值应保留在同一个输入框里', 
    JSON.stringify(list.descendants(n => n.tagName === 'INPUT').map(n => n.value)));

  /* 值确实落盘了 */
  const saved = Store.load().sections[0].items[0].org;
  ok(saved === typed, '8.5 输入的值应写入 store', JSON.stringify(saved));

  /* 条目标题应就地更新，而不是靠重建 */
  const titleEl = list.descendants(n => n.className === 'module-item-title')[0];
  ok(titleEl && titleEl.textContent === typed, '8.6 条目标题应就地更新为新值',
    titleEl ? titleEl.textContent : '(无)');
})();

/* 9. 结构性操作（增删条目）仍然可以重建列表 */
{
  const win = makeEnv();
  const UI = win.ResumeUI, Store = win.ResumeStore;
  const seeded = Store.load();
  seeded.sections = [{ id: 'education', title: '教育背景', sort: 'timeline',
    items: [{ org: 'A', bullets: [] }, { org: 'B', bullets: [] }] }];
  Store.save(seeded);

  UI._renderModuleManagerForTest();
  const list = win.document.getElementById('module-list');
  const before = list.descendants(n => n.className === 'module-item').length;
  ok(before === 2, '9.1 应有 2 个条目', String(before));

  /* 点第一个条目的「删除这一条」（注意别点成模块级的「删除这个模块」） */
  const del = list.descendants(n => n.className && n.className.indexOf('module-btn is-danger') === 0
    && n.title === '删除这一条')[0];
  ok(!!del, '9.2 应能找到「删除这一条」按钮');
  if (del) {
    del.dispatch('click');
    const after = list.descendants(n => n.className === 'module-item').length;
    ok(after === 1, '9.3 删除一条后列表应重建为 1 条', String(after));
    const secAfter = Store.load().sections[0];
    ok(!!secAfter && secAfter.items.length === 1, '9.4 数据也应同步，模块本身还在',
      secAfter ? String(secAfter.items.length) : '(模块被删了)');
  }
}

Promise.resolve(panelEditDone)
  .then(function () { return unparsedEditDone; })
  .then(function () { return moduleTypingDone; })
  .then(function () {
    console.log('\n' + '═'.repeat(60));
    console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
    if (fail) { console.log('\n  失败明细：'); failures.forEach(f => console.log('   ✗ ' + f)); }
    console.log('═'.repeat(60) + '\n');
    process.exit(fail ? 1 : 0);
  });
