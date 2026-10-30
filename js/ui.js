/* =============================================================================
 *  ui.js —— 交互启动：元素绑定、共享状态、模块装配、主题与页面启动
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
    checked: {},
    chosen: {},         /* 明确操作过的勾选，区别于未识别的默认状态 */         /* path -> boolean，默认全选 */
    edited: {},          /* path -> true，表示这个字段被手动改过 */
    sectionEdits: {},    /* sectionId -> 该模块的编辑结果（未识别到的模块会走到这里） */
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

  /* ================================================================== 应用 */

  function renderMain() {
    if (!els.root) return;
    Render.renderInto(els.root, Store.load(), { animate: true });
    initScrollSpy();
  }

  function setTheme(theme, manual) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-theme-source', manual ? 'manual' : 'system');
    if (manual) Store.setThemePref(theme);
    updateThemeButton(theme);
    if (global.ResumeParticles) global.ResumeParticles.redraw();
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  function updateThemeButton(theme) {
    if (!els.themeToggle) return;
    var label = theme === 'dark' ? '切换浅色模式' : '切换深色模式';
    els.themeToggle.title = label;
    els.themeToggle.setAttribute('aria-label', label);
    els.themeToggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  }

  /* ============================================================ 滚动高亮 */

  var spyObserver = null;
  function initScrollSpy() {
    if (spyObserver) spyObserver.disconnect();
    var nav = document.querySelector('#resume-root .section-nav');
    if (!nav || !('IntersectionObserver' in window)) return;

    var pills = {};
    Array.prototype.forEach.call(nav.querySelectorAll('.nav-pill'), function (a) {
      pills[a.getAttribute('href').slice(1)] = a;
    });

    spyObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var a = pills[e.target.id];
        if (!a) return;
        if (e.isIntersecting) {
          Object.keys(pills).forEach(function (k) {
            pills[k].classList.remove('is-active');
            pills[k].removeAttribute('aria-current');
          });
          a.classList.add('is-active');
          a.setAttribute('aria-current', 'location');
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });

    Array.prototype.forEach.call(document.querySelectorAll('#resume-root .resume-section'), function (s) {
      if (s.id) spyObserver.observe(s);
    });
  }

  /* ============================================================ 背景特效 */

  /* ================================================================== 绑定 */

  function bind() {
    bindDrawer();
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
        Object.keys(state.checked).forEach(function (p) { state.checked[p] = true; state.chosen[p] = true; });
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
        Object.keys(state.checked).forEach(function (p) { state.checked[p] = false; state.chosen[p] = true; });
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

    bindSettings();
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
    updateThemeButton(currentTheme());

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

  var context = {
    Store: Store,
    Parser: Parser,
    Render: Render,
    LLM: LLM,
    Skills: Skills,
    H: H,
    els: els,
    state: state,
    el: el,
    toast: toast,
    status: status,
    debounce: debounce,
    clone: clone,
    escapeHtml: escapeHtml,
    setBusy: setBusy,
    renderMain: renderMain,
    initScrollSpy: initScrollSpy,
    setTheme: setTheme,
    currentTheme: currentTheme,
    updateThemeButton: updateThemeButton,
    blocksToText: blocksToText,
    textToBlocks: textToBlocks,
    fieldMeta: fieldMeta,
    valueToText: valueToText,
    textToValue: textToValue,
    updateApplyState: updateApplyState,
    renderReview: renderReview,
    refreshGroups: refreshGroups,
    rebuildDraft: rebuildDraft,
    applyReview: applyReview,
    runParse: runParse,
    renderMini: renderMini,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    bindDrawer: bindDrawer,
    renderAvatarPreview: renderAvatarPreview,
    initAvatar: initAvatar,
    applyBg: applyBg,
    initBg: initBg,
    renderModuleManager: renderModuleManager,
    loadSettings: loadSettings,
    readFile: readFile,
    bindSettings: bindSettings
  };
  var codecUI = global.ResumeUICodec.create(context);
  function blocksToText() { return codecUI.blocksToText.apply(null, arguments); }
  function textToBlocks() { return codecUI.textToBlocks.apply(null, arguments); }
  function fieldMeta() { return codecUI.fieldMeta.apply(null, arguments); }
  function valueToText() { return codecUI.valueToText.apply(null, arguments); }
  function textToValue() { return codecUI.textToValue.apply(null, arguments); }
  var reviewUI = global.ResumeUIReview.create(context);
  function updateApplyState() { return reviewUI.updateApplyState.apply(null, arguments); }
  function renderReview() { return reviewUI.renderReview.apply(null, arguments); }
  function refreshGroups() { return reviewUI.refreshGroups.apply(null, arguments); }
  function rebuildDraft() { return reviewUI.rebuildDraft.apply(null, arguments); }
  function applyReview() { return reviewUI.applyReview.apply(null, arguments); }
  function runParse() { return reviewUI.runParse.apply(null, arguments); }
  function renderMini() { return reviewUI.renderMini.apply(null, arguments); }
  var drawerUI = global.ResumeUIDrawer.create(context);
  function openDrawer() { return drawerUI.openDrawer.apply(null, arguments); }
  function closeDrawer() { return drawerUI.closeDrawer.apply(null, arguments); }
  function bindDrawer() { return drawerUI.bindDrawer.apply(null, arguments); }
  var avatarUI = global.ResumeUIAvatar.create(context);
  function renderAvatarPreview() { return avatarUI.renderAvatarPreview.apply(null, arguments); }
  function initAvatar() { return avatarUI.initAvatar.apply(null, arguments); }
  var settingsUI = global.ResumeUISettings.create(context);
  function applyBg() { return settingsUI.applyBg.apply(null, arguments); }
  function initBg() { return settingsUI.initBg.apply(null, arguments); }
  function renderModuleManager() { return settingsUI.renderModuleManager.apply(null, arguments); }
  function loadSettings() { return settingsUI.loadSettings.apply(null, arguments); }
  function readFile() { return settingsUI.readFile.apply(null, arguments); }
  function bindSettings() { return settingsUI.bindSettings.apply(null, arguments); }

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
