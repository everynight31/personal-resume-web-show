/* UI settings: IIFE factory; works with file:// and ordinary script tags. */
(function (global) {
  'use strict';
  global.ResumeUISettings = { create: function (context) {
  var Store = context.Store;
  var LLM = context.LLM;
  var Skills = context.Skills;
  var H = context.H;
  var els = context.els;
  var state = context.state;
  var el = context.el;
  var toast = context.toast;
  var status = context.status;
  var debounce = context.debounce;
  var renderMain = context.renderMain;
  var blocksToText = context.blocksToText;
  var textToBlocks = context.textToBlocks;
  var renderReview = context.renderReview;
  var renderMini = context.renderMini;
  var renderAvatarPreview = context.renderAvatarPreview;
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
      P.setEffect(cfg.effect || 'water');
    }
    renderEffectPicker();
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

  var expandedModules = Object.create(null);

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
    var visibility = document.createElement('button');
    visibility.type = 'button'; visibility.className = 'btn ghost module-visibility';
    visibility.title = sec.hidden ? '显示模块' : '隐藏模块'; visibility.textContent = visibility.title;
    visibility.setAttribute('aria-pressed', sec.hidden ? 'false' : 'true');
    visibility.addEventListener('click', function (event) {
      event.stopPropagation();
      var next = Store.load(), target = next.sections.filter(function (item) { return item.id === sec.id; })[0];
      if (!target) return;
      target.hidden = !target.hidden;
      try { Store.commit(next,target.hidden ? '隐藏模块' : '显示模块'); }
      catch (error) { status(els.moduleStatus,error.message,'err'); return; }
      renderMain(); renderModuleManager();
      var nextButton = els.moduleList.querySelector('[data-section-id="' + sec.id + '"] .module-visibility');
      if (nextButton) nextButton.focus();
      if (state.draft) { state.draft = Store.load(); renderMini(); }
    });
    tools.appendChild(visibility);
    head.appendChild(el('span','module-tag module-visibility-state',sec.hidden ? '已隐藏' : '显示中'));
    head.appendChild(tools);

    var caretWrap = el('button', 'module-btn');
    caretWrap.type = 'button';
    caretWrap.setAttribute('aria-label','展开 / 收起「' + (sec.title || sec.id) + '」');
    caretWrap.setAttribute('aria-controls','module-editor-' + sec.id);
    caretWrap.innerHTML = '<svg class="module-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>';
    head.appendChild(caretWrap);

    head.addEventListener('click', function (e) {
      if (tools.contains(e.target)) return;
      toggleCard(card.classList.contains('is-collapsed'));
    });
    card.appendChild(head);

    /* ---------- 主体 ---------- */
    var body = el('div', 'module-body');
    body.id = 'module-editor-' + sec.id;
    function toggleCard(open) {
      expandedModules[sec.id] = open;
      card.classList.toggle('is-collapsed',!open); body.hidden = !open;
      caretWrap.setAttribute('aria-expanded',open ? 'true' : 'false');
    }
    caretWrap.addEventListener('click',function (event) { event.stopPropagation();toggleCard(card.classList.contains('is-collapsed')); });
    toggleCard(expandedModules[sec.id] === undefined ? index === 0 : expandedModules[sec.id]);
    if (sec.hidden) body.appendChild(el('p','field-hint','该模块已隐藏；编辑会保存内容，点击「显示模块」后恢复到简历。'));

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
      try { Store.commit(next,'重命名模块'); } catch (error) { status(els.moduleStatus,error.message,'err'); return; }
      var label = head.querySelector('.module-name'); if (label) label.textContent = target.title;
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
      try { Store.commit(next,'切换模块版式'); } catch (error) { status(els.moduleStatus,error.message,'err'); return; }
      renderMain();
      renderModuleManager();
      toast('已切换为「' + SORT_LABEL_SHORT[v] + '」，可在下方填写内容');
    }));
    sortField.appendChild(el('div', 'field-hint',
      '换版式会调整内容字段，请核对结果；可用「撤销上一步」恢复。'));
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
      try { Store.commit(next,'编辑模块内容'); } catch (error) { status(els.moduleStatus,error.message,'err'); return; }
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
      var titleEl = el('span', 'module-item-title', title);
      head.appendChild(titleEl);

      var tools = el('div', 'module-tools');
      tools.appendChild(moduleBtn('up', '上移', index === 0, onUp));
      tools.appendChild(moduleBtn('down', '下移', index === total - 1, onDown));
      tools.appendChild(moduleBtn('remove', '删除这一条', false, onRemove));
      head.appendChild(tools);
      card.appendChild(head);

      /* 让调用方能只改标题文字而不重建 DOM。
         重建整份列表会把正在输入的输入框一起删掉，焦点就丢了 ——
         表现就是「打一半像有人按了回车」。 */
      card._setTitle = function (t) { titleEl.textContent = t; };
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
          /* 只更新条目标题，不重建列表 —— 重建会让输入框失焦 */
          mutate(function (t) { if (t.items[i]) t.items[i].org = v; });
          card._setTitle(v || it.title || '');
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
          /* 只更新条目标题，不重建列表 —— 重建会让输入框失焦 */
          mutate(function (t) { if (t.items[i]) t.items[i].org = v; });
          card._setTitle(v || it.degree || '');
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
    if (!sec) { status(els.moduleStatus,'模块已不存在，未执行删除','warn'); return; }
    var hasContent = false;
    try { hasContent = JSON.stringify(sec).length > 120; } catch (e) { hasContent = true; }
    var msg = hasContent
      ? '确定删除模块「' + (title || id) + '」吗？里面的内容会一起删掉（可用「撤销上一步」找回）。'
      : '确定删除模块「' + (title || id) + '」吗？';
    if (!global.confirm(msg)) return;

    var next;
    try { next = Store.removeSection(id); } catch (error) { status(els.moduleStatus,error.message,'err'); return; }
    if (!next) return;
    renderMain();
    renderModuleManager();
    if (state.draft) { state.draft = Store.load(); renderMini(); }
    if (els.btnUndo) els.btnUndo.disabled = !Store.canUndo();
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

    try { Store.update({ sections: sections.concat([sec]) },'新建模块'); } catch (error) { status(els.moduleStatus,error.message,'err'); return; }
    if (input) input.value = '';
    renderMain();
    renderModuleManager();
    if (els.btnUndo) els.btnUndo.disabled = !Store.canUndo();

    status(els.moduleStatus,
      '已新建「' + title + '」（版式：' + (SORT_LABEL_SHORT[sort] || sort) + '），在下面填写内容即可', 'ok');
    toast('已新建模块「' + title + '」');

    /* 滚到新模块并聚焦名称输入框 */
    var card = els.moduleList && els.moduleList.querySelector('[data-section-id="' + id + '"]');
    if (card) {
      expandedModules[id] = true;
      card.classList.remove('is-collapsed');
      var body = card.querySelector('.module-body'); if (body) body.hidden = false;
      var toggle = card.querySelector('[aria-expanded]'); if (toggle) toggle.setAttribute('aria-expanded','true');
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
    if (els.llmRedact) els.llmRedact.checked = cfg.redactContacts !== false;
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
      redactContacts: !els.llmRedact || els.llmRedact.checked,
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

  function bindSettings() {
    /* ---------------- 设置页 ---------------- */
    [els.llmEnabled, els.llmRedact, els.llmKey, els.llmBase, els.llmModel, els.llmTrigger].forEach(function (n) {
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

    if (els.btnExportOld) els.btnExportOld.addEventListener('click', function () {
      var raw = Store.exportRecovery();
      if (!raw) { status(els.dataStatus, '暂无旧数据或迁移备份', 'warn'); return; }
      download('resume-旧数据备份.json', raw);
      status(els.dataStatus, '已导出原始旧数据，请妥善保存', 'ok');
    });

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
            Store.importData(obj);
            renderMain();
            state.draft = Store.load();
            renderMini();
            if (els.btnUndo) els.btnUndo.disabled = !Store.canUndo();
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
        try { Store.reset(); }
        catch (error) { status(els.dataStatus, error.message, 'err'); return; }
        renderMain();
        state.draft = Store.load();
        state.review = null;
        renderReview();
        renderMini();
        if (els.btnUndo) els.btnUndo.disabled = !Store.canUndo();
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
        applyBg(Store.bgDefaults());
        status(els.bgStatus, '已恢复默认背景（流动水面 · 100%）', 'ok');
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
        var id = sec.dataset.sectionId || sec.id;
        var t = sec.querySelector('.section-title');
        removeModule(id, t ? t.textContent : id);
      });
    }

  }

  return { applyBg: applyBg, initBg: initBg, renderModuleManager: renderModuleManager, loadSettings: loadSettings, readFile: readFile, bindSettings: bindSettings };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
