/* =============================================================================
 *  store.js —— 数据层
 * -----------------------------------------------------------------------------
 *  优先级：本地完整快照 > data.js 默认值；旧格式先备份再迁移
 *  职责：读写数据、导入导出 JSON、应用解析结果的「变更补丁」并保留撤销快照
 * ========================================================================== */
(function (global) {
  'use strict';

  var LS_DATA = 'resume.data.v1';
  var LS_THEME = 'resume.theme';
  var LS_LLM = 'resume.llm.v1';
  var LS_BG = 'resume.bg.v1';
  var LS_RECOVERY = 'resume.recovery.v1';
  var SS_HISTORY = 'resume.undo.v1';
  var history = null;
  var HISTORY_LIMIT = 10;
  function safeKey(key) { return key !== '__proto__' && key !== 'constructor' && key !== 'prototype'; }

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  /* 只对「对象」做深合并；数组整体替换（区块、项目这类列表以新数据为准） */
  function deepMerge(base, patch) {
    if (!isPlainObject(patch)) return deepClone(patch === undefined ? base : patch);
    var out = {};
    Object.keys(isPlainObject(base) ? base : {}).filter(safeKey).forEach(function (key) { out[key] = deepClone(base[key]); });
    Object.keys(patch).filter(safeKey).forEach(function (key) {
      out[key] = isPlainObject(patch[key]) ? deepMerge(out[key], patch[key]) : deepClone(patch[key]);
    });
    return out;
  }

  function deepClone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value), function (key, item) { return safeKey(key) ? item : undefined; });
  }

  function validateData(input) {
    if (!isPlainObject(input)) throw new Error('JSON 顶层必须是对象');
    var data = deepClone(input);
    if (!('profile' in data) && !('sections' in data)) throw new Error('缺少 profile / sections');
    function object(value, label) { if (!isPlainObject(value)) throw new Error(label + ' 必须是对象'); }
    function array(value, label) { if (!Array.isArray(value)) throw new Error(label + ' 必须是数组'); }
    function strings(value, keys) { keys.forEach(function (key) { if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error(key + ' 必须是字符串'); }); }
    if (data.meta !== undefined) { object(data.meta, 'meta'); strings(data.meta,['title','footer','footnote']); }
    if (data.profile === undefined) data.profile = { contacts:[] };
    object(data.profile, 'profile');
    strings(data.profile, ['name','headline','intent','avatar']);
    if (data.profile.contacts === undefined) data.profile.contacts = [];
    array(data.profile.contacts, 'contacts');
    data.profile.contacts.forEach(function (c) { object(c,'联系方式'); strings(c,['label','value','href','icon']); });
    if (data.scores != null) {
      object(data.scores,'scores'); strings(data.scores,['title']);
      if (data.scores.total !== undefined) { object(data.scores.total,'总分'); strings(data.scores.total,['label']); if (data.scores.total.value != null && !/^(string|number)$/.test(typeof data.scores.total.value)) throw new Error('分数类型不正确'); }
      if (data.scores.items === undefined) data.scores.items = [];
      array(data.scores.items,'成绩项'); data.scores.items.forEach(function (x) { object(x,'成绩'); strings(x,['label']); if (x.value != null && !/^(string|number)$/.test(typeof x.value)) throw new Error('分数类型不正确'); });
    }
    if (data.sections === undefined) data.sections = [];
    array(data.sections,'sections');
    var usedIds = Object.create(null), usedAnchors = Object.create(null);
    data.sections.forEach(function (section,index) {
      object(section,'区块'); strings(section,['id','anchor','kind','title','sort']);
      var rawId = section.id || 'section-' + index;
      var id = rawId.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'') || 'section';
      if (!/^[a-z]/.test(id) || /^(hero|page-footer|resume-root|parser-drawer|parser-overlay|scores-anchor|avatar-anchor)$/.test(id)) id = 'sec-' + id;
      var unique = id, suffix = 2;
      while (usedIds[unique]) unique = id + '-' + suffix++;
      usedIds[unique] = true;
      section.id = unique;
      if (section.anchor && (!/^[a-z][a-z0-9-]*$/.test(section.anchor) || /^(hero|page-footer|resume-root|parser-drawer|parser-overlay|scores-anchor|avatar-anchor)$/.test(section.anchor))) section.anchor = unique;
      if (unique !== rawId) section.anchor = unique;
      var anchor = section.anchor || unique, safeAnchor = anchor, anchorSuffix = 2;
      while (usedAnchors[safeAnchor]) safeAnchor = anchor + '-' + anchorSuffix++;
      usedAnchors[safeAnchor] = true;
      section.anchor = safeAnchor;
      if (section.hidden !== undefined && typeof section.hidden !== 'boolean') throw new Error('hidden 必须是布尔值');
      if (['list','cards','timeline','tags'].indexOf(section.sort) === -1) section.sort = 'list';
      var key = section.sort === 'tags' ? 'groups' : 'items';
      if (section[key] === undefined) section[key] = [];
      array(section[key],key);
      section[key].forEach(function (item) {
        object(item,'条目'); strings(item,['org','date','degree','location','logo','title','text']);
        if (section.sort === 'tags') {
          array(item.items,'技能'); item.items.forEach(function (tag) { object(tag,'技能'); strings(tag,['text','level']); });
        }
        if (item.bullets !== undefined) { array(item.bullets,'bullets'); if (item.bullets.some(function (v) { return typeof v !== 'string'; })) throw new Error('要点必须是字符串'); }
        if (item.blocks !== undefined) { array(item.blocks,'blocks'); item.blocks.forEach(function (block) { object(block,'内容块'); strings(block,['label','text']); }); }
      });
    });
    return data;
  }

  function readHistory() {
    if (history !== null) return history;
    try { history = JSON.parse(global.sessionStorage.getItem(SS_HISTORY) || '[]'); if (!Array.isArray(history)) history = []; }
    catch (_) { history = []; }
    history = history.slice(-HISTORY_LIMIT);
    return history;
  }
  function writeHistory(value) {
    history = deepClone(value).slice(-HISTORY_LIMIT);
    try { global.sessionStorage.setItem(SS_HISTORY, JSON.stringify(history)); Store.historyNotice = ''; }
    catch (_) { Store.historyNotice = '当前环境无法持久保存撤销历史，历史仅在本页有效'; }
    if (typeof Store.onHistoryChange === 'function') Store.onHistoryChange();
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
    if (!parts.every(safeKey)) return target;
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
    if (!String(path).split('.').every(safeKey)) return undefined;
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
    validateData: validateData,
    HISTORY_LIMIT: HISTORY_LIMIT,
    deepClone: deepClone,
    setByPath: setByPath,
    getByPath: getByPath,

    defaults: defaults,

    /** 所有有效的旧格式都是待迁移数据，而不是应丢弃的覆盖。 */
    hasOverride: function () {
      try { return !!localStorage.getItem(LS_DATA); } catch (_) { return false; }
    },

    recoveryRaw: null,
    recoveryPending: false,
    dataNotice: '',
    exportRecovery: function () {
      if (this.recoveryRaw) return this.recoveryRaw;
      try { var backups = JSON.parse(localStorage.getItem(LS_RECOVERY) || '[]'); return backups.length ? backups[backups.length - 1].raw : ''; } catch (_) { return ''; }
    },
    backup: function (raw, version) {
      this.recoveryRaw = raw;
      try {
        var backups = JSON.parse(localStorage.getItem(LS_RECOVERY) || '[]');
        if (!Array.isArray(backups)) backups = [];
        backups.push({version:version == null ? 'legacy' : version, at:Date.now(), raw:raw});
        localStorage.setItem(LS_RECOVERY, JSON.stringify(backups.slice(-5)));
        return true;
      } catch (_) { return false; }
    },
    migrate: function (saved) {
      // Old records were patches; merge once. New records are complete snapshots.
      var data = saved.__snapshot === 1 ? deepClone(saved) : deepMerge(defaults(), saved);
      delete data.__v; delete data.__snapshot;
      return validateData(data);
    },
    load: function () {
      var raw;
      try { raw = localStorage.getItem(LS_DATA); } catch (_) { return defaults(); }
      if (!raw) return defaults();
      var saved;
      try { saved = JSON.parse(raw); if (!isPlainObject(saved)) throw new Error('格式错误'); }
      catch (_) {
        this.recoveryRaw = raw; this.recoveryPending = true;
        this.dataNotice = '本地数据无法解析，原始数据仍保留；请导出旧数据后检查，或恢复默认数据';
        return defaults();
      }
      var version = saved.__v;
      var needsMigration = saved.__snapshot !== 1 || version !== currentVersion();
      var data;
      try { data = this.migrate(saved); }
      catch (_) {
        this.recoveryRaw = raw; this.recoveryPending = true;
        this.dataNotice = '本地数据结构不兼容，原始数据仍保留，可导出旧数据进行修复';
        return defaults();
      }
      if (needsMigration) {
        if (typeof version === 'number' && version > currentVersion()) {
          this.recoveryRaw = raw;
          this.dataNotice = '本地数据来自更新版本，当前只读取，不自动降级；可导出旧数据备份';
        } else if (this.backup(raw,version)) {
          try { this.save(data); this.dataNotice = '已迁移本地修改到当前版本，旧数据已备份，可导出旧数据'; }
          catch (_) { this.dataNotice = '迁移结果可读取，但写入失败；原始数据与备份均保留，请导出备份后释放空间'; }
        } else {
          this.recoveryPending = true;
          this.dataNotice = '备份空间不足，未改写原始数据；请先导出旧数据再释放空间';
        }
      }
      return data;
    },

    /** 整体写入（同时刷新缓存与版本戳） */
    save: function (data) {
      var copy = validateData(data);
      if (this.recoveryPending) {
        if (!this.backup(this.recoveryRaw, 'recovery')) throw new Error('旧数据尚未备份，请先导出旧数据并释放存储空间');
        this.recoveryPending = false;
      }
      if (copy.meta) copy.meta.dataVersion = currentVersion();
      copy.__v = currentVersion();
      copy.__snapshot = 1;
      try {
        localStorage.setItem(LS_DATA, JSON.stringify(copy));
      } catch (e) {
        throw new Error('本地存储写入失败（可能是隐私模式或空间不足）：' + e.message);
      }
      delete copy.__v; delete copy.__snapshot;
      return copy;
    },

    /** 界面数据修改的统一入口：失败和无变化不产生历史。 */
    commit: function (data, label) {
      var before = this.load();
      var next = validateData(data);
      var comparable = validateData(before);
      if (next.meta) next.meta.dataVersion = currentVersion();
      if (comparable.meta) comparable.meta.dataVersion = currentVersion();
      if (JSON.stringify(comparable) === JSON.stringify(next)) return before;
      var saved = this.save(next);
      this.pushUndo(before, label || '编辑简历');
      return saved;
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
      var before = this.load();
      var raw = null;
      try { raw = localStorage.getItem(LS_DATA); } catch (_) {}
      if (raw && !this.backup(raw, 'reset')) throw new Error('无法备份现有数据，请先导出再恢复默认数据');
      try { localStorage.removeItem(LS_DATA); } catch (e) { throw new Error('无法恢复默认数据：' + e.message); }
      this.dataNotice = ''; this.recoveryPending = false;
      if (raw) this.pushUndo(before,'恢复默认数据');
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
      return validateData(parsed);
    },

    importData: function (obj) { return this.commit(validateData(obj),'导入数据'); },

    /* -------------------------------------------------- 区块（模块）管理 */

    /**
     * 批量更新若干字段。专门用于「模块管理」这类需要连续改好几个地方的操作，
     * 只落盘一次，避免中途失败留下半改状态。
     * @param {Object} patch 形如 { 'profile.name': '张三', sections: [...] }
     *                       以 '.' 分隔的是按路径写入，其余（如 sections）是整体替换
     */
    update: function (patch, label) {
      var next = deepClone(this.load());
      Object.keys(patch || {}).forEach(function (key) {
        if (!key.split('.').every(safeKey)) return;
        if (key.indexOf('.') === -1) next[key] = deepClone(patch[key]);
        else setByPath(next, key, deepClone(patch[key]));
      });
      return this.commit(next,label || '编辑简历');
    },

    /** 删除一个区块，返回新数据 */
    removeSection: function (id) {
      var next = deepClone(this.load());
      var before = (next.sections || []).length;
      next.sections = (next.sections || []).filter(function (s) { return s.id !== id; });
      if (next.sections.length === before) return null;   /* 没找到，别白写一次 */
      return this.commit(next,'删除模块');
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
      return this.commit(next,'调整模块顺序');
    },

    /* ------------------------------------------------------------ 撤销 */
    getUndoState: function () { return deepClone(readHistory()); },
    restoreUndoState: function (state) { writeHistory(state); },
    pushUndo: function (snapshot, label) { var next = readHistory().slice(); next.push({data:validateData(snapshot),label:label || '编辑简历'}); writeHistory(next); },
    nextUndoLabel: function () { var stack=readHistory();return stack.length ? (stack[stack.length-1].label || '编辑简历') : ''; },
    canUndo: function () { return readHistory().length > 0; },
    undo: function () {
      var stack = readHistory();
      if (!stack.length) return null;
      var entry = stack[stack.length - 1];
      var restored = this.save(validateData(entry.data && !entry.profile ? entry.data : entry));
      writeHistory(stack.slice(0,-1));
      return restored;
    },

    /* ------------------------------------------------------------ 主题 */
    getThemePref: function () {
      try { return localStorage.getItem(LS_THEME) || ''; } catch (e) { return ''; }
    },

    /* -------------------------------------------------- 背景特效偏好 */
    bgDefaults: function () {
      return { effect: 'water', density: 1 };
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
        trigger: 'fallback',
        redactContacts: true
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
      [LS_DATA, LS_LLM, LS_BG, LS_THEME, LS_RECOVERY].forEach(function (k) {
        try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ }
      });
      history = [];
      try { global.sessionStorage.removeItem(SS_HISTORY); } catch (_) {}
      this.recoveryRaw = null; this.dataNotice = '';
    }
  };

  global.ResumeStore = Store;

  /* Node 环境（用于跑解析器测试）也能 require 到 */
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof window !== 'undefined' ? window : globalThis);
