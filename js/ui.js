/* =============================================================================
 *  ui.js —— 交互控制：悬浮入口 / 识别抽屉 / 逐字段校对 / 实时预览 / 主题 / 导入导出
 * -----------------------------------------------------------------------------
 *  数据流：
 *    粘贴文本 ──(规则解析 或 大模型)──> Review ──逐字段勾选+编辑──> 草稿
 *                                                        │
 *                                            实时迷你预览 <┘
 *                                                        │
 *                                            点「应用」──> store 落盘 ──> 主页面重绘
 * ========================================================================== */
(function (global) {
  'use strict';

  var Store = global.ResumeStore;
  var Parser = global.ResumeParser;
  var Render = global.ResumeRender;
  var LLM = global.ResumeLLM;
  var Skills = global.ResumeSkills;
  var H = global.ResumeHelpers || {};

  /* ------------------------------------------------------------------ 元素 */
  var $ = function (id) { return document.getElementById(id); };

  /**
   * 建元素的小工具：el('div', 'cls', innerHTML)
   * render.js 里也有一份同名函数，但那是模块内部私有的，ui.js 拿不到，
   * 所以这里必须自己有一份（之前漏了，导致模块管理整体报 el is not defined）。
   */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  var els = {
    root: $('resume-root'),
    drawer: $('parser-drawer'),
    overlay: $('parser-overlay'),
    fab: $('parser-fab'),
    close: $('drawer-close'),
    themeToggle: $('theme-toggle'),
    rawInput: $('raw-input'),
    parseStatus: $('parse-status'),
    btnParse: $('btn-parse'),
    btnTemplate: $('btn-template'),
    btnSample: $('btn-sample'),
    btnLoadFile: $('btn-load-file'),
    fileInput: $('file-input'),
    reviewList: $('review-list'),
    btnSelectAll: $('btn-select-all'),
    btnSelectNone: $('btn-select-none'),
    btnExpandAll: $('btn-expand-all'),
    btnCollapseAll: $('btn-collapse-all'),
    btnApply: $('btn-apply'),
    btnUndo: $('btn-undo'),
    btnDiscard: $('btn-discard'),
    applyStatus: $('apply-status'),
    miniPreview: $('mini-preview'),
    miniBadge: $('mini-badge'),
    toast: $('toast'),
    /* 设置页 */
    llmEnabled: $('llm-enabled'),
    llmKey: $('llm-key'),
    llmBase: $('llm-base'),
    llmModel: $('llm-model'),
    llmTrigger: $('llm-trigger'),
    llmStatus: $('llm-status'),
    btnLLMClear: $('btn-llm-clear'),
    btnLLMTest: $('btn-llm-test'),
    btnExport: $('btn-export'),
    btnImport: $('btn-import'),
    importInput: $('import-input'),
    btnReset: $('btn-reset'),
    dataStatus: $('data-status'),
    /* 背景特效 */
    effectGrid: $('effect-grid'),
    bgDensity: $('bg-density'),
    bgDensityValue: $('bg-density-value'),
    btnBgReset: $('btn-bg-reset'),
    bgStatus: $('bg-status'),
    /* 头像 */
    avatarPreview: $('avatar-preview'),
    avatarInput: $('avatar-input'),
    btnAvatarPick: $('btn-avatar-pick'),
    btnAvatarClear: $('btn-avatar-clear'),
    avatarInfo: $('avatar-info'),
    avatarStatus: $('avatar-status'),
    avatarNudge: $('avatar-nudge'),
    avatarNudgeRow: $('avatar-nudge-row'),
    avatarNudgeValue: $('avatar-nudge-value'),
    /* 模块管理 */
    moduleList: $('module-list'),
    newModuleTitle: $('new-module-title'),
    newModuleHint: $('new-module-hint'),
    btnAddModule: $('btn-add-module'),
    moduleStatus: $('module-status')
  };

  /* ------------------------------------------------------------------ 状态 */
  var state = {
    review: null,        /* 当前识别结果（值可能是字符串/数组/对象） */
    checked: {},         /* path -> boolean，默认全选 */
    draft: null,         /* 用于实时预览的数据副本 */
    replaceSections: true,
    busy: 0,
    lastFocus: null
  };

  /* ================================================================ 小工具 */

  var toastTimer = null;
  function toast(msg, ms) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.hidden = false;
    /* 强制重排以便过渡生效 */
    void els.toast.offsetWidth;
    els.toast.classList.add('is-open');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('is-open');
      setTimeout(function () { els.toast.hidden = true; }, 280);
    }, ms || 2600);
  }

  function setBusy(on, text) {
    state.busy += on ? 1 : -1;
    if (state.busy < 0) state.busy = 0;
    var busy = state.busy > 0;
    if (els.btnParse) {
      els.btnParse.disabled = busy;
      els.btnParse.textContent = busy ? (text || '识别中…') : '';
      if (!busy) {
        els.btnParse.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" class="btn-icon"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>一键识别';
      }
    }
  }

  function status(node, text, kind) {
    if (!node) return;
    node.textContent = text || '';
    node.dataset.state = kind || 'idle';
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function clone(v) { return Store.deepClone(v); }

  function escapeHtml(s) { return Render.esc(s); }

  /* ====================================================== 文本 ⇄ 值 的互转 */

  var SEP = '·';                 /* 标签与内容的分隔符，避开正文里的中文冒号 */
  var BULLET = /^\s*[-–—•·*]\s*/;

  function joinAddr(o) {
    return [o.org || '', o.date || '', o.degree || o.title || '', o.location || ''].join(' | ');
  }

  function parseAddr(line) {
    var parts = line.split(/[|｜\t]+/).map(function (s) { return s.trim(); });
    var o = { org: parts[0] || '', date: parts[1] || '', location: parts[3] || '', logo: '' };
    var mid = parts[2] || '';
    if (mid) { o.degree = mid; o.title = mid; }
    else { o.degree = ''; o.title = ''; }
    return o;
  }

  function blocksToText(blocks) {
    return (blocks || []).map(function (b) {
      var label = (b.label || '').trim();
      var text = (b.text || '').trim();
      if (label && text) return label + SEP + ' ' + text;
      return label || text;
    }).join('\n');
  }

  function textToBlocks(text) {
    return String(text || '').split('\n').map(function (line) {
      var l = line.replace(BULLET, '').trim();
      if (!l) return null;
      var i = l.indexOf(SEP);
      if (i === -1) return { label: '', text: l };
      return { label: l.slice(0, i).trim(), text: l.slice(i + 1).trim() };
    }).filter(Boolean);
  }

  function itemListToText(items, kind) {
    if (kind === 'line') return (items || []).map(function (s) { return String(s); }).join('\n');
    if (kind === 'kv') {
      return (items || []).map(function (o) { return (o.label || '') + SEP + ' ' + (o.value || ''); }).join('\n');
    }
    if (kind === 'kvtitle') {
      return (items || []).map(function (o) {
        return o.title ? (o.title + SEP + ' ' + (o.text || '')) : (o.text || '');
      }).join('\n');
    }
    if (kind === 'addr') {
      return (items || []).map(function (o) {
        var head = joinAddr(o);
        var bullets = (o.bullets || []).map(function (b) { return '- ' + b; });
        return [head].concat(bullets).join('\n');
      }).join('\n');
    }
    if (kind === 'card') {
      return (items || []).map(function (o) {
        var head = joinAddr(o);
        var blocks = (o.blocks || []).map(function (b) {
          return b.label ? ('- ' + b.label + SEP + ' ' + (b.text || '')) : ('- ' + (b.text || ''));
        });
        return [head].concat(blocks).join('\n');
      }).join('\n');
    }
    if (kind === 'taggroup') {
      return (items || []).map(function (g) {
        return (g.title || '技能') + '：' + (g.items || []).map(function (t) { return t.text; }).join('、');
      }).join('\n');
    }
    return '';
  }

  function textToItemList(text, kind) {
    var lines = String(text || '').split('\n').map(function (s) { return s.replace(/\s+$/, ''); });

    if (kind === 'line') {
      return lines.map(function (s) { return s.trim(); }).filter(Boolean);
    }

    if (kind === 'kv') {
      return lines.map(function (l) {
        var t = l.trim();
        if (!t) return null;
        var i = t.indexOf(SEP);
        if (i === -1) i = t.search(/[:：]/);
        if (i === -1) return { label: '其他', value: t };
        return { label: t.slice(0, i).replace(/[:：]\s*$/, '').trim(), value: t.slice(i + 1).trim() };
      }).filter(function (o) { return o && (o.label || o.value); });
    }

    if (kind === 'kvtitle') {
      return lines.map(function (l) {
        var t = l.trim();
        if (!t) return null;
        var i = t.indexOf(SEP);
        if (i === -1) return { title: '', text: t };
        return { title: t.slice(0, i).trim(), text: t.slice(i + 1).trim() };
      }).filter(Boolean);
    }

    if (kind === 'addr' || kind === 'card') {
      var out = [];
      var cur = null;
      lines.forEach(function (l) {
        var t = l.trim();
        if (!t) return;
        var isBullet = BULLET.test(t);
        if (!isBullet) {
          cur = parseAddr(t.replace(BULLET, ''));
          if (kind === 'addr') cur.bullets = [];
          else cur.blocks = [];
          out.push(cur);
          return;
        }
        var body = t.replace(BULLET, '').trim();
        if (!cur) {
          cur = parseAddr('');
          if (kind === 'addr') cur.bullets = []; else cur.blocks = [];
          out.push(cur);
        }
        if (kind === 'addr') cur.bullets.push(body);
        else {
          var i2 = body.indexOf(SEP);
          if (i2 === -1) cur.blocks.push({ label: '', text: body });
          else cur.blocks.push({ label: body.slice(0, i2).trim(), text: body.slice(i2 + 1).trim() });
        }
      });
      return out;
    }

    if (kind === 'taggroup') {
      return lines.map(function (l) {
        var t = l.trim();
        if (!t) return null;
        var i = t.search(/[:：]/);
        var title = i === -1 ? '技能' : t.slice(0, i).trim();
        var body = i === -1 ? t : t.slice(i + 1);
        var items = Skills && Skills.extractTags ? Skills.extractTags(body)
          : body.split(/[、,，\/]+/).map(function (x) { return { text: x.trim(), level: 'aux' }; });
        items = items.filter(function (x) { return x.text; });
        return items.length ? { title: title || '技能', items: items } : null;
      }).filter(Boolean);
    }

    return [];
  }

  /* ================================================== 字段 → 渲染与取值映射 */

  /**
   * 为一个字段决定：编辑框类型、取值、把文本写回值
   * path 形如 profile.name / scores.items / section.education.items
   */
  function fieldMeta(path, section) {
    if (path === 'profile.contacts') return { kind: 'kv', multi: true, hint: '每行一条：标签 · 内容，例：电话 · 13800000000' };
    if (path === 'profile.avatar') return { kind: 'text', multi: false, hint: '想换照片：设置 → 头像 → 选择照片。也可以在这里填图片地址' };
    if (path === 'scores.items') return { kind: 'kv', multi: true, hint: '每行一条：项目 · 分数，例：数学 · 95' };
    if (!section) return { kind: 'text', multi: false };

    switch (section.sort) {
      case 'timeline':
        return {
          kind: 'addr', multi: true,
          hint: '每行一个学历：学校 | 日期 | 学历（专业） | 城市；下一行以 - 开头写要点，例：- 主修课程：管理学、统计学'
        };
      case 'cards':
        return {
          kind: 'card', multi: true,
          hint: '每行一个项目：项目名 | 日期 | 角色 | 地点；下一行以 - 开头写小块，例：- 技术实现· 用了什么技术做了什么'
        };
      case 'tags':
        return {
          kind: 'taggroup', multi: true,
          hint: '每行一组：分组名：技能一、技能二、技能三'
        };
      default:
        return {
          kind: 'kvtitle', multi: true,
          hint: '每行一条：小标题 · 内容（没有小标题就只写内容）'
        };
    }
  }

  function valueToText(path, value, section) {
    var meta = fieldMeta(path, section);
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (value == null) return '';
    if (Array.isArray(value)) return itemListToText(value, meta.kind);
    if (typeof value === 'object') {
      if (value.blocks) return blocksToText(value.blocks);
      return value.text || value.value || '';
    }
    return String(value);
  }

  function textToValue(text, path, section, currentValue) {
    var meta = fieldMeta(path, section);
    if (!meta.multi) {
      if (typeof currentValue === 'number') {
        var n = Number(String(text).trim());
        return isNaN(n) ? text : n;
      }
      return text;
    }
    return textToItemList(text, meta.kind);
  }

  /* ==================================================== 识别结果 → UI 渲染 */

  /** 合并「现有区块」与「本次识别区块」：优先走 helpers 里那份带测试的实现 */
  function mergeSections(existing, parsed) {
    if (H.mergeSections) return H.mergeSections(existing, parsed);
    return (parsed || []).map(function (s) { return { section: s, fromParse: true }; });
  }

  function sectionTitleOf(id) {
    var map = {
      education: '教育背景', projects: '项目经历', engineering: '工程设计',
      skills: '相关技能', research: '研究兴趣与复试方向', abilities: '综合能力',
      work: '工作经历', internships: '实习经历', awards: '荣誉奖项',
      papers: '论文与专利', campus: '校园经历', others: '其他经历'
    };
    return map[id] || id;
  }

  function isChecked(path) { return state.checked[path] !== false; }

  function setChecked(path, on) {
    state.checked[path] = !!on;
    syncGroupCheckbox(path);
    updateApplyState();
  }

  function groupOfPath(path) {
    return path.indexOf('section.') === 0 ? path.split('.').slice(0, 2).join('.') : '__head';
  }

  function syncGroupCheckbox(path) {
    var g = groupOfPath(path);
    var box = els.reviewList && els.reviewList.querySelector('[data-group="' + g + '"]');
    if (!box) return;
    var paths = Object.keys(state.checked).filter(function (p) { return groupOfPath(p) === g; });
    var on = paths.filter(isChecked).length;
    box.checked = on > 0;
    box.indeterminate = on > 0 && on < paths.length;
    refreshGroups();
  }

  function updateApplyState() {
    if (!els.btnApply) return;
    var anySection = Object.keys(state.checked).some(function (p) {
      return p.indexOf('section.') === 0 && isChecked(p);
    });
    var anyHead = ['profile.name', 'profile.headline', 'profile.intent', 'profile.contacts', 'scores']
      .some(function (p) { return state.checked[p] !== undefined && isChecked(p); });
    /* 面板现在会列出「当前简历的全部模块」，所以没粘贴识别结果时也能直接应用修改 */
    els.btnApply.disabled = !anySection && !anyHead;
  }

  /** 由当前数据合成一份「识别结果」形状的对象，供面板在没有识别结果时使用 */
  function reviewFromCurrent() {
    var cur = Store.load();
    return {
      profile: {
        name: (cur.profile && cur.profile.name) || '',
        headline: (cur.profile && cur.profile.headline) || '',
        intent: (cur.profile && cur.profile.intent) || '',
        contacts: (cur.profile && cur.profile.contacts) || []
      },
      sections: cur.sections || [],
      scores: cur.scores || null,
      unparsed: [],
      warnings: [],
      _fromCurrent: true
    };
  }

  /**
   * 取面板要显示的数据。没有识别结果时，用当前数据合成一份，
   * 并且**缓存进 state.review** —— 这一点很关键：
   * 面板编辑的是 state.review 上的对象，如果每次调用都重新合成一份，
   * 用户改的就是一个临时副本，点「应用」时会读到另一份没改过的数据，改动会凭空消失。
   */
  function ensureReview() {
    if (!state.review) state.review = reviewFromCurrent();
    return state.review;
  }

  /**
   * 面板显示的识别结果。没有识别结果时，回落到「当前简历」本身 ——
   * 这样不粘贴也能直接进来校对 / 修改已有内容（含设置里新建的模块）。
   */
  function reviewSource() {
    return ensureReview();
  }

  /** 造一条面板说明（用节点拼，不用 innerHTML，便于测试与后续插入高亮） */
  function noteLine(parts) {
    var n = document.createElement('div');
    n.className = 'review-note';
    var plain = '';
    parts.forEach(function (p) {
      if (typeof p === 'string') {
        plain += p;
      } else {
        var b = document.createElement('b');
        b.textContent = p.b;
        n.appendChild(b);
        plain += p.b;
      }
    });
    /* 同时维护纯文本：读屏软件读的是它，测试也用它 */
    n.textContent = plain;
    return n;
  }

  function renderReview() {
    if (!els.reviewList) return;
    els.reviewList.innerHTML = '';
    state.checked = {};

    var rev = ensureReview();

    /* 能看到全部模块这件事本身需要说明一下，否则容易被误会成「识别错了」 */
    els.reviewList.appendChild(rev._fromCurrent
      ? noteLine([
          '当前显示的是', { b: '简历里已有的全部内容' },
          '。可以直接在这里修改，改完点「应用到简历」。' +
          '也可以在上面粘贴新文本后点「一键识别」来覆盖对应模块。'
        ])
      : noteLine([
          '列出了', { b: '全部模块' },
          '：带「现有模块（本次未识别到）」标记的那些不会被这次识别改动，' +
          '但仍可在这里就地编辑。只有勾选的才会应用。'
        ]));

    /* ---------- 头部信息组 ---------- */
    var headFields = [];
    headFields.push({ path: 'profile.name', label: '姓名', value: rev.profile.name });
    headFields.push({ path: 'profile.headline', label: '身份', value: rev.profile.headline });
    headFields.push({ path: 'profile.intent', label: '报考/求职意向', value: rev.profile.intent });
    headFields.push({ path: 'profile.contacts', label: '联系方式', value: rev.profile.contacts });
    /* 头像识别器抽不到（文本里没有图片），但给它一个可编辑入口：
       想换照片请到「设置 → 头像」上传，这里也接受直接填图片地址 */
    headFields.push({
      path: 'profile.avatar',
      label: '头像',
      value: (state.draft && state.draft.profile && state.draft.profile.avatar) || ''
    });

    var headGroup = buildGroup('__head', '基本信息', headFields, null);
    headGroup._toggle(true);                       /* 第一组默认展开 */
    els.reviewList.appendChild(headGroup);

    /* ---------- 成绩 / 评级组（可选：求职简历通常没有这一段） ---------- */
    if (rev.scores && ((rev.scores.items && rev.scores.items.length) || (rev.scores.total && rev.scores.total.value))) {
      var sfields = [{ path: 'scores.total', label: '总分', value: (rev.scores.total && rev.scores.total.value) || '' }];
      if (rev.scores.items && rev.scores.items.length) sfields.push({ path: 'scores.items', label: '各项', value: rev.scores.items });
      els.reviewList.appendChild(buildGroup('__scores', rev.scores.title || '成绩 / 评级', sfields, null));
    }

    /* ---------- 各内容区块 ----------
       这里显示简历的**全部**模块：本次识别出来的 + 简历里已有但这次没识别到的。
       后者不会因为一次无关的粘贴而消失，也应该能在这里就地校对，
       所以按「现有顺序为基准」合并后一起列出。
       没有识别结果时（rev 来自当前数据），parsed 传空数组即可，
       合并结果就是现有的全部模块。 */
    var parsedSections = rev._fromCurrent ? [] : rev.sections;
    mergeSections(Store.load().sections, parsedSections).forEach(function (entry) {
      var sec = entry.section;
      var path = 'section.' + sec.id;
      var fields = [];
      if (sec.sort === 'tags') {
        fields.push({ path: path, label: '技能标签', value: sec.groups });
      } else {
        fields.push({ path: path, label: '内容', value: sec.items });
      }
      var title = (sec.title || sectionTitleOf(sec.id));
      var tag = entry.fromParse
        ? (sec.src === 'inferred' ? '· 自动分段' : sec.src === 'llm' ? '· 大模型' : '')
        : '· 现有模块（本次未识别到）';
      els.reviewList.appendChild(buildGroup(path, title + ' ' + tag, fields, sec, !entry.fromParse));
    });

    /* ---------- 未归类文本 ---------- */
    if (rev.unparsed && rev.unparsed.length) {
      var ubox = document.createElement('div');
      ubox.className = 'review-group is-collapsed';
      ubox.innerHTML =
        '<div class="review-group-head">' +
        '<span class="group-head-text"><span class="group-title">未归类的文本</span>' +
        '<span class="group-summary">' + rev.unparsed.length + ' 段 · 需要手动处理</span></span></div>' +
        '<div class="review-fields"><textarea class="field-input" readonly rows="' +
        Math.min(8, rev.unparsed.length + 1) + '">' +
        escapeHtml(rev.unparsed.join('\n')) + '</textarea></div>';
      els.reviewList.appendChild(ubox);
    }

    /* ---------- 提示 ---------- */
    if (rev.warnings && rev.warnings.length) {
      var wbox = document.createElement('div');
      wbox.className = 'review-group';
      wbox.innerHTML = '<div class="review-group-head"><span class="group-title">提示</span></div>' +
        '<div class="review-fields">' + rev.warnings.map(function (w) {
          return '<div class="field-warn">' + escapeHtml(w) + '</div>';
        }).join('') + '</div>';
      els.reviewList.appendChild(wbox);
    }

    Object.keys(state.checked).forEach(syncGroupCheckbox);
    updateApplyState();
  }

  function emptyState(text) {
    var d = document.createElement('div');
    d.className = 'empty-state';
    d.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7"/></svg><p>' +
      escapeHtml(text) + '</p>';
    return d;
  }

  /* 一个可折叠的分组卡片：头部一行放「勾选框 + 标题 + 摘要」，避免标题被挤成竖排 */
  function buildGroup(groupPath, title, fields, section, isExisting) {
    var group = document.createElement('div');
    group.className = 'review-group';
    /* 现有模块（本次没识别到）打个标记，一是便于区分，二是让测试能断言 */
    if (isExisting) group.classList.add('is-existing');
    group.dataset.groupPath = groupPath;

    var filled = fields.filter(function (f) { return hasValue(f.value); }).length;
    var missing = fields.length - filled;

    var head = document.createElement('div');
    head.className = 'review-group-head';

    var box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'check';
    box.checked = true;
    box.dataset.group = groupPath;
    box.title = '整组全选 / 全不选';
    head.appendChild(box);

    var textWrap = document.createElement('div');
    textWrap.className = 'group-head-text';

    var t = document.createElement('span');
    t.className = 'group-title';
    t.textContent = title;
    textWrap.appendChild(t);

    var summary = document.createElement('span');
    summary.className = 'group-summary';
    textWrap.appendChild(summary);
    head.appendChild(textWrap);

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'group-toggle';
    toggle.setAttribute('aria-label', '展开 / 收起这一组');
    toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>';
    head.appendChild(toggle);

    /* 头部整行可点：点空白处展开/收起（勾选框和它自己的点击另算） */
    head.addEventListener('click', function (e) {
      if (e.target === box) return;
      toggleGroup();
    });

    var body = document.createElement('div');
    body.className = 'review-fields';

    fields.forEach(function (f) {
      body.appendChild(buildField(f, section));
    });

    function refreshSummary() {
      var ok = fields.filter(function (f) { return hasValue(f.value); }).length;
      var chosen = fields.filter(function (f) { return state.checked[f.path] !== false; }).length;
      var parts = [];
      if (chosen === 0) parts.push('不应用');
      else if (chosen < fields.length) parts.push('应用 ' + chosen + '/' + fields.length + ' 项');
      else parts.push('应用全部 ' + fields.length + ' 项');
      if (fields.length - ok > 0) parts.push('缺 ' + (fields.length - ok) + ' 项');
      summary.textContent = parts.join(' · ');
      group.classList.toggle('is-fully-checked', chosen === fields.length);
      group.classList.toggle('is-unchecked', chosen === 0);
    }

    function toggleGroup(force) {
      var open = force === undefined ? group.classList.contains('is-collapsed') : !!force;
      group.classList.toggle('is-collapsed', !open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    toggleGroup(false);
    group.appendChild(head);
    group.appendChild(body);
    group._refresh = refreshSummary;
    group._toggle = toggleGroup;
    group._fields = fields;
    group._body = body;

    box.addEventListener('change', function () {
      fields.forEach(function (f) { state.checked[f.path] = box.checked; });
      Array.prototype.forEach.call(body.querySelectorAll('.check[data-path]'), function (n) {
        n.checked = box.checked;
      });
      Array.prototype.forEach.call(body.querySelectorAll('.review-field'), function (n) {
        n.classList.toggle('is-missing', box.checked === false && !n.dataset.filled);
      });
      refreshSummary();
      updateApplyState();
      rebuildDraft();
    });

    refreshSummary();
    return group;
  }

  function buildField(field, section) {
    var meta = fieldMeta(field.path, section);
    var text = valueToText(field.path, field.value, section);
    var filled = hasValue(field.value);
    state.checked[field.path] = true;

    var row = document.createElement('div');
    row.className = 'review-field' + (filled ? '' : ' is-missing');
    row.dataset.path = field.path;
    row.dataset.filled = filled ? '1' : '';

    /* 第一行：勾选框 + 字段名（占满整行宽度） */
    var headRow = document.createElement('div');
    headRow.className = 'field-head';

    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'check';
    cb.checked = true;
    cb.dataset.path = field.path;
    cb.title = '是否应用这一项';
    headRow.appendChild(cb);

    var lab = document.createElement('label');
    lab.className = 'field-label';
    lab.textContent = field.label;
    headRow.appendChild(lab);

    var badge = document.createElement('span');
    badge.className = 'field-badge';
    badge.textContent = filled ? '已识别' : '未识别到';
    headRow.appendChild(badge);

    row.appendChild(headRow);

    /* 第二行：输入框铺满整行，给宽度 */
    var input = document.createElement('textarea');
    input.className = 'field-input';
    input.rows = estimateRows(text, meta.multi);
    input.placeholder = meta.hint || '';
    input.value = text;
    input.dataset.path = field.path;
    input.dataset.kind = meta.kind;
    input.spellcheck = false;
    row.appendChild(input);

    if (meta.hint) {
      var hint = document.createElement('div');
      hint.className = 'field-hint';
      hint.textContent = meta.hint;
      row.appendChild(hint);
    }

    cb.addEventListener('change', function () {
      setChecked(field.path, cb.checked);
      row.classList.toggle('is-missing', !cb.checked && !filled);
      refreshGroups();
      rebuildDraft();
    });

    input.addEventListener('input', debounce(function () {
      var v = textToValue(input.value, field.path, section, field.value);
      setPath(state.review, field.path, v, section);
      if (input.value.trim() && !cb.checked) {
        cb.checked = true;
        setChecked(field.path, true);
      }
      if (input.value.trim()) {
        row.classList.remove('is-missing');
        row.dataset.filled = '1';
        field.value = v;
        var badge = row.querySelector('.field-badge');
        if (badge) badge.textContent = '已识别';
        refreshGroups();
      }
      rebuildDraft();
    }, 320));

    return row;
  }

  function hasValue(v) {
    if (v == null) return false;
    if (typeof v === 'string') return !!v.trim();
    if (Array.isArray(v)) {
      return v.some(function (x) {
        if (typeof x === 'string') return !!x.trim();
        if (!x) return false;
        if (x.items) return x.items.length > 0;
        if (x.blocks) return x.blocks.length > 0;
        if (x.bullets) return true;
        return !!(x.text || x.value || x.org || x.label);
      });
    }
    if (typeof v === 'object') return !!(v.value || v.text || (v.total && v.total.value));
    return true;
  }

  /** 估算文本框行数：中文按每行约 34 字算，夹在 3~12 行之间 */
  function estimateRows(text, multi) {
    var s = String(text == null ? '' : text);
    var lines = s.split('\n');
    var rows = 0;
    for (var i = 0; i < lines.length; i++) {
      rows += Math.max(1, Math.ceil(lines[i].length / 34));
    }
    var min = multi ? 3 : 2;
    return Math.max(min, Math.min(12, rows));
  }

  /** 分组头部的摘要需要跟着勾选状态刷新 */
  function refreshGroups() {
    if (!els.reviewList) return;
    Array.prototype.forEach.call(els.reviewList.querySelectorAll('.review-group'), function (g) {
      if (typeof g._refresh === 'function') g._refresh();
    });
  }

  /* 把值写回 review 对象（路径可能是 profile.name / scores.total / section.xxx） */
  function setPath(obj, path, value, section) {
    if (path.indexOf('section.') === 0) {
      var id = path.slice(8);
      var sec = obj.sections.filter(function (s) { return s.id === id; })[0];
      if (sec) {
        if (sec.sort === 'tags') sec.groups = value;
        else sec.items = value;
      }
      return;
    }
    if (path === 'scores.total') {
      if (!obj.scores) obj.scores = { title: '成绩', total: { label: '总分', value: '' }, items: [] };
      if (!obj.scores.total) obj.scores.total = { label: '总分', value: '' };
      obj.scores.total.value = value;
      return;
    }
    if (path === 'scores.items') {
      if (!obj.scores) obj.scores = { title: '成绩', total: { label: '总分', value: '' }, items: [] };
      obj.scores.items = value;
      return;
    }
    Store.setByPath(obj, path, value);
  }

  /* ============================================================ 草稿与预览 */

  function rebuildDraft() {
    var base = Store.load();
    var draft = clone(base);

    if (state.review) {
      var rev = state.review;

      if (isChecked('profile.name') && rev.profile.name) draft.profile.name = rev.profile.name;
      if (isChecked('profile.headline') && rev.profile.headline) draft.profile.headline = rev.profile.headline;
      if (isChecked('profile.intent') && rev.profile.intent) draft.profile.intent = rev.profile.intent;
      if (isChecked('profile.contacts') && rev.profile.contacts && rev.profile.contacts.length) {
        draft.profile.contacts = clone(rev.profile.contacts);
      }
      if (isChecked('scores') && rev.scores) draft.scores = clone(rev.scores);

      var parsedIds = {};
      var accepted = [];
      rev.sections.forEach(function (sec) {
        if (!isChecked('section.' + sec.id)) return;
        var n = (sec.items && sec.items.length) || (sec.groups && sec.groups.length) || 0;
        if (!n) return;
        parsedIds[sec.id] = 1;
        accepted.push(toSection(sec));
      });

      var kept = (draft.sections || []).filter(function (s) { return !parsedIds[s.id]; });
      draft.sections = accepted.concat(kept);
    }

    state.draft = draft;
    renderMini();
    updateMiniBadge();
  }

  function toSection(sec) {
    var out = { id: sec.id, title: sec.title, anchor: sec.anchor || sec.id, sort: sec.sort };
    if (sec.sort === 'tags') out.groups = clone(sec.groups);
    else out.items = clone(sec.items);
    return out;
  }

  var renderMini = debounce(function () {
    if (!state.draft || !els.miniPreview) return;
    Render.renderMini(els.miniPreview, state.draft);
    els.miniPreview.style.visibility = '';
  }, 220);

  function updateMiniBadge() {
    if (!els.miniBadge) return;
    var n = Object.keys(state.checked).filter(function (p) {
      return state.checked[p] && state.review;
    }).length;
    if (state.review && n) {
      els.miniBadge.textContent = '预览：应用 ' + n + ' 项后';
      els.miniBadge.classList.add('is-dirty');
    } else {
      els.miniBadge.textContent = '当前数据';
      els.miniBadge.classList.remove('is-dirty');
    }
  }

  /* ================================================================== 应用 */

  function applyReview() {
    var rev = reviewSource();
    var before = Store.load();
    var next = clone(before);
    var applied = 0;

    /* 面板渲染时列出的是合并结果（现有 + 本次识别）。
       用户可能在面板里改了「本次没识别到」的模块 —— 那些改动写在 state.review 上，
       所以要先按 id 取回面板里的版本，否则会把改动丢掉、写回旧数据。
       没有识别结果时 state.review 就是当前数据的副本，取回它同样正确。 */
    var panelById = {};
    (rev.sections || []).forEach(function (s) { if (s && s.id) panelById[s.id] = s; });
    function panelView(s) { return (s && panelById[s.id]) || s; }

    if (isChecked('profile.name') && rev.profile.name && rev.profile.name !== before.profile.name) {
      next.profile.name = rev.profile.name; applied++;
    }
    if (isChecked('profile.headline') && rev.profile.headline) { next.profile.headline = rev.profile.headline; applied++; }
    if (isChecked('profile.intent') && rev.profile.intent) { next.profile.intent = rev.profile.intent; applied++; }
    if (isChecked('profile.contacts') && rev.profile.contacts && rev.profile.contacts.length) {
      next.profile.contacts = clone(rev.profile.contacts); applied++;
    }
    if (isChecked('scores') && rev.scores) { next.scores = clone(rev.scores); applied++; }

    /* 面板里列出的是「全部模块」（现有 + 本次识别），所以这里也按合并后的列表走。
       未勾选的区块保持原样不动 —— 一次无关的粘贴不会把已有模块弄丢。
       未识别到、但已勾选的现有模块也会一并写回，这样在面板里就地补的内容能存下来。 */
    var accepted = [];
    var parsedForApply = rev._fromCurrent ? [] : rev.sections;
    mergeSections(before.sections, parsedForApply).forEach(function (entry) {
      var sec = entry.section;
      if (!isChecked('section.' + sec.id)) return;
      if (!entry.fromParse) {
        /* 现有模块：取面板里的版本（内容可能已就地编辑过） */
        accepted.push(toSection(panelView(sec)));
        applied++;
        return;
      }
      var n = (sec.items && sec.items.length) || (sec.groups && sec.groups.length) || 0;
      if (!n) return;
      /* 识别到的模块同样取面板版本：用户在面板里改过的才是最终内容 */
      accepted.push(toSection(panelView(sec)));
      applied++;
    });

    if (!applied) {
      status(els.applyStatus, '没有勾选任何内容', 'err');
      els.applyStatus.classList.remove('is-ok');
      els.applyStatus.classList.add('is-err');
      return;
    }

    if (state.replaceSections && accepted.length) {
      next.sections = accepted;
    } else if (accepted.length) {
      var byId = {};
      accepted.forEach(function (s) { byId[s.id] = s; });
      var merged = (next.sections || []).map(function (s) { return byId[s.id] || s; });
      accepted.forEach(function (s) {
        if (!merged.some(function (m) { return m.id === s.id; })) merged.push(s);
      });
      next.sections = merged;
    }

    Store.save(next);
    Store.pushUndo(before);

    renderMain();
    status(els.applyStatus, '已应用 ' + applied + ' 项修改到简历', 'ok');
    els.applyStatus.classList.add('is-ok');
    els.applyStatus.classList.remove('is-err');
    if (els.btnUndo) els.btnUndo.disabled = false;
    toast('已应用到简历（可撤销）');
  }

  function renderMain() {
    if (!els.root) return;
    Render.renderInto(els.root, Store.load(), { animate: true });
    initScrollSpy();
  }

  /* ============================================================ 识别主流程 */

  function decideLLM(cfg, ruleReview) {
    if (!cfg.enabled || !cfg.apiKey) return false;
    if (cfg.trigger === 'always') return true;
    if (cfg.trigger === 'manual') return false;
    /* fallback：规则识别结果不好 or 走的是自由文本降级 */
    if (!ruleReview) return true;
    return ruleReview.mode === 'freeform' || (ruleReview.quality && ruleReview.quality.score < 75);
  }

  function runParse(forceLLM) {
    var text = els.rawInput ? els.rawInput.value : '';
    if (!text.trim()) {
      status(els.parseStatus, '请先粘贴简历文本', 'warn');
      toast('还没有粘贴内容');
      if (els.rawInput) els.rawInput.focus();
      return;
    }

    var cfg = Store.getLLM();
    var useLLM = forceLLM || decideLLM(cfg, null);

    /* 先跑本地规则解析（快、免费），同时也作为大模型失败时的兜底 */
    var ruleReview = null;
    try {
      ruleReview = Parser.parse(text);
    } catch (e) {
      console.error(e);
      status(els.parseStatus, '本地解析出错：' + e.message, 'err');
    }

    if (!useLLM) {
      if (!ruleReview) return;
      acceptReview(ruleReview, '本地规则解析');
      return;
    }

    setBusy(true, '大模型识别中…');
    status(els.parseStatus, '正在调用 ' + cfg.model + ' 解析…', 'warn');
    LLM.parseWithLLM(text, cfg).then(function (rev) {
      acceptReview(rev, '大模型解析' + (rev.elapsed ? '（' + (rev.elapsed / 1000).toFixed(1) + 's）' : ''));
    }).catch(function (err) {
      console.warn('[llm]', err);
      if (ruleReview) {
        acceptReview(ruleReview, '大模型失败，已回退本地解析');
        status(els.parseStatus, '大模型调用失败：' + err.message + '；已改用本地规则解析', 'warn');
      } else {
        status(els.parseStatus, '大模型调用失败：' + err.message, 'err');
      }
    }).finally(function () {
      setBusy(false);
    });
  }

  function acceptReview(rev, via) {
    state.review = rev;
    renderReview();
    rebuildDraft();
    if (els.miniPreview) els.miniPreview.style.visibility = '';
    var q = rev.quality || { score: 0, label: '' };
    var counts = rev.sections.map(function (s) {
      var n = (s.items && s.items.length) || (s.groups && s.groups.length) || 0;
      return (s.title || s.id) + ' ' + n;
    }).join(' / ');
    status(els.parseStatus, via + '：' + q.label + '（完整度 ' + q.score + '%）· ' + counts,
      q.score >= 75 ? 'ok' : 'warn');
    toast('识别完成，共 ' + rev.sections.length + ' 个区块待确认');
  }

  /* ================================================================ 抽屉 */

  function openDrawer() {
    if (!els.drawer) return;
    state.lastFocus = document.activeElement;
    els.drawer.hidden = false;
    if (els.overlay) els.overlay.hidden = false;
    void els.drawer.offsetWidth;
    els.drawer.classList.add('is-open');
    if (els.overlay) els.overlay.classList.add('is-open');
    if (els.fab) els.fab.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';

    /* 首次打开：预填模板 + 渲染预览 */
    if (els.rawInput && !els.rawInput.value.trim()) els.rawInput.value = Parser.TEMPLATE;
    if (!state.draft) state.draft = Store.load();
    renderMini();
    setTimeout(function () {
      if (global.ResumeRender && els.miniPreview) {
        global.ResumeRender.fitMini(els.miniPreview, els.miniPreview.firstElementChild);
      }
    }, 60);
  }

  function closeDrawer() {
    if (!els.drawer || els.drawer.hidden) return;
    els.drawer.classList.remove('is-open');
    if (els.overlay) els.overlay.classList.remove('is-open');
    if (els.fab) els.fab.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    setTimeout(function () {
      els.drawer.hidden = true;
      if (els.overlay) els.overlay.hidden = true;
    }, 340);
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  }

  /* ================================================================ 主题 */

  function setTheme(theme, manual) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-theme-source', manual ? 'manual' : 'system');
    if (manual) Store.setThemePref(theme);
    if (global.ResumeParticles) global.ResumeParticles.redraw();
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  /* ============================================================ 滚动高亮 */

  var spyObserver = null;
  function initScrollSpy() {
    var nav = document.querySelector('.section-nav');
    if (!nav || !('IntersectionObserver' in window)) return;
    if (spyObserver) spyObserver.disconnect();

    var pills = {};
    Array.prototype.forEach.call(nav.querySelectorAll('.nav-pill'), function (a) {
      pills[a.getAttribute('href').slice(1)] = a;
    });

    spyObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var a = pills[e.target.id];
        if (!a) return;
        if (e.isIntersecting) {
          Object.keys(pills).forEach(function (k) { pills[k].classList.remove('is-active'); });
          a.classList.add('is-active');
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });

    Array.prototype.forEach.call(document.querySelectorAll('.resume-section'), function (s) {
      if (s.id) spyObserver.observe(s);
    });
  }

  /* ============================================================ 背景特效 */

  /**
   * 渲染背景特效选择卡片。
   * 选项来自 particles.js 导出的 EFFECTS 元数据，加新特效不用改这里。
   */
  function renderEffectPicker() {
    if (!els.effectGrid) return;
    var list = (global.ResumeParticles && global.ResumeParticles.EFFECTS) || [];
    var cfg = Store.getBg();

    els.effectGrid.innerHTML = '';
    list.forEach(function (meta) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'effect-card' + (meta.id === cfg.effect ? ' is-active' : '');
      card.dataset.effect = meta.id;
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', meta.id === cfg.effect ? 'true' : 'false');
      card.title = meta.desc || meta.name;

      var thumb = document.createElement('span');
      thumb.className = 'effect-thumb t-' + meta.id;
      for (var i = 0; i < 6; i++) thumb.appendChild(document.createElement('i'));

      var text = document.createElement('span');
      text.className = 'effect-card-text';
      var strong = document.createElement('strong');
      strong.textContent = meta.name;
      var desc = document.createElement('span');
      desc.textContent = meta.desc || '';
      text.appendChild(strong);
      text.appendChild(desc);

      card.appendChild(thumb);
      card.appendChild(text);
      card.addEventListener('click', function () { applyBg({ effect: meta.id }); });
      els.effectGrid.appendChild(card);
    });

    if (els.bgDensity) els.bgDensity.value = String(Math.round((cfg.density || 1) * 100));
    if (els.bgDensityValue) els.bgDensityValue.textContent = Math.round((cfg.density || 1) * 100) + '%';
  }

  /** 应用背景配置：写进 particles.js 并持久化 */
  function applyBg(patch) {
    var cfg = Store.setBg(Object.assign({}, Store.getBg(), patch || {}));
    var P = global.ResumeParticles;
    if (P) {
      if (patch && patch.effect) P.setEffect(cfg.effect);
      if (patch && patch.density !== undefined) P.setDensity(cfg.density);
    }
    renderEffectPicker();
    if (els.bgStatus) {
      var name = (Store.getBg().effect);
      var list = (P && P.EFFECTS) || [];
      var meta = list.filter(function (m) { return m.id === name; })[0];
      status(els.bgStatus, '已切换为「' + ((meta && meta.name) || name) + '」', 'ok');
      setTimeout(function () { status(els.bgStatus, '', ''); }, 2000);
    }
    return cfg;
  }

  /** 启动时把保存的背景偏好应用到画布上 */
  function initBg() {
    var cfg = Store.getBg();
    var P = global.ResumeParticles;
    if (P) {
      P.setDensity(cfg.density || 1);
      P.setEffect(cfg.effect || 'network');
    }
    renderEffectPicker();
  }

  /* ============================================================ 头像上传 */

  /** 头像输出尺寸（3:4 证件照比例） */
  var AVATAR_OUT_W = 480;
  var AVATAR_OUT_H = 640;
  var AVATAR_MAX_BYTES = 1500 * 1024;   /* 压缩后仍超过这个大小就提示 */

  /* 记住最近一次选的原图与检测到的人脸，方便拖动微调时重新裁剪，不用重选文件 */
  var avatarSource = { bitmap: null, face: null, name: '', note: '' };

  function formatBytes(n) {
    return H.formatBytes ? H.formatBytes(n) : String(n) + ' B';
  }

  /** data URL 的实际字节数（base64 去掉前缀后按 3/4 估算） */
  function dataUrlBytes(dataUrl) {
    return H.dataUrlBytes ? H.dataUrlBytes(dataUrl) : 0;
  }

  /**
   * 尝试用浏览器内置的人脸检测找出人脸中心。
   * 没有这个 API（Firefox / 部分 Chrome 版本）或没检测到时返回 null，
   * 由 cropRectFor 的默认取景兜底 —— 所以这条链路不依赖它也能工作。
   */
  function detectFaceCenter(bitmap) {
    return new Promise(function (resolve) {
      if (typeof global.FaceDetector !== 'function') return resolve(null);
      var fd;
      try { fd = new global.FaceDetector({ fastMode: true, maxDetectedFaces: 3 }); }
      catch (e) { return resolve(null); }

      var p;
      try { p = fd.detect(bitmap); } catch (e) { return resolve(null); }
      if (!p || typeof p.then !== 'function') return resolve(null);

      p.then(function (faces) {
        if (!faces || !faces.length) return resolve(null);
        /* 多张脸时取面积最大的那个 */
        var best = faces[0];
        var bestArea = 0;
        faces.forEach(function (f) {
          var b = f.boundingBox || {};
          var area = (b.width || 0) * (b.height || 0);
          if (area > bestArea) { bestArea = area; best = f; }
        });
        var bb = best.boundingBox || {};
        if (!bb.width) return resolve(null);
        resolve({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2, w: bb.width, h: bb.height });
      }).catch(function () { resolve(null); });
    });
  }

  /** 用当前的取景参数把原图裁成头像并编码 */
  function renderAvatarFromSource(nudge) {
    var bmp = avatarSource.bitmap;
    if (!bmp) return null;

    var rect = (H.cropRectFor ? H.cropRectFor : function () {
      return { sx: 0, sy: 0, sw: bmp.width, sh: bmp.height };
    })({
      iw: bmp.width, ih: bmp.height,
      outW: AVATAR_OUT_W, outH: AVATAR_OUT_H,
      faceCx: avatarSource.face ? avatarSource.face.x : null,
      faceCy: avatarSource.face ? avatarSource.face.y : null,
      nudge: nudge || 0
    });

    var cv = document.createElement('canvas');
    cv.width = AVATAR_OUT_W;
    cv.height = AVATAR_OUT_H;
    var ctx = cv.getContext('2d');

    /* 证件照多为白底：先铺白，透明区域就不会变黑 */
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, AVATAR_OUT_W, AVATAR_OUT_H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, AVATAR_OUT_W, AVATAR_OUT_H);

    var out = cv.toDataURL('image/jpeg', 0.87);
    return {
      dataUrl: out,
      width: AVATAR_OUT_W,
      height: AVATAR_OUT_H,
      bytes: dataUrlBytes(out),
      crop: rect
    };
  }

  /** 读文件 → 解码 → 检测人脸 → 裁剪 */
  function loadAvatarFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();

      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('这个文件不是能识别的图片格式'));
      };

      img.onload = function () {
        var start = function (bitmap) {
          detectFaceCenter(bitmap).then(function (face) {
            avatarSource.bitmap = bitmap;
            avatarSource.face = face;
            avatarSource.name = file.name || '';
            avatarSource.note = face ? '已自动对准人脸' : '未检测到人脸，已按人像常规取景';
            URL.revokeObjectURL(url);
            resolve(avatarSource);
          });
        };

        if (typeof global.createImageBitmap === 'function') {
          global.createImageBitmap(img).then(start).catch(function () { start(img); });
        } else {
          start(img);
        }
      };

      img.src = url;
    });
  }

  /** 刷新设置页里的头像预览 */
  function renderAvatarPreview() {
    if (!els.avatarPreview) return;
    var data = Store.load();
    var src = (data.profile && data.profile.avatar) || '';

    els.avatarPreview.innerHTML = '';
    if (src) {
      var img = document.createElement('img');
      img.src = src;
      img.alt = '头像预览';
      els.avatarPreview.appendChild(img);
      if (els.avatarInfo) {
        els.avatarInfo.textContent = /^data:/.test(src)
          ? '当前：已上传的照片（约 ' + formatBytes(dataUrlBytes(src)) + '）'
          : '当前：' + src;
      }
    } else {
      els.avatarPreview.appendChild(el('div', 'avatar-preview-empty', '暂无头像<br>显示姓名首字'));
      if (els.avatarInfo) els.avatarInfo.textContent = '当前：无（页面会显示姓名首字）';
    }
    if (els.btnAvatarClear) els.btnAvatarClear.disabled = !src;
    /* 没有原图（比如刷新后、或用的是内置占位图）就没法微调 */
    if (els.avatarNudge) els.avatarNudge.disabled = !avatarSource.bitmap;
    if (els.avatarNudgeRow) els.avatarNudgeRow.hidden = !avatarSource.bitmap;
  }

  /** 写入头像并重绘页面 */
  function setAvatar(src, note) {
    Store.update({ 'profile.avatar': src || '' });
    renderMain();
    renderAvatarPreview();
    if (state.draft) { state.draft.profile.avatar = src || ''; renderMini(); }
    if (note) status(els.avatarStatus, note, 'ok');
  }

  /** 拖动微调时实时重新裁剪 */
  var applyNudge = debounce(function () {
    if (!avatarSource.bitmap) return;
    var nudge = Number(els.avatarNudge ? els.avatarNudge.value : 0) / 100;
    var res = renderAvatarFromSource(nudge);
    if (!res) return;
    if (res.bytes > AVATAR_MAX_BYTES) {
      status(els.avatarStatus, '图片过大（' + formatBytes(res.bytes) + '），请换一张', 'err');
      return;
    }
    setAvatar(res.dataUrl, '');
    if (els.avatarInfo) {
      els.avatarInfo.textContent = '当前：已上传的照片（约 ' + formatBytes(res.bytes) + '）';
    }
  }, 200);

  function initAvatar() {
    renderAvatarPreview();
    if (!els.btnAvatarPick || !els.avatarInput) return;

    els.btnAvatarPick.addEventListener('click', function () { els.avatarInput.click(); });

    els.avatarInput.addEventListener('change', function () {
      var f = els.avatarInput.files && els.avatarInput.files[0];
      els.avatarInput.value = '';
      if (!f) return;

      if (!/^image\//.test(f.type)) {
        status(els.avatarStatus, '请选择图片文件（jpg / png / webp）', 'err');
        return;
      }

      status(els.avatarStatus, '正在处理…', '');
      loadAvatarFile(f).then(function () {
        if (els.avatarNudge) els.avatarNudge.value = '0';
        var res = renderAvatarFromSource(0);
        if (!res) throw new Error('裁剪失败');
        if (res.bytes > AVATAR_MAX_BYTES) {
          status(els.avatarStatus,
            '图片压缩后仍有 ' + formatBytes(res.bytes) + '，超过浏览器存储上限，请换一张小一点的', 'err');
          return;
        }
        setAvatar(res.dataUrl,
          '已更新头像（' + res.width + '×' + res.height + '，' + formatBytes(res.bytes) +
          '）· ' + avatarSource.note);
        if (els.avatarInfo) {
          els.avatarInfo.textContent = '当前：已上传的照片（约 ' + formatBytes(res.bytes) + '）· ' +
            avatarSource.note;
        }
      }).catch(function (err) {
        status(els.avatarStatus, '处理失败：' + err.message, 'err');
      });
    });

    if (els.avatarNudge) {
      els.avatarNudge.addEventListener('input', function () {
        if (els.avatarNudgeValue) {
          var v = Number(els.avatarNudge.value);
          els.avatarNudgeValue.textContent = v === 0 ? '居中' : (v < 0 ? '上移 ' + (-v) + '%' : '下移 ' + v + '%');
        }
        applyNudge();
      });
    }

    if (els.btnAvatarClear) {
      els.btnAvatarClear.addEventListener('click', function () {
        avatarSource.bitmap = null;
        avatarSource.face = null;
        setAvatar('', '已移除头像，页面改为显示姓名首字');
      });
    }
  }

  /* ============================================================ 设置页 */

  /* ======================================================== 简历模块管理 */

  var SORT_LABELS = {
    list: '要点列表（小标题 + 一段说明）',
    cards: '经历卡片（单位/项目 + 角色 + 分块描述）',
    timeline: '时间线（学校/单位 + 日期 + 要点）',
    tags: '标签（分组 + 技能词）'
  };

  /** 版式下拉框 */
  function makeSortSelect(current, onChange) {
    var sel = document.createElement('select');
    ['list', 'cards', 'timeline', 'tags'].forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = SORT_LABELS[k];
      sel.appendChild(o);
    });
    sel.value = SORT_LABELS[current] ? current : 'list';
    sel.addEventListener('change', function () { onChange(sel.value); });
    return sel;
  }

  /** 取当前数据里的某个区块 */
  function findSection(id) {
    var data = Store.load();
    return (data.sections || []).filter(function (s) { return s.id === id; })[0] || null;
  }

  function renderModuleManager() {
    if (!els.moduleList) return;
    var data = Store.load();
    var sections = data.sections || [];

    els.moduleList.innerHTML = '';
    if (!sections.length) {
      els.moduleList.appendChild(el('div', 'module-empty',
        '还没有任何模块。先在上面输入名称新建一个，或者点「恢复默认数据」拿回示例模块。'));
      return;
    }

    sections.forEach(function (sec, i) {
      els.moduleList.appendChild(buildModuleCard(sec, i, sections.length));
    });
  }

  function buildModuleCard(sec, index, total) {
    var card = el('div', 'module-card' + (index === 0 ? '' : ' is-collapsed'));
    card.dataset.sectionId = sec.id;

    /* ---------- 头部：序号 + 名称 + 版式 + 工具 ---------- */
    var head = el('div', 'module-card-head');

    head.appendChild(el('span', 'module-order', String(index + 1)));
    head.appendChild(el('span', 'module-name', sec.title || sec.id));
    head.appendChild(el('span', 'module-tag', SORT_LABEL_SHORT[sec.sort] || sec.sort));

    var tools = el('div', 'module-tools');
    tools.appendChild(moduleBtn('up', '上移', index === 0, function () {
      moveModule(sec.id, -1);
    }));
    tools.appendChild(moduleBtn('down', '下移', index === total - 1, function () {
      moveModule(sec.id, 1);
    }));
    tools.appendChild(moduleBtn('remove', '删除这个模块', false, function () {
      removeModule(sec.id, sec.title);
    }));
    head.appendChild(tools);

    var caretWrap = el('span', 'module-btn');
    caretWrap.innerHTML = '<svg class="module-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>';
    head.appendChild(caretWrap);

    head.addEventListener('click', function (e) {
      if (tools.contains(e.target)) return;
      card.classList.toggle('is-collapsed');
    });
    card.appendChild(head);

    /* ---------- 主体 ---------- */
    var body = el('div', 'module-body');

    /* 名称 */
    var nameField = el('div', 'module-field');
    nameField.appendChild(el('label', null, '模块名称'));
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 20;
    nameInput.value = sec.title || '';
    nameInput.addEventListener('input', debounce(function () {
      var next = Store.load();
      var target = (next.sections || []).filter(function (s) { return s.id === sec.id; })[0];
      if (!target) return;
      target.title = nameInput.value.trim() || target.title;
      Store.save(next);
      head.querySelector('.module-name').textContent = target.title;
      renderMain();
    }, 400));
    nameField.appendChild(nameInput);
    body.appendChild(nameField);

    /* 版式 */
    var sortField = el('div', 'module-field');
    sortField.appendChild(el('label', null, '版式'));
    sortField.appendChild(makeSortSelect(sec.sort, function (v) {
      var next = Store.load();
      var target = (next.sections || []).filter(function (s) { return s.id === sec.id; })[0];
      if (!target) return;
      target.sort = v;
      /* 换版式时补齐所需字段，避免渲染出空白 */
      if (v === 'tags') {
        if (!target.groups || !target.groups.length) {
          target.groups = [{ title: sec.title || '技能', items: [{ text: '示例技能', level: 'main' }] }];
        }
        delete target.items;
      } else {
        if (!target.items || !target.items.length) target.items = [blankItem(v)];
        delete target.groups;
      }
      Store.save(next);
      renderMain();
      renderModuleManager();
      toast('已切换为「' + SORT_LABEL_SHORT[v] + '」，可在下方填写内容');
    }));
    sortField.appendChild(el('div', 'field-hint',
      '换版式不会删掉已有内容，但字段结构不同，建议切换后核对一下。'));
    body.appendChild(sortField);

    /* 内容编辑 */
    var contentField = el('div', 'module-field');
    contentField.appendChild(el('label', null, '内容'));
    contentField.appendChild(buildModuleEditor(sec));
    body.appendChild(contentField);

    card.appendChild(body);
    return card;
  }

  function moduleBtn(kind, title, disabled, onClick) {
    var ICON = {
      up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
      down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
      remove: '<path d="M5 7h14M10 7V5h4v2M9 7l.7 12h4.6L15 7"/>'
    };
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'module-btn' + (kind === 'remove' ? ' is-danger' : '');
    b.title = title;
    b.setAttribute('aria-label', title);
    b.disabled = !!disabled;
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[kind] + '</svg>';
    b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
    return b;
  }

  /** 新建模块时按版式给一条空白骨架 */
  function blankItem(sort) {
    if (sort === 'cards') {
      return { org: '新的经历', date: '', title: '', location: '', logo: '', blocks: [{ label: '说明', text: '' }] };
    }
    if (sort === 'timeline') {
      return { org: '新的单位', date: '', degree: '', location: '', logo: '', bullets: [''] };
    }
    return { title: '新的要点', text: '' };
  }

  /* ------------------------------------------------------ 模块内容编辑器 */

  /**
   * 结构化内容编辑器：每个条目一张小卡，字段分列输入，可单独增删。
   * 之所以不做成「一行一条」的文本框，是因为卡片要填 org/date/title/blocks 好几个字段，
   * 拼成一行既难写也容易写错。
   */
  function buildModuleEditor(sec) {
    var wrap = el('div', 'module-editor');

    function readSec() {
      var next = Store.load();
      return (next.sections || []).filter(function (s) { return s.id === sec.id; })[0] || null;
    }

    /* 任何修改都走这里：改内存里的数组 → 落盘 → 主页面重绘 */
    function mutate(fn, redrawEditor) {
      var next = Store.load();
      var target = (next.sections || []).filter(function (s) { return s.id === sec.id; })[0];
      if (!target) return;
      fn(target);
      Store.save(next);
      renderMain();
      if (redrawEditor) renderModuleManager();
      if (state.draft) { state.draft = Store.load(); renderMini(); }
    }

    function field(labelText, value, onInput, opts) {
      opts = opts || {};
      var box = el('div', 'module-field' + (opts.grow ? ' is-grow' : ''));
      box.appendChild(el('label', null, labelText));
      var inp;
      if (opts.multiline) {
        inp = document.createElement('textarea');
        inp.rows = opts.rows || 2;
      } else {
        inp = document.createElement('input');
        inp.type = 'text';
      }
      inp.className = 'module-input';
      inp.value = value == null ? '' : String(value);
      inp.placeholder = opts.placeholder || '';
      inp.addEventListener('input', debounce(function () { onInput(inp.value); }, 350));
      box.appendChild(inp);
      return box;
    }

    function itemCard(title, index, total, onUp, onDown, onRemove, onMove) {
      var card = el('div', 'module-item');

      var head = el('div', 'module-item-head');
      head.appendChild(el('span', 'module-item-index', String(index + 1)));
      head.appendChild(el('span', 'module-item-title', title));

      var tools = el('div', 'module-tools');
      tools.appendChild(moduleBtn('up', '上移', index === 0, onUp));
      tools.appendChild(moduleBtn('down', '下移', index === total - 1, onDown));
      tools.appendChild(moduleBtn('remove', '删除这一条', false, onRemove));
      head.appendChild(tools);
      card.appendChild(head);
      return card;
    }

    /* ---------------- 标签版式 ---------------- */
    if (sec.sort === 'tags') {
      var groups = sec.groups || [];
      if (!groups.length) {
        wrap.appendChild(el('div', 'module-empty', '还没有分组，点下面的按钮加一组。'));
      }
      groups.forEach(function (g, gi) {
        var box = el('div', 'module-item');
        var head = el('div', 'module-item-head');
        head.appendChild(el('span', 'module-item-index', '组' + (gi + 1)));
        head.appendChild(el('span', 'module-item-title', g.title || '未命名分组'));
        var tools = el('div', 'module-tools');
        tools.appendChild(moduleBtn('remove', '删除这一组', false, function () {
          mutate(function (t) { t.groups.splice(gi, 1); }, true);
        }));
        head.appendChild(tools);
        box.appendChild(head);

        box.appendChild(field('分组名称', g.title || '', function (v) {
          mutate(function (t) {
            if (t.groups[gi]) t.groups[gi].title = v || '未命名分组';
            var nameEl = box.querySelector('.module-item-title');
            if (nameEl) nameEl.textContent = v || '未命名分组';
          });
        }));

        box.appendChild(field('技能词（用「、」或逗号分隔）',
          (g.items || []).map(function (t) { return t.text; }).join('、'),
          function (v) {
            mutate(function (t) {
              if (!t.groups[gi]) return;
              t.groups[gi].items = (Skills && Skills.extractTags)
                ? Skills.extractTags(v)
                : v.split(/[、,，;；\/]+/).map(function (x) { return { text: x.trim(), level: 'aux' }; })
                    .filter(function (x) { return x.text; });
            });
          }, { multiline: true, rows: 2, placeholder: '例：Java、Go、Docker' }));

        wrap.appendChild(box);
      });

      wrap.appendChild(editorAddBtn('+ 新增一组技能', function () {
        mutate(function (t) {
          t.groups = t.groups || [];
          t.groups.push({ title: '新分组', items: [] });
        }, true);
      }));
      return wrap;
    }

    /* ---------------- 列表 / 卡片 / 时间线 ---------------- */
    var items = sec.items || [];
    if (!items.length) {
      wrap.appendChild(el('div', 'module-empty', '还没有条目，点下面的按钮加一条。'));
    }

    items.forEach(function (it, i) {
      var total = items.length;
      var card = itemCard(
        it.org || it.title || it.text || ('条目 ' + (i + 1)),
        i, total,
        function () { mutate(function (t) { swap(t.items, i, i - 1); }, true); },
        function () { mutate(function (t) { swap(t.items, i, i + 1); }, true); },
        function () { mutate(function (t) { t.items.splice(i, 1); }, true); }
      );

      if (sec.sort === 'list') {
        card.appendChild(field('小标题', it.title || '', function (v) {
          mutate(function (t) { if (t.items[i]) t.items[i].title = v; });
        }, { placeholder: '例：学术竞赛' }));
        card.appendChild(field('内容', it.text || '', function (v) {
          mutate(function (t) { if (t.items[i]) t.items[i].text = v; });
        }, { multiline: true, rows: 2 }));

      } else if (sec.sort === 'cards') {
        var row1 = el('div', 'module-field-row');
        row1.appendChild(field('名称（项目 / 公司）', it.org || '', function (v) {
          mutate(function (t) { if (t.items[i]) t.items[i].org = v; }, true);
        }));
        row1.appendChild(field('时间', it.date || '', function (v) {
          mutate(function (t) { if (t.items[i]) t.items[i].date = v; });
        }, { placeholder: '2024.03 – 2024.06' }));
        card.appendChild(row1);

        var row2 = el('div', 'module-field-row');
        row2.appendChild(field('角色 / 职位', it.title || '', function (v) {
          mutate(function (t) { if (t.items[i]) t.items[i].title = v; });
        }));
        row2.appendChild(field('地点', it.location || '', function (v) {
          mutate(function (t) { if (t.items[i]) t.items[i].location = v; });
        }));
        card.appendChild(row2);

        card.appendChild(field('正文（每行一个「小标签 · 内容」，也可只写内容）',
          blocksToText(it.blocks),
          function (v) {
            mutate(function (t) { if (t.items[i]) t.items[i].blocks = textToBlocks(v); });
          }, { multiline: true, rows: 3, placeholder: '技术实现 · 用了什么技术做了什么\n项目价值 · 达成了什么结果' }));

      } else if (sec.sort === 'timeline') {
        var trow1 = el('div', 'module-field-row');
        trow1.appendChild(field('学校 / 单位', it.org || '', function (v) {
          mutate(function (t) { if (t.items[i]) t.items[i].org = v; }, true);
        }));
        trow1.appendChild(field('日期', it.date || '', function (v) {
          mutate(function (t) { if (t.items[i]) t.items[i].date = v; });
        }, { placeholder: '2021.09 – 2025.06' }));
        card.appendChild(trow1);

        var trow2 = el('div', 'module-field-row');
        trow2.appendChild(field('学历 / 职位', it.degree || '', function (v) {
          mutate(function (t) { if (t.items[i]) t.items[i].degree = v; });
        }, { placeholder: '本科 · 计算机科学与技术' }));
        trow2.appendChild(field('地点', it.location || '', function (v) {
          mutate(function (t) { if (t.items[i]) t.items[i].location = v; });
        }));
        card.appendChild(trow2);

        card.appendChild(field('要点（每行一条）', (it.bullets || []).join('\n'), function (v) {
          mutate(function (t) {
            if (t.items[i]) t.items[i].bullets = String(v).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
          });
        }, { multiline: true, rows: 2, placeholder: '主修课程：…' }));
      }

      wrap.appendChild(card);
    });

    wrap.appendChild(editorAddBtn('+ 新增一条', function () {
      mutate(function (t) {
        t.items = t.items || [];
        t.items.push(blankItem(sec.sort));
      }, true);
    }));

    return wrap;
  }

  function editorAddBtn(text, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ghost module-add-btn';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  function swap(arr, i, j) {
    if (H.swap) return H.swap(arr, i, j);
    if (j < 0 || j >= arr.length) return arr;
    var t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
    return arr;
  }

  function moveModule(id, delta) {
    var next = Store.moveSection(id, delta);
    if (!next) return;
    renderMain();
    renderModuleManager();
    status(els.moduleStatus, delta < 0 ? '已上移' : '已下移', 'ok');
  }

  function removeModule(id, title) {
    var sec = findSection(id);
    var hasContent = false;
    try { hasContent = JSON.stringify(sec).length > 120; } catch (e) { hasContent = true; }
    var msg = hasContent
      ? '确定删除模块「' + (title || id) + '」吗？里面的内容会一起删掉（可用「撤销上次应用」找回）。'
      : '确定删除模块「' + (title || id) + '」吗？';
    if (!global.confirm(msg)) return;

    Store.pushUndo(Store.load());
    var next = Store.removeSection(id);
    if (!next) return;
    renderMain();
    renderModuleManager();
    if (state.draft) { state.draft = Store.load(); renderMini(); }
    if (els.btnUndo) els.btnUndo.disabled = false;
    status(els.moduleStatus, '已删除模块「' + (title || id) + '」', 'ok');
    toast('已删除模块，可用「撤销」找回');
  }

  function addModule() {
    var input = els.newModuleTitle;
    var title = (input && input.value || '').trim();
    if (!title) {
      status(els.moduleStatus, '请先填模块名称', 'err');
      if (input) input.focus();
      return;
    }

    var data = Store.load();
    var sections = data.sections || [];
    if (sections.some(function (s) { return s.title === title; })) {
      status(els.moduleStatus, '已经有同名模块了，换个名字或者直接编辑它', 'err');
      return;
    }

    var sort = inferSort(title);
    var id = 'custom-' + Date.now().toString(36);
    var sec = { id: id, title: title, anchor: id, sort: sort };
    if (sort === 'tags') sec.groups = [{ title: title, items: [] }];
    else sec.items = [blankItem(sort)];

    Store.pushUndo(data);
    Store.update({ sections: sections.concat([sec]) });
    if (input) input.value = '';
    renderMain();
    renderModuleManager();
    if (els.btnUndo) els.btnUndo.disabled = false;

    status(els.moduleStatus,
      '已新建「' + title + '」（版式：' + (SORT_LABEL_SHORT[sort] || sort) + '），在下面填写内容即可', 'ok');
    toast('已新建模块「' + title + '」');

    /* 滚到新模块并聚焦名称输入框 */
    var card = els.moduleList && els.moduleList.querySelector('[data-section-id="' + id + '"]');
    if (card) {
      card.classList.remove('is-collapsed');
      if (card.scrollIntoView) card.scrollIntoView({ block: 'center' });
      var nameInput = card.querySelector('input[type="text"]');
      if (nameInput && nameInput.focus) nameInput.focus();
    }
    refreshNewModuleHint();
  }

  /* 输入名称时按名字猜一个版式，帮用户少点一次 */
  function inferSort(title) {
    return H.inferSort ? H.inferSort(title) : 'list';
  }

  var SORT_LABEL_SHORT = H.SORT_LABELS || { list: '要点列表', cards: '经历卡片', timeline: '时间线', tags: '标签' };

  function refreshNewModuleHint() {
    if (!els.newModuleHint) return;
    var t = (els.newModuleTitle && els.newModuleTitle.value || '').trim();
    if (!t) {
      els.newModuleHint.textContent = '输入名称后会按名字自动推荐版式，也可以手动改。';
      return;
    }
    var s = inferSort(t);
    els.newModuleHint.textContent = '将使用「' + (SORT_LABEL_SHORT[s] || s) + '」版式，新建后可以改成别的。';
  }

  function loadSettings() {
    var cfg = Store.getLLM();
    if (els.llmEnabled) els.llmEnabled.checked = !!cfg.enabled;
    if (els.llmKey) els.llmKey.value = cfg.apiKey || '';
    if (els.llmBase) els.llmBase.value = cfg.baseUrl || '';
    if (els.llmModel) els.llmModel.value = cfg.model || '';
    if (els.llmTrigger) els.llmTrigger.value = cfg.trigger || 'fallback';
    renderEffectPicker();
    renderAvatarPreview();
    renderModuleManager();
  }

  function saveSettings() {
    var cfg = {
      enabled: !!(els.llmEnabled && els.llmEnabled.checked),
      apiKey: els.llmKey ? els.llmKey.value.trim() : '',
      baseUrl: els.llmBase ? els.llmBase.value.trim() : '',
      model: els.llmModel ? els.llmModel.value.trim() : '',
      trigger: els.llmTrigger ? els.llmTrigger.value : 'fallback'
    };
    Store.setLLM(cfg);
    return cfg;
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'application/json') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function readFile(file, cb) {
    var fr = new FileReader();
    fr.onload = function () { cb(String(fr.result || '')); };
    fr.onerror = function () { toast('文件读取失败'); };
    fr.readAsText(file, 'utf-8');
  }

  /* ================================================================== 绑定 */

  function bind() {
    if (els.fab) els.fab.addEventListener('click', openDrawer);
    if (els.close) els.close.addEventListener('click', closeDrawer);
    if (els.overlay) els.overlay.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (els.drawer && !els.drawer.hidden) closeDrawer();
      }
      /* Ctrl/Cmd + K 快速打开识别面板 */
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        openDrawer();
        if (els.rawInput) els.rawInput.focus();
      }
    });

    /* 标签页切换 */
    Array.prototype.forEach.call(document.querySelectorAll('.seg-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.dataset.tab;
        Array.prototype.forEach.call(document.querySelectorAll('.seg-btn'), function (b) {
          var on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        Array.prototype.forEach.call(document.querySelectorAll('.drawer-body'), function (p) {
          p.hidden = p.dataset.panel !== tab;
        });
        if (tab === 'settings') loadSettings();
        if (tab === 'review') {
          renderMini();
          setTimeout(function () {
            if (els.miniPreview && els.miniPreview.firstElementChild) {
              Render.fitMini(els.miniPreview, els.miniPreview.firstElementChild);
            }
          }, 40);
        }
      });
    });

    if (els.themeToggle) {
      els.themeToggle.addEventListener('click', function () {
        setTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
      });
    }

    if (global.matchMedia) {
      var mq = global.matchMedia('(prefers-color-scheme: dark)');
      var onSys = function (e) {
        if (Store.getThemePref()) return;      /* 用户手动选过就不再跟随 */
        setTheme(e.matches ? 'dark' : 'light', false);
      };
      if (mq.addEventListener) mq.addEventListener('change', onSys);
      else if (mq.addListener) mq.addListener(onSys);
    }

    if (els.btnParse) els.btnParse.addEventListener('click', function () { runParse(false); });
    if (els.btnTemplate) {
      els.btnTemplate.addEventListener('click', function () {
        els.rawInput.value = Parser.TEMPLATE;
        status(els.parseStatus, '已载入模板，把内容填进去再点「一键识别」', 'ok');
        els.rawInput.focus();
      });
    }
    if (els.btnSample) {
      els.btnSample.addEventListener('click', function () {
        els.rawInput.value = Parser.SAMPLE_FREETEXT;
        status(els.parseStatus,
          '已填入演示文本（里面的「示例姓名」「13800000000」都是占位值）。' +
          '它只用来试识别效果，别点「应用到简历」，否则会把简历上的姓名换成示例姓名。', 'warn');
        toast('这是演示文本，只用于试识别，别应用到简历');
      });
    }
    if (els.btnLoadFile && els.fileInput) {
      els.btnLoadFile.addEventListener('click', function () { els.fileInput.click(); });
      els.fileInput.addEventListener('change', function () {
        var f = els.fileInput.files && els.fileInput.files[0];
        if (!f) return;
        readFile(f, function (txt) {
          els.rawInput.value = txt;
          status(els.parseStatus, '已读取 ' + f.name + '（' + txt.length + ' 字）', 'ok');
        });
        els.fileInput.value = '';
      });
    }

    if (els.rawInput) {
      els.rawInput.addEventListener('dragover', function (e) { e.preventDefault(); });
      els.rawInput.addEventListener('drop', function (e) {
        e.preventDefault();
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        readFile(f, function (txt) { els.rawInput.value = txt; });
      });
    }

    if (els.btnSelectAll) {
      els.btnSelectAll.addEventListener('click', function () {
        Object.keys(state.checked).forEach(function (p) { state.checked[p] = true; });
        Array.prototype.forEach.call(els.reviewList.querySelectorAll('.check'), function (n) {
          n.checked = true; n.indeterminate = false;
        });
        Array.prototype.forEach.call(els.reviewList.querySelectorAll('.review-field'), function (n) { n.classList.remove('is-missing'); });
        refreshGroups();
        updateApplyState();
        rebuildDraft();
      });
    }

    if (els.btnSelectNone) {
      els.btnSelectNone.addEventListener('click', function () {
        Object.keys(state.checked).forEach(function (p) { state.checked[p] = false; });
        Array.prototype.forEach.call(els.reviewList.querySelectorAll('.check'), function (n) {
          n.checked = false; n.indeterminate = false;
        });
        refreshGroups();
        updateApplyState();
        rebuildDraft();
      });
    }

    /* 展开 / 收起全部分组 */
    function toggleAllGroups(open) {
      Array.prototype.forEach.call(els.reviewList.querySelectorAll('.review-group'), function (g) {
        if (typeof g._toggle === 'function') g._toggle(open);
      });
    }
    if (els.btnExpandAll) els.btnExpandAll.addEventListener('click', function () { toggleAllGroups(true); });
    if (els.btnCollapseAll) els.btnCollapseAll.addEventListener('click', function () { toggleAllGroups(false); });

    if (els.btnApply) els.btnApply.addEventListener('click', applyReview);

    if (els.btnUndo) {
      els.btnUndo.addEventListener('click', function () {
        var restored = Store.undo();
        if (!restored) return;
        renderMain();
        els.btnUndo.disabled = true;
        status(els.applyStatus, '已撤销上一次应用', 'ok');
        state.draft = Store.load();
        renderMini();
      });
    }

    if (els.btnDiscard) {
      els.btnDiscard.addEventListener('click', function () {
        state.review = null;
        state.checked = {};
        renderReview();
        state.draft = Store.load();
        renderMini();
        status(els.parseStatus, '已清空识别结果', '');
        status(els.applyStatus, '', '');
      });
    }

    /* ---------------- 设置页 ---------------- */
    [els.llmEnabled, els.llmKey, els.llmBase, els.llmModel, els.llmTrigger].forEach(function (n) {
      if (!n) return;
      n.addEventListener('change', function () {
        saveSettings();
        status(els.llmStatus, '设置已保存', 'ok');
        setTimeout(function () { status(els.llmStatus, '', ''); }, 1800);
      });
    });

    if (els.btnLLMClear) {
      els.btnLLMClear.addEventListener('click', function () {
        Store.clearLLMKey();
        if (els.llmKey) els.llmKey.value = '';
        if (els.llmEnabled) els.llmEnabled.checked = false;
        saveSettings();
        status(els.llmStatus, '已清除本地保存的 Key', 'ok');
      });
    }

    if (els.btnLLMTest) {
      els.btnLLMTest.addEventListener('click', function () {
        var cfg = saveSettings();
        if (!cfg.apiKey) { status(els.llmStatus, '请先填写 API Key', 'err'); return; }
        status(els.llmStatus, '正在测试 ' + cfg.baseUrl + ' …', 'warn');
        els.btnLLMTest.disabled = true;
        LLM.testConnection(cfg).then(function (r) {
          status(els.llmStatus, '连接正常（' + (r.elapsed / 1000).toFixed(1) + 's）', 'ok');
        }).catch(function (err) {
          status(els.llmStatus, '连接失败：' + err.message, 'err');
        }).finally(function () {
          els.btnLLMTest.disabled = false;
        });
      });
    }

    if (els.btnExport) {
      els.btnExport.addEventListener('click', function () {
        var data = Store.load();
        var name = (data.profile && data.profile.name ? data.profile.name : 'resume') + '-简历数据.json';
        download(name, Store.exportJSON());
        status(els.dataStatus, '已导出 ' + name, 'ok');
      });
    }

    if (els.btnImport && els.importInput) {
      els.btnImport.addEventListener('click', function () { els.importInput.click(); });
      els.importInput.addEventListener('change', function () {
        var f = els.importInput.files && els.importInput.files[0];
        if (!f) return;
        readFile(f, function (txt) {
          try {
            var obj = Store.parseJSON(txt);
            Store.pushUndo(Store.load());
            Store.importData(obj);
            renderMain();
            state.draft = Store.load();
            renderMini();
            if (els.btnUndo) els.btnUndo.disabled = false;
            status(els.dataStatus, '已导入 ' + f.name, 'ok');
            toast('数据已导入');
          } catch (err) {
            status(els.dataStatus, '导入失败：' + err.message, 'err');
          }
        });
        els.importInput.value = '';
      });
    }

    if (els.btnReset) {
      els.btnReset.addEventListener('click', function () {
        if (!global.confirm('确定要放弃网页上的所有修改，恢复 data.js 的默认数据吗？')) return;
        Store.pushUndo(Store.load());
        Store.reset();
        renderMain();
        state.draft = Store.load();
        state.review = null;
        renderReview();
        renderMini();
        if (els.btnUndo) els.btnUndo.disabled = false;
        status(els.dataStatus, '已恢复默认数据', 'ok');
        toast('已恢复 data.js 默认数据');
      });
    }

    /* ---------------- 背景特效 ---------------- */
    if (els.bgDensity) {
      var onDensity = function () {
        var pct = Number(els.bgDensity.value);
        if (els.bgDensityValue) els.bgDensityValue.textContent = pct + '%';
        applyBg({ density: pct / 100 });
      };
      els.bgDensity.addEventListener('input', onDensity);   /* 拖动时实时预览 */
    }

    if (els.btnBgReset) {
      els.btnBgReset.addEventListener('click', function () {
        applyBg({ effect: 'network', density: 1 });
        status(els.bgStatus, '已恢复默认背景（粒子连线 · 100%）', 'ok');
        setTimeout(function () { status(els.bgStatus, '', ''); }, 2000);
      });
    }

    /* ---------------- 模块管理 ---------------- */
    if (els.btnAddModule) els.btnAddModule.addEventListener('click', addModule);

    if (els.newModuleTitle) {
      els.newModuleTitle.addEventListener('input', refreshNewModuleHint);
      els.newModuleTitle.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addModule(); }
      });
    }

    /* 点页面区块右上角的垃圾桶也能删模块 */
    if (els.root) {
      els.root.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.section-remove') : null;
        if (!btn) return;
        e.preventDefault();
        var sec = btn.closest('.resume-section');
        if (!sec) return;
        var id = sec.id;
        var t = sec.querySelector('.section-title');
        removeModule(id, t ? t.textContent : id);
      });
    }

    var onResize = debounce(function () {
      if (els.drawer && !els.drawer.hidden && els.miniPreview && els.miniPreview.firstElementChild) {
        Render.fitMini(els.miniPreview, els.miniPreview.firstElementChild);
      }
    }, 200);
    global.addEventListener('resize', onResize);
  }

  /* ================================================================== 启动 */

  function boot() {
    if (!Store || !Parser || !Render) {
      console.error('[ui] 依赖脚本未加载完整');
      return;
    }
    bind();

    /* 背景特效要先应用，避免先渲染默认款再切一下闪动 */
    initBg();
    initAvatar();

    var data = Store.load();

    /* 如果刚才丢掉了过期的本地数据，明确告诉用户一声，
       否则「我明明改了内容却没生效」会非常难排查 */
    if (Store.lastDiscard) {
      setTimeout(function () {
        toast('检测到 data.js 已更新，浏览器里的旧内容已清除（' + Store.lastDiscard + '）', 6000);
      }, 600);
      if (els.dataStatus) status(els.dataStatus, '已丢弃过期的本地数据：' + Store.lastDiscard, 'warn');
      Store.lastDiscard = null;
    }

    if (typeof data.profile === 'object' && data.profile) data.profile.avatar = data.profile.avatar || '';
    Render.renderInto(els.root, data, { animate: true });
    initScrollSpy();

    state.draft = data;
    if (els.miniBadge) els.miniBadge.textContent = '当前数据';

    if (Store.hasOverride()) {
      console.info('[ui] 检测到本地修改的数据覆盖');
    }

    /* 打印前确保所有动画元素可见 */
    global.addEventListener('beforeprint', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.reveal'), function (n) {
        n.classList.add('is-visible');
      });
    });

    /* 支持 https://…/#parser 直接打开识别面板，方便收藏成书签 */
    if (/^#parser\b/.test(location.hash) || /[?&]parser=1\b/.test(location.search)) {
      openDrawer();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.ResumeUI = {
    open: openDrawer,
    close: closeDrawer,
    parse: runParse,
    setTheme: setTheme,
    setBg: applyBg,
    _state: state,
    /* 仅供测试使用：直接驱动识别结果面板并取回分组节点 */
    _renderReviewForTest: renderReview,
    _renderMainForTest: renderMain,
    _renderModuleManagerForTest: renderModuleManager,
    _reviewGroups: function () {
      if (!els.reviewList) return [];
      /* 只返回分组卡片本身：面板里还有说明条、提示等非分组节点 */
      return Array.prototype.slice.call(els.reviewList.children).filter(function (n) {
        return n.classList && n.classList.contains('review-group');
      });
    },
    _reviewNotes: function () {
      if (!els.reviewList) return [];
      return Array.prototype.slice.call(els.reviewList.children).filter(function (n) {
        return n.classList && n.classList.contains('review-note');
      });
    },
    /* 传 null 表示「没有识别结果」：清掉缓存，下次渲染会重新按当前数据合成 */
    _setReview: function (rev) { state.review = rev || null; },
    _applyReviewForTest: applyReview
  };
})(typeof window !== 'undefined' ? window : globalThis);
