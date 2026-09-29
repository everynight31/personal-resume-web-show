/* =============================================================================
 *  store.js —— 数据层
 * -----------------------------------------------------------------------------
 *  优先级：localStorage 覆盖  >  data.js 默认值
 *  职责：读写数据、导入导出 JSON、应用解析结果的「变更补丁」并保留撤销快照
 * ========================================================================== */
(function (global) {
  'use strict';

  var LS_DATA = 'resume.data.v1';
  var LS_THEME = 'resume.theme';
  var LS_LLM = 'resume.llm.v1';
  var LS_BG = 'resume.bg.v1';

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  /* 只对「对象」做深合并；数组整体替换（区块、项目这类列表以新数据为准） */
  function deepMerge(base, patch) {
    if (!isPlainObject(patch)) return patch === undefined ? base : patch;
    var out = isPlainObject(base) ? Object.assign({}, base) : {};
    Object.keys(patch).forEach(function (k) {
      var pv = patch[k];
      out[k] = isPlainObject(pv) ? deepMerge(out[k], pv) : pv;
    });
    return out;
  }

  function deepClone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  function defaults() {
    return deepClone(global.RESUME_DATA || {});
  }

  /** 当前默认数据的版本号（data.js 的 meta.dataVersion，默认 1） */
  function currentVersion() {
    var d = global.RESUME_DATA || {};
    var v = d.meta && d.meta.dataVersion;
    return typeof v === 'number' ? v : 1;
  }

  /* 把 "a.b.c" 路径写进对象，自动创建中间层级 */
  function setByPath(target, path, value) {
    var parts = String(path).split('.');
    var node = target;
    for (var i = 0; i < parts.length - 1; i++) {
      var key = parts[i];
      if (!isPlainObject(node[key]) && !Array.isArray(node[key])) node[key] = {};
      node = node[key];
    }
    node[parts[parts.length - 1]] = value;
    return target;
  }

  function getByPath(target, path) {
    return String(path).split('.').reduce(function (node, key) {
      return node == null ? undefined : node[key];
    }, target);
  }

  var Store = {
    LS_DATA: LS_DATA,
    LS_THEME: LS_THEME,
    LS_LLM: LS_LLM,
    LS_BG: LS_BG,
    deepMerge: deepMerge,
    deepClone: deepClone,
    setByPath: setByPath,
    getByPath: getByPath,

    defaults: defaults,

    /** 是否已存在本地改动（会顺带判断版本是否仍然有效） */
    hasOverride: function () {
      var raw = null;
      try { raw = localStorage.getItem(LS_DATA); } catch (e) { return false; }
      if (!raw) return false;
      try {
        var saved = JSON.parse(raw);
        return typeof (saved && saved.__v) === 'number' && saved.__v === currentVersion();
      } catch (e) {
        return false;
      }
    },

    /**
     * 读取当前生效数据（默认值 + 本地覆盖）
     * 覆盖里存了写入时的 dataVersion；若与当前默认数据版本不一致，说明 data.js 被改过，
     * 旧覆盖直接丢弃并清出 localStorage，避免「改了 data.js 却看不到变化」。
     */
    load: function () {
      var base = defaults();
      var raw = null;
      try { raw = localStorage.getItem(LS_DATA); } catch (e) { return base; }
      if (!raw) return base;

      var saved;
      try {
        saved = JSON.parse(raw);
      } catch (e) {
        console.warn('[store] 本地数据损坏，已回退到默认数据：', e);
        this._discardStale('本地数据无法解析');
        return base;
      }

      var ver = saved && saved.__v;
      var expect = currentVersion();
      /* 老版本存的覆盖没有 __v 字段 → 视为过期；有版本号但不一致 → 也过期 */
      if (typeof ver !== 'number' || ver !== expect) {
        this._discardStale('默认数据已更新到 v' + expect + '，本地覆盖是 ' +
          (typeof ver === 'number' ? 'v' + ver : '旧版本格式'));
        return base;
      }

      delete saved.__v;
      return deepMerge(base, saved);
    },

    /** 丢弃过期的本地覆盖，并记下提示文案供 UI 展示 */
    _discardStale: function (why) {
      try { localStorage.removeItem(LS_DATA); } catch (e) { /* 忽略 */ }
      this.lastDiscard = why || '本地覆盖已过期';
      console.warn('[store] 已丢弃过期的本地数据：' + this.lastDiscard);
    },

    /** 整体写入（同时刷新缓存与版本戳） */
    save: function (data) {
      var copy = deepClone(data);
      if (copy.meta) copy.meta.dataVersion = currentVersion();
      copy.__v = currentVersion();
      try {
        localStorage.setItem(LS_DATA, JSON.stringify(copy));
      } catch (e) {
        throw new Error('本地存储写入失败（可能是隐私模式或空间不足）：' + e.message);
      }
      delete copy.__v;
      return copy;
    },

    /**
     * 应用一组补丁
     * @param {Array<{path:string, value:*}>} patches
     * @returns {{data:Object, snapshot:Object}} 新数据 + 撤销快照
     */
    applyPatches: function (patches) {
      var before = this.load();
      var next = deepClone(before);
      (patches || []).forEach(function (p) {
        if (!p || !p.path) return;
        setByPath(next, p.path, p.value);
      });
      this.save(next);
      return { data: next, snapshot: before };
    },

    /** 恢复 data.js 默认数据（清掉本地覆盖） */
    reset: function () {
      try { localStorage.removeItem(LS_DATA); } catch (e) { /* 忽略 */ }
      return defaults();
    },

    exportJSON: function () {
      return JSON.stringify(this.load(), null, 2);
    },

    /** 导入 JSON 文本，返回解析后的数据（调用方决定是否落盘） */
    parseJSON: function (text) {
      var parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        throw new Error('不是合法的 JSON：' + e.message);
      }
      if (!isPlainObject(parsed)) throw new Error('JSON 顶层必须是一个对象');
      if (!parsed.profile && !parsed.sections) {
        throw new Error('缺少 profile / sections 字段，可能不是本简历导出的文件');
      }
      return parsed;
    },

    importData: function (obj) {
      return this.save(deepMerge(defaults(), obj));
    },

    /* -------------------------------------------------- 区块（模块）管理 */

    /**
     * 批量更新若干字段。专门用于「模块管理」这类需要连续改好几个地方的操作，
     * 只落盘一次，避免中途失败留下半改状态。
     * @param {Object} patch 形如 { 'profile.name': '张三', sections: [...] }
     *                       以 '.' 分隔的是按路径写入，其余（如 sections）是整体替换
     */
    update: function (patch) {
      var next = deepClone(this.load());
      Object.keys(patch || {}).forEach(function (key) {
        if (key.indexOf('.') === -1) next[key] = deepClone(patch[key]);
        else setByPath(next, key, deepClone(patch[key]));
      });
      return this.save(next);
    },

    /** 删除一个区块，返回新数据 */
    removeSection: function (id) {
      var next = deepClone(this.load());
      var before = (next.sections || []).length;
      next.sections = (next.sections || []).filter(function (s) { return s.id !== id; });
      if (next.sections.length === before) return null;   /* 没找到，别白写一次 */
      return this.save(next);
    },

    /**
     * 上下移动区块（区块顺序就是页面上的顺序）
     * @param {string} id
     * @param {number} delta -1 上移 / +1 下移
     */
    moveSection: function (id, delta) {
      var next = deepClone(this.load());
      var list = next.sections || [];
      var i = -1;
      for (var k = 0; k < list.length; k++) if (list[k].id === id) { i = k; break; }
      if (i === -1) return null;
      var j = i + delta;
      if (j < 0 || j >= list.length) return null;         /* 已经在头/尾 */
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
      return this.save(next);
    },

    /* ------------------------------------------------------------ 撤销 */
    _undo: null,

    pushUndo: function (snapshot) {
      this._undo = deepClone(snapshot);
    },

    canUndo: function () {
      return !!this._undo;
    },

    undo: function () {
      if (!this._undo) return null;
      var snap = this._undo;
      this._undo = null;
      return this.save(snap);
    },

    /* ------------------------------------------------------------ 主题 */
    getThemePref: function () {
      try { return localStorage.getItem(LS_THEME) || ''; } catch (e) { return ''; }
    },

    /* -------------------------------------------------- 背景特效偏好 */
    bgDefaults: function () {
      return { effect: 'network', density: 1 };
    },

    getBg: function () {
      var base = this.bgDefaults();
      try {
        var raw = localStorage.getItem(LS_BG);
        if (!raw) return base;
        return deepMerge(base, JSON.parse(raw));
      } catch (e) {
        return base;
      }
    },

    /**
     * 合并写入背景配置。
     * 注意基准必须是「当前已保存的配置」而不是 bgDefaults()，
     * 否则 setBg({density}) 会把 effect 一起冲回默认值。
     */
    setBg: function (cfg) {
      var merged = deepMerge(this.getBg(), cfg || {});
      var d = Number(merged.density);
      merged.density = isFinite(d) ? Math.max(0.4, Math.min(2, d)) : 1;
      if (!merged.effect) merged.effect = this.bgDefaults().effect;
      try { localStorage.setItem(LS_BG, JSON.stringify(merged)); } catch (e) { /* 忽略 */ }
      return merged;
    },

    setThemePref: function (theme) {
      try {
        if (theme) localStorage.setItem(LS_THEME, theme);
        else localStorage.removeItem(LS_THEME);
      } catch (e) { /* 忽略 */ }
    },

    /* -------------------------------------------------------- 大模型配置 */
    llmDefaults: function () {
      return {
        enabled: false,
        apiKey: '',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        trigger: 'fallback'
      };
    },

    getLLM: function () {
      var base = this.llmDefaults();
      try {
        var raw = localStorage.getItem(LS_LLM);
        if (!raw) return base;
        return deepMerge(base, JSON.parse(raw));
      } catch (e) {
        return base;
      }
    },

    setLLM: function (cfg) {
      var merged = deepMerge(this.llmDefaults(), cfg || {});
      try { localStorage.setItem(LS_LLM, JSON.stringify(merged)); } catch (e) { /* 忽略 */ }
      return merged;
    },

    clearLLMKey: function () {
      var cfg = this.getLLM();
      cfg.apiKey = '';
      return this.setLLM(cfg);
    },

    /** 清空本工具写入的全部本地数据 */
    wipeLocal: function () {
      [LS_DATA, LS_LLM, LS_BG].forEach(function (k) {
        try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ }
      });
      this._undo = null;
    }
  };

  global.ResumeStore = Store;

  /* Node 环境（用于跑解析器测试）也能 require 到 */
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof window !== 'undefined' ? window : globalThis);
