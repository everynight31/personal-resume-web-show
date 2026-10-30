/* =============================================================================
 *  llm.js —— 可选的大模型增强解析（DeepSeek / 任意 OpenAI 兼容接口）
 * -----------------------------------------------------------------------------
 *  默认关闭。开启后把粘贴的简历文本发给模型做结构化抽取，输出与 parser.js
 *  完全相同的 Review 结构，因此右侧校对面板、勾选应用、撤销都不需要改。
 *
 *  安全性：Key 只存在浏览器 localStorage，只发往你自己配置的 Base URL。
 *          在公共电脑上用完请到「设置」里点「清除已保存的 Key」。
 * ========================================================================== */
(function (global) {
  'use strict';

  var DEFAULTS = {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    timeoutMs: 60000,
    redactContacts: true
  };

  /* 给模型的字段说明：与 data.js 的结构一一对应 */
  var SCHEMA_PROMPT = [
    '你是一个简历结构化抽取引擎。把用户给的任意格式简历文本，抽取成严格符合下面结构的 JSON。',
    '',
    'JSON 结构（未提及的字段一律用空字符串或空数组，不要编造内容）：',
    '{',
    '  "profile": {',
    '    "name": "姓名",',
    '    "headline": "一行身份说明，如：示例大学 | 本科（计算机科学与技术） | 软件工程辅修",',
    '    "intent": "报考专业 / 求职意向",',
    '    "contacts": [{"label":"电话","value":"139...","href":"tel:139...","icon":"phone"},',
    '                 {"label":"邮箱","value":"example@example.com","href":"mailto:example@example.com","icon":"mail"},',
    '                 {"label":"基本信息","value":"男 | 23岁 | 中共党员","icon":"user"}]',
    '  },',
    '  "scores": { "title":"成绩", "total":{"label":"总分","value":"90"},',
    '              "items":[{"label":"数学","value":"95"}] },   // 没有成绩/评级就返回 null',
    '  "sections": [',
    '    { "id":"education", "title":"教育背景", "sort":"timeline",',
    '      "items":[{"org":"学校名","date":"2021.09 – 2025.07","degree":"本科 · 专业名","location":"南京","bullets":["主修课程：…"]}] },',
    '    { "id":"projects", "title":"项目经历", "sort":"cards",',
    '      "items":[{"org":"项目名称","date":"2024.03 – 2024.06","title":"承担角色","location":"",',
    '                "blocks":[{"label":"技术实现","text":"…"},{"label":"项目价值","text":"…"}]}] },',
    '    { "id":"skills", "title":"相关技能", "sort":"tags",',
    '      "groups":[{"title":"编程语言","items":[{"text":"C 语言","level":"main"},{"text":"基础算法实现","level":"aux"}]}] },',
    '    { "id":"research", "title":"研究兴趣与复试方向", "sort":"list",',
    '      "items":[{"title":"关注方向","text":"…"}] }',
    '  ]',
    '}',
    '',
    '规则：',
    '1. sort 只能是 timeline（学历/时间线）、cards（项目/经历卡片）、tags（技能标签）、list（要点列表）四选一。',
    '2. 日期统一写成 "2021.09 – 2025.07" 这种 en dash 形式；进行中写 "至今"。',
    '3. level 只能是 main（硬技能：语言/框架/算法/工具）或 aux（软技能、描述性短语）。',
    '4. 原文里没有的信息必须留空，绝对不允许推测或补全。',
    '5. 不要丢弃原文信息：无法归入上述区块的内容，用一个 sort 为 list 的自定义区块装起来，title 用原文的小标题。',
    '6. 只输出 JSON 本体，不要输出 markdown 代码块标记，不要任何解释文字。'
  ].join('\n');

  function nowMs() { return Date.now(); }

  function joinUrl(base, path) {
    return String(base || '').replace(/\/+$/, '') + path;
  }

  /**
   * 调用大模型解析
   * @param {string} text 简历原文
   * @param {Object} cfg { apiKey, baseUrl, model, timeoutMs }
   * @returns {Promise<Object>} Review 结构
   */
  function requestJSON(conf, body) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        reject(new Error('请求超时，请检查接口后重试'));
        if (controller) controller.abort();
      }, conf.timeoutMs || DEFAULTS.timeoutMs);
    });
    var request = Promise.resolve().then(function () { return fetch(joinUrl(conf.baseUrl, '/chat/completions'), {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer ' + conf.apiKey},
      body:JSON.stringify(body), signal:controller ? controller.signal : undefined
    }); }).then(function (res) { return res.text().then(function (raw) {
      if (!res.ok) { var error = new Error('接口返回 ' + res.status + '：' + raw.slice(0,200)); error.status = res.status; throw error; }
      try { return JSON.parse(raw); } catch (_) { throw new Error('接口返回的不是 JSON'); }
    }); });
    return Promise.race([request,timeout]).finally(function () { clearTimeout(timer); });
  }

  function maskContacts(text) {
    var replacements = [], prefix = '__RESUME_CONTACT_';
    while (text.indexOf(prefix) !== -1) prefix += '_';
    function token(value,label) { var key=prefix+replacements.length+'__'; replacements.push({key:key,value:value,label:label}); return key; }
    var masked = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,function (value) { return token(value,'邮箱'); });
    masked = masked.replace(/(^|[^\d])((?:\+?86[\s-]*)?1[3-9]\d(?:[\s-]?\d){8})(?!\d)/g,function (_,lead,value) { return lead + token(value,'电话'); });
    function restore(value) {
      if (typeof value === 'string') { replacements.forEach(function (entry) { value=value.split(entry.key).join(entry.value); }); return value; }
      if (Array.isArray(value)) return value.map(restore);
      if (value && typeof value === 'object') { var out={}; Object.keys(value).forEach(function (key) { if (['__proto__','constructor','prototype'].indexOf(key)===-1) out[key]=restore(value[key]); }); return out; }
      return value;
    }
    return {text:masked,restore:restore,contacts:replacements};
  }

  function parseWithLLM(text, cfg) {
    var conf = Object.assign({}, DEFAULTS, cfg || {});
    if (!conf.apiKey) return Promise.reject(new Error('没有填写 API Key'));
    if (!String(text || '').trim()) return Promise.reject(new Error('粘贴内容为空'));
    var masked = maskContacts(String(text));
    var body = {
      model:conf.model,temperature:0,stream:false,response_format:{type:'json_object'},
      messages:[{role:'system',content:SCHEMA_PROMPT + '\n请原样保留 __RESUME_CONTACT_ 开头的联系方式占位符。'},
        {role:'user',content:'请抽取下面这份简历：\n\n' + (conf.redactContacts ? masked.text : text)}]
    };
    var started = nowMs();
    return requestJSON(conf,body).catch(function (error) {
      if ([400,415,422].indexOf(error.status) !== -1 && /response_format|json_object|unsupported|不支持/i.test(error.message)) {
        delete body.response_format;
        return requestJSON(conf,body);
      }
      throw error;
    }).then(function (data) {
      var content=data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error('接口返回里没有内容');
      var obj=extractJSON(content);
      var review=normalizeReview(conf.redactContacts ? masked.restore(obj) : obj,text);
      if (conf.redactContacts) masked.contacts.forEach(function (entry) {
        var value=entry.label==='电话' ? entry.value.replace(/^\+?86[\s-]*/, '').replace(/[\s-]/g,'') : entry.value;
        if (!review.profile.contacts.some(function (c) { return c.value===value || c.value===entry.value; })) review.profile.contacts.push({label:entry.label,value:value,href:defaultHref(entry.label,value),icon:entry.label==='电话'?'phone':'mail'});
      });
      review.mode='llm';review.elapsed=nowMs()-started;review.usage=data.usage||null;review.quality=scoreLLM(review);
      return review;
    });
  }

  /** 从模型输出里抠出 JSON（容忍 ```json 包裹或前后废话） */
  function extractJSON(content) {
    var s = String(content || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(s); } catch (e) { /* 继续尝试 */ }

    var start = s.indexOf('{');
    var end = s.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(s.slice(start, end + 1)); } catch (e2) { /* 放弃 */ }
    }
    throw new Error('模型没有返回可解析的 JSON');
  }

  var ICON_BY_LABEL = { '电话': 'phone', '手机': 'phone', '邮箱': 'mail', '主页': 'link', '个人主页': 'link', '基本信息': 'user' };
  var SORTS = { timeline: 1, cards: 1, tags: 1, list: 1 };

  /** 把模型输出规整成 parser.js 同款的 Review（缺字段补空，防止 UI 崩） */
  function normalizeReview(obj, sourceText) {
    var warnings = [];
    var profileIn = (obj && obj.profile) || {};
    var profile = {
      name: str(profileIn.name),
      headline: str(profileIn.headline),
      intent: str(profileIn.intent),
      contacts: []
    };

    (Array.isArray(profileIn.contacts) ? profileIn.contacts : []).forEach(function (c) {
      if (!c) return;
      var label = str(c.label) || '其他';
      var value = str(c.value);
      if (!value) return;
      profile.contacts.push({
        label: label,
        value: value,
        href: global.ResumeHelpers && typeof global.ResumeHelpers.safeHref === 'function' ? global.ResumeHelpers.safeHref(str(c.href) || defaultHref(label, value)) : '',
        icon: str(c.icon) || ICON_BY_LABEL[label] || 'spark'
      });
    });

    var scores = null;
    if (obj && obj.scores && (obj.scores.total || (obj.scores.items && obj.scores.items.length))) {
      scores = {
        title: str(obj.scores.title) || '成绩',
        total: { label: str(obj.scores.total && obj.scores.total.label) || '总分', value: str(obj.scores.total && obj.scores.total.value) },
        items: (Array.isArray(obj.scores.items) ? obj.scores.items : []).map(function (it) {
          return { label: str(it && it.label), value: str(it && it.value) };
        }).filter(function (it) { return it.label; })
      };
    }

    var sections = [];
    var usedIds = Object.create(null);
    (Array.isArray(obj && obj.sections) ? obj.sections : []).forEach(function (s) {
      if (!s) return;
      var sort = SORTS[s.sort] ? s.sort : 'list';
      var sec = {
        id: global.ResumeHelpers && typeof global.ResumeHelpers.sectionId === 'function' ? global.ResumeHelpers.sectionId(str(s.id),usedIds) : 'sec-' + sections.length,
        kind: str(s.id).toLowerCase().replace(/[^a-z0-9-]/g,'-'),
        title: str(s.title) || '未命名区块',
        sort: sort,
        src: 'llm'
      };

      if (sort === 'tags') {
        sec.groups = (Array.isArray(s.groups) ? s.groups : []).map(function (g) {
          return {
            title: str(g && g.title) || '技能',
            items: (Array.isArray(g && g.items) ? g.items : []).map(function (t) {
              return { text: str(t && t.text !== undefined ? t.text : t), level: (t && t.level) === 'main' ? 'main' : 'aux' };
            }).filter(function (t) { return t.text; })
          };
        }).filter(function (g) { return g.items.length; });
      } else if (sort === 'timeline') {
        sec.items = (Array.isArray(s.items) ? s.items : []).map(function (it) {
          return {
            org: str(it && it.org),
            date: str(it && it.date),
            degree: str(it && it.degree),
            location: str(it && it.location),
            logo: global.ResumeHelpers && typeof global.ResumeHelpers.safeImageSrc === 'function' ? global.ResumeHelpers.safeImageSrc(it && it.logo) : '',
            bullets: (Array.isArray(it && it.bullets) ? it.bullets : []).map(str).filter(Boolean)
          };
        }).filter(function (it) { return it.org || it.degree; });
      } else if (sort === 'cards') {
        sec.items = (Array.isArray(s.items) ? s.items : []).map(function (it) {
          return {
            org: str(it && it.org),
            date: str(it && it.date),
            title: str(it && it.title),
            location: str(it && it.location),
            logo: global.ResumeHelpers && typeof global.ResumeHelpers.safeImageSrc === 'function' ? global.ResumeHelpers.safeImageSrc(it && it.logo) : '',
            blocks: (Array.isArray(it && it.blocks) ? it.blocks : []).map(function (b) {
              return { label: str(b && b.label), text: str(b && b.text) };
            }).filter(function (b) { return b.label || b.text; })
          };
        }).filter(function (it) { return it.org; });
      } else {
        sec.items = (Array.isArray(s.items) ? s.items : []).map(function (it) {
          return { title: str(it && it.title), text: str(it && it.text) };
        }).filter(function (it) { return it.text || it.title; });
      }

      if ((sec.items && sec.items.length) || (sec.groups && sec.groups.length)) sections.push(sec);
    });

    if (!sections.length) warnings.push('模型没有抽到任何区块，请检查粘贴内容或换个模型再试。');

    return {
      mode: 'llm',
      profile: profile,
      scores: scores,
      sections: sections,
      warnings: warnings,
      unparsed: [],
      sourceLength: String(sourceText || '').length
    };
  }

  function defaultHref(label, value) {
    if (/电话|手机/.test(label)) return 'tel:' + value.replace(/\s|-/g, '');
    if (/邮箱|mail/i.test(label)) return 'mailto:' + value;
    if (/主页|网站|链接|http/i.test(value)) return /^https?:/.test(value) ? value : 'https://' + value;
    return '';
  }

  function str(v) { return v == null ? '' : String(v).trim(); }

  function scoreLLM(review) {
    var hits = 0, total = 6;
    if (review.profile.name) hits++;
    if (review.profile.contacts.length) hits++;
    if (review.profile.intent || review.scores) hits++;
    if (review.sections.some(function (s) { return (s.kind || s.id) === 'education'; })) hits++;
    if (review.sections.some(function (s) { return (s.kind || s.id) === 'projects' || s.sort === 'cards'; })) hits++;
    if (review.sections.some(function (s) { return s.sort === 'tags' || s.sort === 'list'; })) hits++;
    return global.ResumeHelpers && typeof global.ResumeHelpers.qualityResult === 'function' ? global.ResumeHelpers.qualityResult(hits,total,'llm') : {score:Math.round(hits/total*100),label:'请核对识别结果',hits:hits,lines:total,mode:'llm'};
  }

  /** 连通性自检：发一条极短请求，只验证鉴权与网络 */
  function testConnection(cfg) {
    var conf = Object.assign({}, DEFAULTS, cfg || {});
    if (!conf.apiKey) return Promise.reject(new Error('没有填写 API Key'));
    var t0 = nowMs();
    return requestJSON(conf,{ model:conf.model,stream:false,max_tokens:4,messages:[{role:'user',content:'回复两个字：可用'}] })
      .then(function () { return {ok:true,elapsed:nowMs()-t0}; });
  }

  global.ResumeLLM = {
    DEFAULTS: DEFAULTS,
    SCHEMA_PROMPT: SCHEMA_PROMPT,
    parseWithLLM: parseWithLLM,
    normalizeReview: normalizeReview,
    testConnection: testConnection,
    extractJSON: extractJSON
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.ResumeLLM;
})(typeof window !== 'undefined' ? window : globalThis);
