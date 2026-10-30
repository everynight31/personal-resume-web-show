/* UI review: IIFE factory; works with file:// and ordinary script tags. */
(function (global) {
  'use strict';
  global.ResumeUIReview = { create: function (context) {
  var Store = context.Store;
  var Parser = context.Parser;
  var Render = context.Render;
  var LLM = context.LLM;
  var H = context.H;
  var els = context.els;
  var state = context.state;
  var toast = context.toast;
  var status = context.status;
  var debounce = context.debounce;
  var clone = context.clone;
  var escapeHtml = context.escapeHtml;
  var setBusy = context.setBusy;
  var renderMain = context.renderMain;
  var fieldMeta = context.fieldMeta;
  var valueToText = context.valueToText;
  var textToValue = context.textToValue;
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
    state.chosen[path] = true;
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
    var explicitlyChanged = Object.keys(state.chosen).length > 0 || Object.keys(state.edited).length > 0;
    els.btnApply.disabled = (!anySection && !anyHead && !explicitlyChanged) || !!els.reviewList.querySelector('[data-invalid="1"]');
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
    state.chosen = {};
    state.edited = {};

    var rev = ensureReview();

    /* 能看到全部模块这件事本身需要说明一下，否则容易被误会成「识别错了」 */
    els.reviewList.appendChild(rev._fromCurrent
      ? noteLine([
          '当前显示的是', { b: '简历里已有的全部内容' },
          '。可以直接在这里修改，改完点「应用到简历」。' +
          '也可以在上面粘贴新文本后点「一键识别」来覆盖对应模块。'
        ])
      : noteLine([
          '勾选 = 这一项要不要出现在简历里。带「现有模块（本次未识别到）」标记的',
          '默认不勾选，所以不会被这次识别影响；想保留它们就勾上。',
          '没勾的模块只是不显示，内容仍留在「设置 → 简历模块」里，可以从那里删。',
          '未识别的基本信息和成绩会保留原值；主动取消勾选才移除。右侧预览就是点应用后的结果。'
        ]));

    /* ---------- 头部信息组 ----------
       本次识别没抽到的字段留空且不勾选，但应用时保留原值，
       避免把简历里的旧值显示出来，看着像是从粘贴的文本里识别到的。
       头像识别器永远抽不到（文本里没有图片），所以单独给一个编辑入口。 */
    var fromCur = !!rev._fromCurrent;
    var headFields = [];
    [
      { path: 'profile.name', label: '姓名', v: rev.profile.name },
      { path: 'profile.headline', label: '身份', v: rev.profile.headline },
      { path: 'profile.intent', label: '报考/求职意向', v: rev.profile.intent },
      { path: 'profile.contacts', label: '联系方式', v: rev.profile.contacts }
    ].forEach(function (f) {
      var found = hasValue(f.v);
      headFields.push({
        path: f.path,
        label: f.label,
        value: found ? f.v : null,
        /* 没抽到 → 默认不勾选；当前数据模式下所有字段都算「有」 */
        notFound: !found && !fromCur
      });
    });
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
       后者列出来是为了让你能找到并修改它，但：
         · 内容留空，不回填旧值（否则像是「识别到了」）
         · 默认不勾选，不主动写回
       所以一次无关的粘贴既不会弄丢模块，也不会把旧内容冒充成识别结果。
       例外：没有识别结果时（rev 来自当前数据），面板就是个编辑器，
       这时要把现有内容填进去、并默认勾上。 */
    var fromCurrent = !!rev._fromCurrent;
    var parsedSections = fromCurrent ? [] : rev.sections;
    mergeSections(Store.load().sections, parsedSections).forEach(function (entry) {
      var sec = entry.section;
      var path = 'section.' + sec.id;
      /* 未识别到（且不是「当前数据」模式）→ 值置空 */
      var blank = !entry.fromParse && !fromCurrent;
      var value = blank ? null : (sec.sort === 'tags' ? sec.groups : sec.items);
      var fields = [{
        path: path,
        label: sec.sort === 'tags' ? '技能标签' : '内容',
        value: value
      }];
      var title = (sec.title || sectionTitleOf(sec.id));
      var tag = entry.fromParse
        ? (sec.src === 'inferred' ? '· 自动分段' : sec.src === 'llm' ? '· 大模型' : '')
        : '· 现有模块（本次未识别到）';
      /* buildField 收到的这个对象，就是用户输入时 setPath 要写回去的对象，
         所以必须跟 applyReview 取值的来源一致：
           · 有识别结果 → 写进识别结果
           · 当前数据模式 → 写进 state.review（它就是当前数据的副本） */
      var editTarget = fromCurrent ? entry.section : sec;
      els.reviewList.appendChild(buildGroup(path, title + ' ' + tag, fields, editTarget, blank));
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

  /**
   * 一个可折叠的分组卡片：头部一行放「勾选框 + 标题 + 摘要」，避免标题被挤成竖排
   * @param {boolean} isExisting 该模块本次没识别到（内容空着、默认不勾选）
   *
   * 勾选的含义：这一项要不要出现在简历里。
   *   · 勾上 → 应用后显示（基本信息写回，区块 visible）
   *   · 不勾 → 应用后不显示（基本信息清空，区块标 hidden；数据都还在，设置里能找到）
   */
  function buildGroup(groupPath, title, fields, section, isExisting) {
    var group = document.createElement('div');
    group.className = 'review-group';
    /* 现有模块（本次没识别到）打个标记，一是便于区分，二是让测试能断言 */
    if (isExisting) group.classList.add('is-existing');
    group.dataset.groupPath = groupPath;
    /* 组头勾选框的状态：只要有字段默认不勾，组头就不勾 */
    var initiallyChecked = !isExisting && !fields.some(function (f) { return f.notFound; });

    var filled = fields.filter(function (f) { return hasValue(f.value); }).length;
    var missing = fields.length - filled;

    var head = document.createElement('div');
    head.className = 'review-group-head';

    var box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'check';
    box.checked = initiallyChecked;
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

    /* 未识别到的模块、以及本次没抽到的字段：先置为「不选」，再渲染，
       否则 buildField 会把每一项都默认设为勾选，跟组头的状态对不上 */
    fields.forEach(function (f) {
      if (isExisting || f.notFound) state.checked[f.path] = false;
    });
    fields.forEach(function (f) {
      body.appendChild(buildField(f, section, state.checked[f.path] !== false));
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
      fields.forEach(function (f) { state.checked[f.path] = box.checked; state.chosen[f.path] = true; });
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

  function buildField(field, section, checked) {
    var meta = fieldMeta(field.path, section);
    var text = valueToText(field.path, field.value, section);
    var filled = hasValue(field.value);
    /* 已经由 buildGroup 决定过就不覆盖（未识别到的模块要默认不勾） */
    if (state.checked[field.path] === undefined) state.checked[field.path] = checked !== false;

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
    cb.checked = state.checked[field.path] !== false;
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
      var v;
      try { v = textToValue(input.value, field.path, section, field.value); }
      catch (error) {
        row.dataset.invalid = '1';
        input.setAttribute('aria-invalid', 'true');
        status(els.applyStatus, error.message, 'err');
        updateApplyState();
        return;
      }
      delete row.dataset.invalid;
      input.removeAttribute('aria-invalid');
      setPath(state.review, field.path, v, section);
      /* 记下「这个字段被人动过」：应用时只有动过的才用面板里的值，
         否则未识别到的模块会被面板里的空值覆盖掉原有内容 */
      state.edited[field.path] = true;
      /* 未识别到的模块不属于 state.review.sections，它的编辑结果得单独存一份，
         否则应用时会退回原数据，用户的输入就白输了 */
      if (section && section.id && field.path === 'section.' + section.id) {
        if (section.sort === 'tags') section.groups = clone(v);
        else section.items = clone(v);
        state.sectionEdits[section.id] = section;
      }
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

  /* ==================================================== 面板状态 → 简历数据 */

  /**
   * 把「面板当前的样子」换算成「点应用后的简历数据」。
   *
   * 预览和应用**共用这一个函数**，这样预览显示什么、应用后就一定是什么 ——
   * 之前两边各写一套，导致预览说会消失、实际却还在。
   *
   * 规则（勾选 = 这一项要不要出现在简历里）：
   *   · 基本信息勾上 → 写入面板里的值（哪怕是空，也会清掉旧值）；
   *     未识别且未操作 → 保留；主动取消勾选 → 清空
   *   · 区块勾上   → 用面板里的内容，并去掉 hidden 标记
   *   · 区块不勾   → 只标 hidden（不显示），数据留在 store 里，设置里还能看到/删除
   *
   * @param {Object} base 当前数据（Store.load()）
   * @returns {{data:Object, applied:number}}
   */
  function computeResult(base) {
    var rev = reviewSource();
    var out = clone(base);
    var applied = 0;

    var mergeSource = rev._fromCurrent ? base.sections : rev.sections;
    var entries = mergeSections(base.sections, mergeSource);

    /* ---------- 基本信息 ---------- */
    var profileKeys = [
      { path: 'profile.name', key: 'name' },
      { path: 'profile.headline', key: 'headline' },
      { path: 'profile.intent', key: 'intent' },
      { path: 'profile.contacts', key: 'contacts' }
    ];
    profileKeys.forEach(function (f) {
      var value = rev.profile && rev.profile[f.key];
      if (!rev._fromCurrent && !hasValue(value) && !state.edited[f.path] && !state.chosen[f.path]) return;
      if (isChecked(f.path)) {
        var v = rev.profile ? rev.profile[f.key] : null;
        if (f.key === 'contacts') out.profile.contacts = clone(v || []);
        else out.profile[f.key] = v == null ? '' : v;
        applied++;
      } else if (state.chosen[f.path] || !rev._fromCurrent) {
        /* 主动取消勾选才清空；未识别且未操作的字段保留原值 */
        if (f.key === 'contacts') out.profile.contacts = [];
        else out.profile[f.key] = '';
        applied++;
      }
    });
    /* 头像不参与识别，只跟随面板里的编辑 */
    if (rev.profile && rev.profile.avatar) out.profile.avatar = rev.profile.avatar;

    ['total', 'items'].forEach(function (key) {
      var fieldPath = 'scores.' + key;
      var value = rev.scores && rev.scores[key];
      var found = key === 'total' ? value && hasValue(value.value) : hasValue(value);
      if (!found && !state.edited[fieldPath] && !state.chosen[fieldPath]) return;
      if (!out.scores) out.scores = { title: (rev.scores && rev.scores.title) || '成绩', total: {label:'总分',value:''}, items:[] };
      out.scores[key] = isChecked(fieldPath) ? clone(value || (key === 'items' ? [] : {label:'总分',value:''})) : (key === 'items' ? [] : {label:'总分',value:''});
      applied++;
    });

    /* ---------- 区块 ---------- */
    var finalSections = [];
    var seen = {};
    entries.forEach(function (entry) {
      var sec = entry.section;
      if (!sec || !sec.id || seen[sec.id]) return;
      seen[sec.id] = 1;

      var pagePath = 'section.' + sec.id;
      var checked = isChecked(pagePath);
      var version = panelView(entry, entries, rev);

      var next = toSection(version);
      var n = (next.items && next.items.length) || (next.groups && next.groups.length) || 0;

      if (!checked) {
        /* 不显示：内容保留，只打 hidden 标记 */
        next.hidden = true;
        if (n) finalSections.push(next);
        applied++;
        return;
      }
      delete next.hidden;
      if (!n) return;                     /* 勾了但没内容 → 不添加空模块 */
      finalSections.push(next);
      applied++;
    });

    out.sections = finalSections;
    return { data: out, applied: applied };
  }

  /** 面板里那一项的当前版本（被人改过就用改过的） */
  function panelView(entry, entries, rev) {
    var sec = entry.section;
    if (state.edited['section.' + sec.id]) {
      if (state.sectionEdits[sec.id]) return state.sectionEdits[sec.id];
      var hit = null;
      entries.forEach(function (e) {
        if (e.section && e.section.id === sec.id) hit = e.section;
      });
      if (hit) return hit;
    }
    return sec;
  }

  /* ============================================================ 草稿与预览 */

  function rebuildDraft() {
    if (!state.review) {
      state.draft = clone(Store.load());
    } else {
      /* 预览就是「应用后的结果」，跟应用共用同一套换算 */
      state.draft = computeResult(Store.load()).data;
    }
    renderMini();
    updateMiniBadge();
  }

  function toSection(sec) {
    var out = { id: sec.id, title: sec.title, anchor: sec.anchor || sec.id, sort: sec.sort, kind: sec.kind };
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

  function applyReview() {
    if (els.reviewList.querySelector('[data-invalid="1"]')) {
      status(els.applyStatus, '请先修正格式有误的内容', 'err');
      return;
    }
    var before = Store.load();
    /* 跟预览用同一个换算函数，保证「预览看到的就是应用后的结果」 */
    var res = computeResult(before);
    var next = res.data;
    var applied = res.applied;

    if (!applied) {
      status(els.applyStatus, '没有勾选任何内容', 'err');
      els.applyStatus.classList.remove('is-ok');
      els.applyStatus.classList.add('is-err');
      return;
    }

    var previousUndo = Store.getUndoState();
    Store.pushUndo(before);
    try { Store.save(next); }
    catch (error) {
      Store.restoreUndoState(previousUndo);
      status(els.applyStatus, '保存失败：' + error.message + '；请压缩头像或导出备份后释放空间。', 'err');
      els.applyStatus.classList.remove('is-ok');
      els.applyStatus.classList.add('is-err');
      return;
    }

    renderMain();
    status(els.applyStatus, '已应用 ' + applied + ' 项修改到简历' + (Store.historyNotice ? '；' + Store.historyNotice : ''), 'ok');
    els.applyStatus.classList.add('is-ok');
    els.applyStatus.classList.remove('is-err');
    if (els.btnUndo) els.btnUndo.disabled = false;
    toast('已应用到简历（可撤销）');
  }

  /* ============================================================ 识别主流程 */

  function decideLLM(cfg, ruleReview) {
    if (!cfg.enabled || !cfg.apiKey) return false;
    if (cfg.trigger === 'always') return true;
    if (cfg.trigger === 'manual') return false;
    /* fallback：仅在本地解析失败或质量低于统一阈值时联网。 */
    if (!ruleReview) return true;
    return !ruleReview.quality || ruleReview.quality.score < Parser.QUALITY.POOR;
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


    /* 先跑本地规则解析（快、免费），同时也作为大模型失败时的兜底 */
    var ruleReview = null;
    try {
      ruleReview = Parser.parse(text);
    } catch (e) {
      console.error(e);
      status(els.parseStatus, '本地解析出错：' + e.message, 'err');
    }

    var useLLM = !!(cfg.enabled && cfg.apiKey && (forceLLM || decideLLM(cfg, ruleReview)));
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
      q.score >= Parser.QUALITY.GOOD ? 'ok' : 'warn');
    toast('识别完成，共 ' + rev.sections.length + ' 个区块待确认');
  }


  return { updateApplyState: updateApplyState, renderReview: renderReview, refreshGroups: refreshGroups, rebuildDraft: rebuildDraft, applyReview: applyReview, runParse: runParse, renderMini: renderMini };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
