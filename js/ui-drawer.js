/* UI drawer: IIFE factory; works with file:// and ordinary script tags. */
(function (global) {
  'use strict';
  global.ResumeUIDrawer = { create: function (context) {
  var Store = context.Store;
  var Parser = context.Parser;
  var Render = context.Render;
  var els = context.els;
  var state = context.state;
  var renderReview = context.renderReview;
  var renderMini = context.renderMini;
  var loadSettings = context.loadSettings;
  /* ================================================================ 抽屉 */

  var drawerCloseTimer = null;
  var backgroundState = [];
  var previousOverflow = '';

  function lockBackground() {
    previousOverflow = document.body.style.overflow;
    backgroundState = Array.prototype.map.call(document.querySelectorAll('body > .container, body > .fab-wrap, body > .skip-link'), function (node) {
      var entry = { node: node, inert: node.inert };
      node.inert = true;
      return entry;
    });
    document.body.style.overflow = 'hidden';
  }

  function unlockBackground() {
    backgroundState.forEach(function (entry) { entry.node.inert = entry.inert; });
    backgroundState = [];
    document.body.style.overflow = previousOverflow;
  }

  function openDrawer() {
    if (!els.drawer) return;
    if (els.drawer.classList.contains('is-open')) return;
    clearTimeout(drawerCloseTimer);
    state.lastFocus = document.activeElement;
    els.drawer.hidden = false;
    if (els.overlay) els.overlay.hidden = false;
    void els.drawer.offsetWidth;
    els.drawer.classList.add('is-open');
    if (els.overlay) els.overlay.classList.add('is-open');
    if (els.fab) els.fab.setAttribute('aria-expanded', 'true');
    lockBackground();
    if (els.close) els.close.focus();

    /* 首次打开：预填模板 + 渲染预览 */
    if (els.rawInput && !els.rawInput.value.trim()) els.rawInput.value = Parser.TEMPLATE;
    if (!state.review) renderReview();
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
    unlockBackground();
    drawerCloseTimer = setTimeout(function () {
      els.drawer.hidden = true;
      if (els.overlay) els.overlay.hidden = true;
    }, 340);
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  }

  /* ================================================================ 主题 */

  function bindDrawer() {
    if (els.fab) els.fab.addEventListener('click', openDrawer);
    if (els.close) els.close.addEventListener('click', closeDrawer);
    if (els.overlay) els.overlay.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' && els.drawer && els.drawer.classList.contains('is-open')) {
        var focusable = Array.prototype.filter.call(els.drawer.querySelectorAll('button, a[href], input, textarea, select, [tabindex]'), function (node) {
          return !node.disabled && node.tabIndex >= 0 && node.getClientRects().length > 0;
        });
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (first && e.shiftKey && (document.activeElement === first || !els.drawer.contains(document.activeElement))) {
          e.preventDefault(); last.focus();
        } else if (last && !e.shiftKey && (document.activeElement === last || !els.drawer.contains(document.activeElement))) {
          e.preventDefault(); first.focus();
        }
      }
      if (e.key === 'Escape') {
        if (els.drawer && !els.drawer.hidden) closeDrawer();
      }
      /* Ctrl/Cmd + K 快速打开识别面板 */
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        openDrawer();
        if (els.rawInput && els.rawInput.getClientRects().length) els.rawInput.focus();
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
          b.tabIndex = on ? 0 : -1;
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
      btn.addEventListener('keydown', function (e) {
        var tabs = Array.prototype.slice.call(document.querySelectorAll('.seg-btn'));
        var index = tabs.indexOf(btn);
        if (e.key === 'ArrowRight') index = (index + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
        else if (e.key === 'Home') index = 0;
        else if (e.key === 'End') index = tabs.length - 1;
        else return;
        e.preventDefault();
        tabs[index].click();
        tabs[index].focus();
      });
    });

  }

  return { openDrawer: openDrawer, closeDrawer: closeDrawer, bindDrawer: bindDrawer };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
