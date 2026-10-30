/* UI codec: IIFE factory; works with file:// and ordinary script tags. */
(function (global) {
  'use strict';
  global.ResumeUICodec = { create: function (context) {
  var Skills = context.Skills;
  /* ====================================================== 文本 ⇄ 值 的互转 */

  var SEP = '·';                 /* 标签与内容的分隔符，避开正文里的中文冒号 */
  var BULLET = /^\s*[-–—•*]\s*/;

  function separatorIndex(text) { return text.search(/·(?=\s)/); }

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
      var i = separatorIndex(l);
      if (i === -1) return { label: '', text: l };
      return { label: l.slice(0, i).trim(), text: l.slice(i + 1).trim() };
    }).filter(Boolean);
  }

  function readableItemListToText(items, kind) {
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

  function readableTextToItemList(text, kind) {
    var lines = String(text || '').split('\n').map(function (s) { return s.replace(/\s+$/, ''); });

    if (kind === 'line') {
      return lines.map(function (s) { return s.trim(); }).filter(Boolean);
    }

    if (kind === 'kv') {
      return lines.map(function (l) {
        var t = l.trim();
        if (!t) return null;
        var i = separatorIndex(t);
        if (i === -1) i = t.search(/[:：]/);
        if (i === -1) return { label: '其他', value: t };
        return { label: t.slice(0, i).replace(/[:：]\s*$/, '').trim(), value: t.slice(i + 1).trim() };
      }).filter(function (o) { return o && (o.label || o.value); });
    }

    if (kind === 'kvtitle') {
      return lines.map(function (l) {
        var t = l.trim();
        if (!t) return null;
        var i = separatorIndex(t);
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
          var i2 = separatorIndex(body);
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
  // Keep the familiar text format when it is lossless. Structured or ambiguous
  // entries use editable JSON so separators, line breaks and metadata survive.
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      var result = {};
      Object.keys(value).sort().forEach(function (key) { result[key] = canonical(value[key]); });
      return result;
    }
    return value;
  }
  function itemListToText(items, kind) {
    var text = readableItemListToText(items, kind);
    var parsed = readableTextToItemList(text, kind);
    return JSON.stringify(canonical(items || [])) === JSON.stringify(canonical(parsed))
      ? text : JSON.stringify(items || [], null, 2);
  }
  function textToItemList(text, kind) {
    if (/^\s*\[/.test(text)) {
      var parsed;
      try { parsed = JSON.parse(text); } catch (_) { throw new Error('结构化内容格式有误，请补全 JSON 后再应用'); }
      if (!Array.isArray(parsed)) throw new Error('结构化内容必须是数组');
      var valid = parsed.every(function (item) {
        if (kind === 'line') return typeof item === 'string';
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        if (kind === 'taggroup') return Array.isArray(item.items) && item.items.every(function (tag) { return tag && typeof tag.text === 'string'; });
        return true;
      });
      if (!valid) throw new Error('结构化内容与当前字段类型不符');
      return parsed;
    }
    return readableTextToItemList(text, kind);
  }

  function fieldMeta(path, section) {
    if (path === 'profile.contacts') return { kind: 'kv', multi: true, hint: '每行一条：标签 · 内容；复杂内容使用 JSON 数组，保留标点与附加字段' };
    if (path === 'profile.avatar') return { kind: 'text', multi: false, hint: '想换照片：设置 → 头像 → 选择照片。也可以在这里填图片地址' };
    if (path === 'scores.items') return { kind: 'kv', multi: true, hint: '每行一条：项目 · 分数，例：数学 · 95' };
    if (!section) return { kind: 'text', multi: false };

    switch (section.sort) {
      case 'timeline':
        return {
          kind: 'addr', multi: true,
          hint: '支持 JSON 数组（完整保留原始字段），或每行一个学历：学校 | 日期 | 学历（专业） | 城市；下一行以 - 开头写要点，例：- 主修课程：管理学、统计学'
        };
      case 'cards':
        return {
          kind: 'card', multi: true,
          hint: '支持 JSON 数组（完整保留原始字段），或每行一个项目：项目名 | 日期 | 角色 | 地点；下一行以 - 开头写小块，例：- 技术实现· 用了什么技术做了什么'
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


  return { itemListToText:itemListToText, textToItemList:textToItemList, blocksToText: blocksToText, textToBlocks: textToBlocks, fieldMeta: fieldMeta, valueToText: valueToText, textToValue: textToValue };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
