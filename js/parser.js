/* =============================================================================
 *  parser.js —— 粘贴文本 → 结构化简历数据（一键识别的核心）
 * -----------------------------------------------------------------------------
 *  两档能力，自动选择：
 *   A. 模板模式（高准确率 ~95%）：文本里有【教育背景】【项目经历】这类小标题，
 *      或 Markdown 的 # 标题、行首 "教育背景" 独立成行。
 *   B. 自由文本降级（~70-85%）：没有任何小标题时，靠日期区间 / 电话 / 邮箱 /
 *      高校与企业关键词把整段文字切成块，再逐块归类。
 *  两种模式都输出同一份 Review 结构，交给 UI 逐字段勾选校对。
 *
 *  对外接口：
 *    ResumeParser.parse(text)        → Review
 *    ResumeParser.TEMPLATE           → 预填到输入框的模板文本
 *    ResumeParser.SAMPLE_FREETEXT    → 演示用的「无小标题」自由段落
 *    ResumeParser.parseToPatches(review) → 供 store 应用的补丁数组
 *
 *  Review 结构：
 *    {
 *      profile:  { name, headline, intent, contacts[] },
 *      scores:   { total, items[] } | null,
 *      sections: [ { id, title, sort, items | groups, src:'labeled'|'inferred' } ],
 *      warnings: [ string ],
 *      unparsed: [ string ],
 *      quality:  { score, label, hits, lines }
 *    }
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------ 常量与正则 */

  var NL = '\u2013';                       /* en dash，日期区间统一用它连接 */
  var ARROW = ' | ';

  /* 日期：2021.09 / 2021-09 / 2021/9 / 2021年9月 / 2021年 / 至今
     注意：单独一个 2 位数不算日期，否则「效率提升50%…2022.03」会被误判成区间 */
  var D = '(?:\\d{4}\\s*[.\\-/年]\\s*\\d{1,2}\\s*月?|\\d{4}\\s*年|至今|现在|今|now|Now|NOW|present|Present)';
  var RANGE_RE = new RegExp('(' + D + ')\\s*(?:--|—|–|-|~|～|至|到|to|－)\\s*(' + D + ')');
  var SINGLE_DATE_RE = new RegExp('^' + D + '$');
  /* 只有四位年份才算合法端点，避免 N-M 形式的数字区间被当成日期 */
  var YEAR_ANCHOR = /^\s*\d{4}/;
  var NOW_ANCHOR = /^\s*(?:至今|现在|今|now|present)/i;

  var RE = {
    phone: /(?:电话|手机|TEL|Tel|tel|Phone|联系方式)?\s*[:：]?\s*(1[3-9]\d{9})/,
    phoneBare: /1[3-9]\d{9}/,
    email: /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/,
    url: /((?:https?:\/\/|www\.)[^\s，。；、|]+)/i,
    nameLine: /^(?:姓名|名字|NAME|Name)\s*[:：]?\s*(.+)$/,
    headlineLine: /^(?:身份|学历|学校|一句话介绍|HEADLINE|Headline)\s*[:：]\s*(.+)$/,
    intentLine: /^(?:报考专业|报考方向|求职意向|意向岗位|目标岗位|求职目标|应聘职位|意向|应聘岗位|应聘方向)\s*[:：]?\s*([\s\S]+)$/,
    otherLine: /^(?:其他|个人情况|基本资料|个人信息|性别年龄)\s*[:：]\s*(.+)$/,
    labelLine: /^([^:：\n]{1,12})\s*[:：]\s*([\s\S]+)$/,
    scoreLine: /(初试|复试成绩|笔试成绩|考试成绩|考研成绩|综合测评|总分\s*[:：]?\s*\d)/,
    sectionHead: /^[【\[]\s*(.+?)\s*[】\]]\s*[:：]?\s*$/,
    mdHead: /^(#{1,4})\s*(.+?)\s*$/,
    /* Markdown 一级标题且紧跟联系方式时，这一行是「姓名」而不是区块名 */
    mdName: /^#\s*([\u4e00-\u9fa5·]{2,4}(?:\s+[A-Za-z][A-Za-z\s.]{0,24})?)\s*$/,
    /* 「陈晓 应聘岗位：后端开发工程师」这类把姓名和意向挤在一行的写法 */
    inlineIntent: /^([\u4e00-\u9fa5·]{2,4})\s+(应聘岗位|应聘职位|求职意向|意向岗位|目标岗位|报考专业|报考方向)\s*[:：]\s*(.+)$/,
    bullet: /^\s*(?:[•·●○◦*+\-–—>»]|\d+[.、)]|\([一二三四五六七八九十\d]+\)|[一二三四五六七八九十]+[、.])\s*/,
    /* 只把「像说明文字」的行当注释：单个 # 开头的说明句，但不吃掉 Markdown 姓名标题 */
    comment: /^\s*(?:\/\/|※|注[:：]|#(?!\s*#)\s*(?![\u4e00-\u9fa5·]{2,4}\s*(?:\||$))(?:[\u4e00-\u9fa5]{0,6}(?:说明|注意|提示|示例|格式|用法)|\S*\s*(?:把|请|例如|比如|直接|可以|不要|无需|以下|下面|上面|本行|照)))/,
    /* Markdown 一级标题里的姓名（# 示例姓名 / # 示例姓名 | 后端开发） */
    nameHeading: /^#\s+([\u4e00-\u9fa5·]{2,4})\s*(?:\||$)/,
    uni: /(大学|学院|科学院|研究院|学校|University|College|Institute|Academy)/i,
    degree: /(博士|硕士|研究生|本科|学士|专科|大专|MBA|EMBA|Ph\.?D|Master|Bachelor)/i,
    courseLabel: /^(?:主修课程|核心课程|主要课程|相关课程|课程)\s*[:：]?\s*(.+)$/,
    /* 行首的「学位标签：」前缀，如「专业：计算机科学与技术」 */
    eduLabelPrefix: /^(?:报考专业|报考方向|专业|学位|学历|培养层次|学制|学院|系别)\s*[:：]\s*/
  };

  /* 区块别名 → 标准 id（同一标准区块可命中多个别名，例如两个毕业设计） */
  var SECTION_MAP = {
    '基本信息': { id: '__basic', title: '基本信息' },
    '个人信息': { id: '__basic', title: '基本信息' },
    '联系方式': { id: '__basic', title: '基本信息' },
    '核心技能': { id: 'skills', title: '相关技能', sort: 'tags' },
    '技能': { id: 'skills', title: '相关技能', sort: 'tags' },
    '专业技能': { id: 'skills', title: '相关技能', sort: 'tags' },
    '技能特长': { id: 'skills', title: '相关技能', sort: 'tags' },
    '技能清单': { id: 'skills', title: '相关技能', sort: 'tags' },
    '能力特长': { id: 'skills', title: '相关技能', sort: 'tags' },
    '相关技能': { id: 'skills', title: '相关技能', sort: 'tags' },
    '技术能力': { id: 'skills', title: '相关技能', sort: 'tags' },
    '教育背景': { id: 'education', title: '教育背景', sort: 'timeline' },
    '教育经历': { id: 'education', title: '教育背景', sort: 'timeline' },
    '学习经历': { id: 'education', title: '教育背景', sort: 'timeline' },
    '项目经历': { id: 'projects', title: '项目经历', sort: 'cards' },
    '项目经验': { id: 'projects', title: '项目经历', sort: 'cards' },
    '项目': { id: 'projects', title: '项目经历', sort: 'cards' },
    '科研经历': { id: 'projects', title: '项目经历', sort: 'cards' },
    '工程设计': { id: 'engineering', title: '工程设计', sort: 'cards' },
    '设计经历': { id: 'engineering', title: '工程设计', sort: 'cards' },
    '实习经历': { id: 'internships', title: '实习经历', sort: 'cards' },
    '工作经历': { id: 'work', title: '工作经历', sort: 'cards' },
    '工作与实习': { id: 'work', title: '工作经历', sort: 'cards' },
    '研究兴趣': { id: 'research', title: '研究兴趣与复试方向', sort: 'list' },
    '研究兴趣与复试方向': { id: 'research', title: '研究兴趣与复试方向', sort: 'list' },
    '复试方向': { id: 'research', title: '研究兴趣与复试方向', sort: 'list' },
    '科研兴趣': { id: 'research', title: '研究兴趣与复试方向', sort: 'list' },
    '综合能力': { id: 'abilities', title: '综合能力', sort: 'list' },
    '自我评价': { id: 'abilities', title: '综合能力', sort: 'list' },
    '个人优势': { id: 'abilities', title: '综合能力', sort: 'list' },
    '其他项目': { id: 'others', title: '其他项目', sort: 'list' },
    '获奖情况': { id: 'awards', title: '荣誉奖项', sort: 'list' },
    '荣誉奖项': { id: 'awards', title: '荣誉奖项', sort: 'list' },
    '获奖经历': { id: 'awards', title: '荣誉奖项', sort: 'list' },
    '论文发表': { id: 'papers', title: '论文与专利', sort: 'list' },
    '发表论文': { id: 'papers', title: '论文与专利', sort: 'list' },
    '校园经历': { id: 'campus', title: '校园经历', sort: 'list' }
  };

  /* 自由的「列表型」区块（每条一个标题 + 一段说明） */
  var LIST_SECTIONS = { research: 1, abilities: 1, others: 1, awards: 1, papers: 1, campus: 1 };

  /* Markdown 常见行内强调记号，解析前先剥掉 */
  function stripMd(s) {
    return String(s == null ? '' : s)
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, '');   /* 只吃「整行都是分隔线」的情况 */
  }

  function normalizeText(text) {
    return String(text == null ? '' : text)
      .replace(/\r\n?/g, '\n')
      .replace(/\u00A0/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n');
  }

  function trim(s) { return String(s == null ? '' : s).trim(); }

  function cleanPiece(s) {
    return trim(stripMd(s))
      .replace(/^[-–—•·|,，、;；:：\s]+/, '')
      .replace(/[-–—|,，、;；:：\s]+$/, '')
      .trim();
  }

  function normalizeDate(s) {
    return trim(String(s == null ? '' : s)
      .replace(/\s+/g, '')
      .replace(/(\d{4})[.\-/年](\d{1,2})月?/g, function (m, y, mo) {
        return y + '.' + (mo.length === 1 ? '0' + mo : mo);
      })
      .replace(/年/g, '')
      .replace(/月/g, ''));
  }

  function dateToText(a, b) {
    return normalizeDate(a) + ' ' + NL + ' ' + normalizeDate(b);
  }

  function isDateLike(s) {
    var t = trim(s).replace(/\s+/g, '');
    if (!t) return false;
    if (SINGLE_DATE_RE.test(t)) return true;
    return RANGE_RE.test(t);
  }

  /* 行首日期（可能带后缀文字），返回 { date, rest } */
  function splitLeadingDate(line) {
    var m = RANGE_RE.exec(line);
    if (m && m.index <= 3 && isRealRange(m)) {
      return { date: dateToText(m[1], m[2]), rest: line.slice(m.index + m[0].length) };
    }
    var m2 = /^(\d{4}(?:[.\-/年]\d{1,2})?)\s*$/.exec(trim(line));
    if (m2) return { date: normalizeDate(m2[1]), rest: '' };
    return null;
  }

  /* 区间两端至少有一端是四位年份或「至今」，才算真的日期 */
  function isRealRange(m) {
    return YEAR_ANCHOR.test(m[1]) || YEAR_ANCHOR.test(m[2]) ||
      NOW_ANCHOR.test(m[1]) || NOW_ANCHOR.test(m[2]);
  }

  function splitAnyDate(line) {
    var re = new RegExp(RANGE_RE.source, 'g');
    var m;
    while ((m = re.exec(line)) !== null) {
      if (!isRealRange(m)) continue;
      return {
        date: dateToText(m[1], m[2]),
        before: trim(line.slice(0, m.index)),
        after: trim(line.slice(m.index + m[0].length))
      };
    }
    return null;
  }

  /* 用 | 分隔，也支持「两个以上空格」这种 Word 里常见的列分隔 */
  function splitParts(line) {
    return line.split(/[|｜\t]+|\u3000|\s{2,}/).map(cleanPiece).filter(function (s) { return s.length; });
  }

  /* 整行只有一段时间区间 —— 强分界信号 */
  var DATE_LINE_ONLY_RE = new RegExp('^\\s*' + D + '\\s*(?:--|—|–|-|~|～|至|到|to|－)\\s*' + D + '\\s*$');

  /* 把一段没有任何换行的长文字，按中文句末标点切成句子（仅当整段只有一个换行时启用） */
  function explodeRunOn(line) {
    if (line.length < 90) return [line];
    var parts = line.split(/(?<=[。！？；!?;])\s*/).map(trim).filter(Boolean);
    return parts.length > 1 ? parts : [line];
  }

  /* ------------------------------------------------------------ 技能词表桥接 */
  function skillsApi() {
    return global.ResumeSkills || { extractTags: function (t) { return [{ text: trim(t), level: 'aux' }]; } };
  }

  /* ------------------------------------------------------------ 解析主流程 */

  function parse(rawText) {
    var warnings = [];
    var unparsed = [];
    var text = normalizeText(rawText);

    /* 1. 拆行 + 去注释 + 修复「整段无换行」 */
    var lines = [];
    text.split('\n').forEach(function (raw) {
      var line = trim(stripMd(raw));
      if (!line) { lines.push(''); return; }
      if (RE.comment.test(line)) return;                  /* 模板注释，跳过 */
      explodeRunOn(line).forEach(function (l) { lines.push(trim(l)); });
    });

    /* 2. 分段：标题 / 正文 */
    var blocks = [];          /* [{ id, title, sort, lines:[{text, bullet}] }] */
    var head = { id: '__header', title: '基本信息', sort: 'header', lines: [] };
    var current = head;
    var sawAnyHeading = false;

    lines.forEach(function (line, lineIdx) {
      if (!line) { current.lines.push({ text: '', bullet: false }); return; }

      var bare = cleanPiece(line);

      /* 「陈晓 应聘岗位：后端开发工程师」——姓名与意向挤在一行 */
      var mi = RE.inlineIntent.exec(bare);
      if (mi) {
        head.lines.push({ text: '姓名：' + mi[1], bullet: false });
        head.lines.push({ text: mi[2] + '：' + mi[3], bullet: false });
        return;
      }

      /* Markdown 一级标题里的姓名（# 示例姓名）—— 若当年注释会被 comment 规则吃掉，这里优先识别 */
    var mnh = RE.nameHeading.exec(line);
    if (mnh && !lookupSection(cleanPiece(mnh[1]))) {
      head.lines.push({ text: '姓名：' + cleanPiece(mnh[1]), bullet: false });
      return;
    }

    var mt = RE.sectionHead.exec(line) || RE.mdHead.exec(line);
      var isMd = !!(mt && mt[2] !== undefined);
      var title = mt ? cleanPiece(isMd ? mt[2] : mt[1]) : '';
      var headingLevel = isMd ? mt[1].length : 0;
      var meta = title ? lookupSection(title) : null;

      if (meta) {
        /* Markdown 一级标题后面紧跟联系方式 → 这行其实是姓名 */
        var nextText = '';
        for (var n = lineIdx + 1; n < lines.length && n <= lineIdx + 3; n++) {
          if (trim(lines[n])) { nextText = lines[n]; break; }
        }
        var isName = headingLevel === 1 && (RE.phone.test(nextText) || RE.email.test(nextText));
        if (isName) {
          head.lines.push({ text: title, bullet: false });
          return;
        }
        sawAnyHeading = true;
        current = pushBlock(blocks, meta, title);
        return;
      }

      /* 没有【】但整行就是一个已知区块名（例如 Word 里粘出来只剩标题行）。
         lookupSection 已要求至少 3 字且必须是完整包含关系，所以这里不必再收紧，
         否则「项目经历」这类紧跟在上一段内容后面的标题会漏掉 */
      var bareMeta = (bare.length <= 12 && !RE.labelLine.test(bare) && !isDateLike(bare) &&
                      !RE.bullet.test(line) && line.trim() === bare &&
                      !/^[\d\s.\-–—~～至/年月]+$/.test(bare))
        ? lookupSection(bare) : null;
      if (bareMeta) {
        sawAnyHeading = true;
        current = pushBlock(blocks, bareMeta, bare);
        return;
      }

      /* Markdown 标题但不是已知区块名：
         · 一级标题，或「姓名 + 联系方式」紧随其后 → 这是姓名
         · 其余（### 项目名、## 获奖…）→ 当普通行留给当前区块处理 */
      if (isMd) {
        var nextText = '';
        for (var n2 = lineIdx + 1; n2 < lines.length && n2 <= lineIdx + 3; n2++) {
          if (trim(lines[n2])) { nextText = lines[n2]; break; }
        }
        var contactNext = RE.phone.test(nextText) || RE.email.test(nextText);
        var nameLike = headingLevel === 1 || (contactNext && RE.mdName.test(line));
        if (nameLike) {
          head.lines.push({ text: '姓名：' + cleanPiece(title), bullet: false });
        } else {
          current.lines.push({ text: line, bullet: false });
        }
        return;
      }

      /* 短标题行 + 头部还空着 → 大概率是姓名（如「示例姓名」独占一行） */
      if (!current.lines.length && head.lines.length < 2 &&
          /^[\u4e00-\u9fa5·]{2,4}(?:\s+[A-Za-z][A-Za-z\s.]{0,24})?$/.test(bare)) {
        head.lines.push({ text: bare, bullet: false });
        return;
      }

      current.lines.push({ text: line, bullet: RE.bullet.test(line) });
    });
    /* 3. 逐块抽取 */
    var profile = { name: '', headline: '', intent: '', contacts: [] };
    var scores = null;
    var sections = [];

    extractHeader(head, profile, warnings, unparsed, scores);

    blocks.forEach(function (block) {
      if (block.id === '__basic') {
        /* 显式的【基本信息】块，覆盖/补充头部抽到的信息 */
        var r = extractHeader(block, profile, warnings, unparsed, null);
        if (r && r.scores && !scores) scores = r.scores;
        return;
      }
      var built = buildSection(block, warnings, unparsed);
      if (built) sections.push(built);
    });

    /* 头部块里如果混着分数行，也提取出来 */
    if (!scores) scores = extractScores(head.lines.map(function (l) { return l.text; }));

    /* 4. 自由文本降级：一个标题都没识别到 → 走启发式切块 */
    var mode = sawAnyHeading ? 'labeled' : 'freeform';
    if (!sawAnyHeading) {
      var fb = freeformParse(lines, profile, warnings);
      sections = fb.sections;
      unparsed = unparsed.concat(fb.unparsed);
      if (!profile.name && fb.name) profile.name = fb.name;
      if (!profile.headline && fb.headline) profile.headline = fb.headline;
      if (fb.intent) profile.intent = profile.intent || fb.intent;
      if (!scores) scores = fb.scores;
    }

    sections = sections.filter(function (s) {
      return (s.items && s.items.length) || (s.groups && s.groups.length);
    });

    var quality = scoreQuality({ profile: profile, sections: sections, scores: scores, lines: lines, mode: mode, sourceText: text });
    return {
      mode: mode,
      profile: profile,
      scores: scores,
      sections: sections,
      warnings: warnings,
      unparsed: unparsed,
      sourceText: text,
      quality: quality
    };
  }

  function lookupSection(title) {
    if (!title) return null;
    var key = cleanPiece(title).replace(/[\s:：]/g, '');
    if (SECTION_MAP[key]) return SECTION_MAP[key];

    /* 宽松包含匹配：「项目经历（节选）」这类。
       要求短的一方至少 3 个字，且包含关系只认「长串含短串」，
       否则「某毕业设计」里的「管理」会命中「教育…」之类造成误判 */
    var keys = Object.keys(SECTION_MAP);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var shorter = key.length <= k.length ? key : k;
      var longer = key.length <= k.length ? k : key;
      if (shorter.length >= 3 && longer.indexOf(shorter) !== -1) {
        return SECTION_MAP[k];
      }
    }
    return null;
  }

  function pushBlock(blocks, meta, rawTitle) {
    var block = {
      id: meta.id,
      title: meta.title || cleanPiece(rawTitle),
      sort: meta.sort || 'list',
      lines: []
    };
    blocks.push(block);
    return block;
  }

  /* ------------------------------------------------------------ 基本信息块 */

  function extractHeader(block, profile, warnings, unparsed, scores) {
    var others = [];
    var looseIdentity = [];      /* 没带标签的候选「身份」行，最后挑一条最像的 */
    var textLines = block.lines.map(function (l) { return l.text; }).filter(Boolean);

    /* 把多字段挤在一行的头部信息拆开：只有在「某一段本身就是带字段名的行」时才拆，
       这样「示例大学 | 本科（计算机科学与技术） | 软件工程辅修」会保持完整，
       而「…… | 求职意向：后端开发工程师」会被拆出来单独识别 */
    var FIELD_LABEL_RE = /^(?:姓名|名字|身份|学历|学校|报考专业|报考方向|求职意向|意向岗位|目标岗位|求职目标|应聘职位|应聘岗位|应聘方向|意向|其他|个人情况|基本资料|个人信息|性别年龄|一句话介绍|电话|手机|邮箱|E-mail|Email|联系方式|主页|个人主页)\s*[:：]/i;

    var rawLines = [];
    textLines.forEach(function (rawLine) {
      var segs = /[|｜]/.test(rawLine)
        ? rawLine.split(/[|｜]/).map(function (s) { return trim(s); }).filter(Boolean)
        : [rawLine];
      var anyFieldLabeled = segs.length > 1 && segs.some(function (s) { return FIELD_LABEL_RE.test(s); });
      if (anyFieldLabeled) rawLines = rawLines.concat(segs);
      else rawLines.push(rawLine);
    });

    rawLines.forEach(function (line) {
      var m;
      if ((m = RE.nameLine.exec(line))) { profile.name = profile.name || cleanPiece(m[1]); return; }
      if ((m = RE.intentLine.exec(line))) { profile.intent = profile.intent || cleanPiece(m[1]); return; }
      if ((m = RE.otherLine.exec(line))) { others.push(cleanPiece(m[1])); return; }

      /* 成绩行单独处理，不能混进「其他」里 */
      if (RE.scoreLine.test(line)) return;

      if (RE.phone.test(line) || RE.email.test(line) || RE.url.test(line) || /(男|女)\s*[|｜]/.test(line)) {
        collectContacts(line, profile, others);
        return;
      }

      var bare = cleanPiece(line);

      /* 只有单个词的身份标签（学历 / 学制 / 学院…）→ 归入身份信息 */
      if (RE.eduLabelPrefix.test(bare)) { looseIdentity.push(bare); return; }

      if ((m = RE.headlineLine.exec(line))) { looseIdentity.push(cleanPiece(m[1])); return; }

      /* 姓名兜底：整行 2-4 个汉字且没有冒号 */
      if (!profile.name && /^[\u4e00-\u9fa5·]{2,4}$/.test(bare)) {
        profile.name = bare;
        return;
      }
      if (bare) looseIdentity.push(bare);
    });

    if (looseIdentity.length) {
      var best = pickHeadline(looseIdentity);
      if (!profile.headline) profile.headline = best;
      looseIdentity.forEach(function (t) { if (t !== best) others.push(t); });
    }

    if (others.length) {
      var merged = others.filter(Boolean).join(ARROW);
      var exists = profile.contacts.some(function (c) { return c.label === '基本信息'; });
      if (!exists && merged) profile.contacts.push({ label: '基本信息', value: merged, icon: 'user' });
    }

    var sc = extractScores(textLines);
    if (scores && sc) { scores.total = sc.total; scores.items = sc.items; }
    return { scores: sc };
  }

  /* 在一堆没有标签的行里，挑出最像「一行身份说明」的那条 */
  function pickHeadline(list) {
    var best = '';
    var bestScore = -1;
    list.forEach(function (t) {
      var s = 0;
      if (/\|/.test(t)) s += 2;
      if (RE.uni.test(t)) s += 3;
      if (RE.degree.test(t)) s += 2;
      if (t.length >= 8 && t.length <= 80) s += 2;
      else if (t.length > 120) s -= 2;
      if (/[:：]/.test(t)) s -= 1;
      if (s > bestScore) { bestScore = s; best = t; }
    });
    return best;
  }

  function collectContacts(line, profile, others) {
    var rest = line;
    RE.phone.lastIndex = 0;   /* 该正则带 g 标志，复用前必须重置 */
    RE.email.lastIndex = 0;
    RE.url.lastIndex = 0;

    var mp = RE.phone.exec(rest);
    if (mp) {
      if (!hasContact(profile, '电话')) profile.contacts.push({ label: '电话', value: mp[1], href: 'tel:' + mp[1], icon: 'phone' });
      rest = rest.replace(mp[0], ' ');
    }
    var me = RE.email.exec(rest);
    if (me) {
      if (!hasContact(profile, '邮箱')) profile.contacts.push({ label: '邮箱', value: me[1], href: 'mailto:' + me[1], icon: 'mail' });
      rest = rest.replace(me[0], ' ');
    }
    var mu = RE.url.exec(rest);
    if (mu) {
      var url = mu[1];
      if (!hasContact(profile, '主页')) {
        profile.contacts.push({ label: '主页', value: url.replace(/^https?:\/\//, ''), href: /^https?:/.test(url) ? url : 'https://' + url, icon: 'link' });
      }
      rest = rest.replace(mu[0], ' ');
    }

    /* 「示例大学 | 软件工程辅修」这类跟联系方式挤在一行的学历信息不算「基本信息」，
       先按竖线/多空格拆成片段判断，再拼回去（此时还不要按单空格拆，否则学校名会被拆碎） */
    var segs = rest
      .replace(/(?:联系电话|联系方式|电话|手机|邮箱|E-?mail|Tel|Phone)\s*[:：]?/gi, ' ')
      .split(/[|｜]+|\u3000|\s{2,}/)
      .map(function (s) { return trim(s.replace(/\s+/g, ' ')).replace(/^[\s:：，,、。]+|[\s:：，,、。]+$/g, ''); })
      .filter(Boolean);

    var kept = segs.filter(function (w) {
      if (/^(?:男|女)$/.test(w)) return true;
      if (/^\d{1,2}\s*岁$/.test(w) || /^\d{4}\s*年?$/.test(w)) return true;
      if (/党员|团员|群众|政治面貌/.test(w)) return true;
      if (SCHOOL_TYPE_RE.test(w) || RE.uni.test(w)) return false;
      if (DEGREE_LEVEL_RE.test(w)) return false;
      if (MAJOR_RE.test(w) && w.length <= 10) return false;
      return w.length <= 12;
    });

    /* 一个片段都没留下时：若原文整段都是学历信息就不留；否则保留第一句（如自由文本的自我介绍） */
    var rest2 = kept.join(' | ');
    if (!rest2) {
      var whole = segs.join(' ');
      var pureEdu = /(大学|学院|学校|University|College)/i.test(whole) &&
        (DEGREE_LEVEL_RE.test(whole) || RE.degree.test(whole) || MAJOR_RE.test(whole));
      if (!pureEdu) {
        var firstClause = whole.split(/[。；;]/)[0];
        if (firstClause && firstClause.length <= 80) rest2 = trim(firstClause);
      }
    }

    if (rest2 && !/^(?:联系|方式|电话|邮箱|手机)$/.test(rest2)) others.push(rest2);
  }

  function hasContact(profile, label) {
    return profile.contacts.some(function (c) { return c.label === label; });
  }

  /* ------------------------------------------------- 成绩 / 评级条（可选） */
  /* 求职简历一般没有这一段；考研复试、竞赛成绩单这类简历会用到，所以保留解析能力，
     但没有成绩行时不会给识别完整度扣分。 */

  /* 触发词：形如「综合测评：总分90 数学95 专业课92」 */
  var SCORE_KEYWORDS = ['初试', '复试成绩', '笔试成绩', '考试成绩', '考研成绩', '综合测评', '总分', '成绩'];
  var SCORE_ITEM_RE = /([\u4e00-\u9fa5A-Za-z]{2,10}?)\s*[:：]?\s*(\d{2,3}(?:\.\d+)?)\s*分?/g;

  function extractScores(textLines) {
    var joined = textLines.filter(Boolean).join(' ');
    var idx = -1;
    SCORE_KEYWORDS.some(function (kw) {
      var i = joined.indexOf(kw);
      if (i !== -1) { idx = i; return true; }
      return false;
    });
    if (idx === -1) return null;

    var seg = joined.slice(idx);
    var total = '';
    var mt = /总分\s*[:：]?\s*(\d{2,3})/.exec(seg);
    if (mt) total = mt[1];

    var items = [];
    var seen = Object.create(null);
    var m;
    SCORE_ITEM_RE.lastIndex = 0;
    while ((m = SCORE_ITEM_RE.exec(seg)) !== null) {
      var label = cleanPiece(m[1]).replace(/^(初试成绩|复试成绩|笔试成绩|考试成绩|考研成绩|综合测评|总分)$/, '');
      var value = m[2];
      if (!label) continue;
      if (label.length > 8) continue;
      if (seen[label]) continue;
      seen[label] = 1;
      items.push({ label: label, value: value });
    }
    if (!total && !items.length) return null;
    return { title: '成绩', total: { label: '总分', value: total }, items: items };
  }

  /* ------------------------------------------------------------ 区块构建 */

  function buildSection(block, warnings, unparsed) {
    if (block.sort === 'tags') return buildSkills(block);
    if (block.sort === 'timeline') return buildTimeline(block, warnings);
    if (block.sort === 'cards') return buildCards(block);
    return buildList(block, warnings, unparsed);
  }

  function meaningfulLines(block) {
    return block.lines.filter(function (l) { return trim(l.text).length; });
  }

  /* ----- 时间线（教育背景） */
  function buildTimeline(block) {
    var items = [];
    var pending = null;   /* 等待日期行的时间线条目 */

    meaningfulLines(block).forEach(function (l) {
      var line = l.text;
      var dm = splitAnyDate(line);

      /* 只有日期的一行 → 挂在下一个条目上 */
      if (!dm && SINGLE_DATE_RE.test(trim(line).replace(/\s+/g, ''))) {
        pending = normalizeDate(line);
        return;
      }

      if (dm) {
        var date = dm.date;
        var body = (dm.before + ' ' + dm.after).trim();
        var item = newTimelineItem();
        item.date = date;
        if (body) fillTimelineBody(item, body);
        items.push(item);
        pending = null;
        return;
      }

      /* 没有日期：可能是「学校名 | 专业」或课程行 */
      var body2 = l.bullet ? cleanPiece(line.replace(RE.bullet, '')) : cleanPiece(line);
      if (!body2) return;      if (RE.courseLabel.test(body2) || /^主修课程/.test(body2)) {
        var target = items[items.length - 1] || pendingItem(items, pending);
        if (target) {
          target.bullets.push(body2.replace(/\s+/g, ' '));
          return;
        }
      }
      var last = items[items.length - 1];
      if (last && !last.degree && !last.bullets.length) {
        fillTimelineBody(last, body2);
        if (pending && !last.date) last.date = pending;
      } else if (last && last.bullets.length && body2.length < 60 && !RE.uni.test(body2)) {
        last.bullets.push(body2);
      } else {
        var it = newTimelineItem();
        if (pending) { it.date = pending; pending = null; }
        fillTimelineBody(it, body2);
        items.push(it);
      }
    });

    /* 收尾：日期行后面没有内容 */
    if (pending) {
      var it2 = newTimelineItem();
      it2.date = pending;
      items.push(it2);
    }

    return { id: block.id, title: block.title, sort: 'timeline', src: block.id === '__basic' ? 'labeled' : 'labeled', items: items };
  }

  function newTimelineItem() {
    return { org: '', date: '', degree: '', location: '', logo: '', bullets: [] };
  }

  function pendingItem(items, pending) {
    if (!pending) return null;
    var it = newTimelineItem();
    it.date = pending;
    items.push(it);
    return it;
  }

  var DEGREE_LEVEL_RE = /^(博士|博士研究生|硕士|硕士研究生|研究生|本科|学士|专科|大专|中专|高中|辅修|双学位|MBA|EMBA)$/;
  var LOCATION_RE = /^[\u4e00-\u9fa5]{2,6}(?:省|市|区|县|自治区|特别行政区)$/;
  var MAJOR_RE = /专业|方向|工程|管理|科学|技术|学位|班/;
  var SCHOOL_TYPE_RE = /大学|学院|学校/;
  /* 出现这些词的短行一定是标题，哪怕上一段还有内容 */
  var TITLE_WORD_RE = /毕业设计|课程设计|大作业|项目名称|课题|作品|系统设计|其他项目/;
  /* 更宽的「这是个标题」信号，含平台/系统/工具这类项目名常见词 */
  var TITLE_HINT_RE = /毕业设计|课程设计|大作业|项目名称|课题|作品|系统设计|其他项目|项目|平台|系统|工具|服务|网站|应用|小程序/;
  /* 职位/角色后缀：用来把「公司名 职位」拆成两段 */
  var ROLE_RE = /(实习生|工程师|架构师|分析师|设计师|研究员|负责人|组长|组员|队长|成员|主管|经理|总监|助理|开发|运维|测试|算法|产品|运营|专员|顾问|讲师|导师)/;
  /* 自由文本里的自我称呼与岗位声明 */
  var SELF_NAME_RE = /(?:我叫|我的名字是|姓名是|本人)\s*([\u4e00-\u9fa5·]{2,4})/;
  var INTENT_ANY_RE = /(?:应聘岗位|应聘职位|求职意向|意向岗位|目标岗位|报考专业|报考方向|应聘方向|求职目标)\s*[:：]?\s*(.+)/;

  function fillTimelineBody(item, body) {
    /* 「某专业（本科）」这种学位在括号里的写法，先把括号内容拎出来 */
    var level = '';
    var major = '';
    var text = body.replace(/[（(]\s*([^（()）]{2,12}?)\s*[)）]/g, function (m, inner) {
      if (!level && DEGREE_LEVEL_RE.test(inner)) { level = inner; return ' '; }
      return m;
    });

    var parts = splitParts(text);
    if (!parts.length) parts = [cleanPiece(text)];

    /* 「示例大学 某专业」中间只有一个空格时不会被切开，这里补一刀 */
    var refined = [];
    parts.forEach(function (tok) {
      if (SCHOOL_TYPE_RE.test(tok)) {
        var sp = tok.split(/\s+/).filter(Boolean);
        if (sp.length > 1 && sp[0].length >= 2) {
          var head = sp[0];
          for (var q = 1; q < sp.length; q++) {
            if (LOCATION_RE.test(sp[q])) head += ' ' + sp[q];
            else break;
          }
          refined.push(head);
          if (head.length < tok.length) refined.push(trim(tok.slice(head.length)));
          return;
        }
      }
      refined.push(tok);
    });
    parts = refined.filter(Boolean);

    var uniIdx = -1;
    for (var i = 0; i < parts.length; i++) {
      if (RE.uni.test(parts[i])) { uniIdx = i; break; }
    }

    if (uniIdx !== -1) {
      item.org = cleanPiece(parts[uniIdx].replace(RE.eduLabelPrefix, ''));
    }

    for (var j = 0; j < parts.length; j++) {
      if (j === uniIdx) continue;
      var p = cleanPiece(parts[j].replace(RE.eduLabelPrefix, ''));
      if (!p) continue;

      if (!level && DEGREE_LEVEL_RE.test(p)) { level = p; continue; }
      if (!major && RE.degree.test(p)) { major = p; continue; }
      /* 「某专业」这类纯专业名（学校名已经在 org 里了） */
      if (!major && item.org && MAJOR_RE.test(p) && p.length <= 20) { major = p; continue; }
      if (!item.location && LOCATION_RE.test(p) && p.length <= 6) { item.location = p; continue; }
      item.bullets.push(p);
    }

    if (!item.org) item.org = cleanPiece(text.replace(RE.eduLabelPrefix, ''));

    /* 「示例大学 某专业」这种黏在一段里的写法，把专业从学校名里剥出去 */
    if (item.org && major) {
      var idx = item.org.indexOf(major);
      if (idx > 0) item.org = cleanPiece(item.org.slice(0, idx));
    }

    item.degree = [level, major].filter(Boolean).join(' · ');
    delete item.title;
    return item;
  }

  /* ----- 卡片（项目经历 / 工程设计 / 实习） */
  function buildCards(block) {
    var items = [];
    var current = null;
    var pendingDate = '';
    var pendingMeta = [];

    function flushMeta() {
      if (!current) return;
      pendingMeta.forEach(function (line) {
        if (!current.title) current.title = line;
        else if (!current.location) current.location = line;
        else current.blocks.push({ label: '', text: line });
      });
      pendingMeta = [];
    }

    meaningfulLines(block).forEach(function (l) {
      var line = l.text.replace(/^#{1,4}\s*/, '').replace(/^\s*[-*+]\s+/, '');
      var dm = splitAnyDate(line);
      var bare = cleanPiece(line);

      /* 单独一行的日期 → 交给下一个项目 */
      if (!dm && SINGLE_DATE_RE.test(bare.replace(/\s+/g, ''))) {
        pendingDate = normalizeDate(bare);
        return;
      }

      if (dm) {
        var before = cleanPiece(dm.before);
        var after = cleanPiece(dm.after);
        current = newCard(before || after, dm.date);
        if (before && after) {
          var parts = splitParts(after);
          if (parts.length) current.title = parts[0];
          for (var i = 1; i < parts.length; i++) {
            if (!current.location) current.location = parts[i];
            else current.blocks.push({ label: '', text: parts[i] });
          }
        }
        items.push(current);
        pendingDate = '';
        return;
      }

      /* 「技术实现：xxx」这类标签行（长标题式前缀除外，如「某毕业设计：xxx」） */
      var lm = RE.labelLine.exec(bare);
      if (lm) {
        var label = cleanPiece(lm[1]);
        var value = cleanPiece(lm[2]);
        var labelIsTitle = TITLE_WORD_RE.test(label) || label.length > 14;
        if (!labelIsTitle) {
          if (current) {
            flushMeta();
            current.blocks.push({ label: label, text: value });
          } else {
            pendingMeta.push(label + '：' + value);
          }
          return;
        }
      }

      /* 换行处常见的强调分隔符 */
      if (/^[·•●\-–—=~_\s]+$/.test(bare)) return;

      var hasContent = !!current && current.blocks.some(function (b) { return !!b.text; });
      var lastText = (current && current.blocks.length) ? (current.blocks[current.blocks.length - 1].text || '') : '';

      /* 短行、非列表项、没有句末标点 → 认定为「新项目标题」 */
      var isTitleish = !l.bullet && bare.length <= 65 && !/[。，、；;]$/.test(bare) &&
        (TITLE_WORD_RE.test(bare) ||
         DATE_LINE_ONLY_RE.test(line) ||
         (!hasContent && bare.length <= 34) ||
         /* 上一段已经以句号收尾，这一行又短又不像正文 → 新项目标题 */
         (/[。！？!?]$/.test(lastText) && bare.length <= 26));
      if (!current || isTitleish) {
        var card = newCard(cleanPiece(bare.replace(/^(?:项目名称|项目|课题)\s*[:：]\s*/, '')), pendingDate);
        pendingDate = '';
        /* newCard 可能已经把角色从项目名里分离出来，这里不要覆盖 */
        current = card;
        items.push(current);
        return;
      }

      /* 项目内的正文 */
      var last = current.blocks[current.blocks.length - 1];
      if (last && last.label && !last.text) last.text = bare;
      else if (last && !last.label && !l.bullet && !/[。！？；;]$/.test(last.text) && bare.length < 200) {
        /* 同一段被硬换行拆开 → 合并（仅限没有标签、且上一行没有句末标点的段落） */
        last.text = (last.text + ' ' + bare).replace(/\s+/g, ' ').trim();
      } else {
        current.blocks.push({ label: '', text: bare });
      }
    });

    flushMeta();

    /* 无标签的正文块：分配合理的默认小标题 */
    items.forEach(function (it) {
      var unlabeled = it.blocks.filter(function (b) { return !b.label; });
      if (unlabeled.length === 1 && it.blocks.length === 1) unlabeled[0].label = '项目简介';
      else if (unlabeled.length > 1) {
        unlabeled.forEach(function (b, i) { b.label = i === 0 ? '项目简介' : '补充说明'; });
      }
    });

    return { id: block.id, title: block.title, sort: 'cards', src: 'labeled', items: items };
  }

  /**
   * 把「名称 + 角色」挤在一行的标题拆开，返回 { name, role }
   *   「其他课程项目 组长」        → 项目名 + 角色
   *   「某互联网科技有限公司 后端开发实习生」 → 公司名 + 职位
   *   「校园二手交易平台」          → 整串都是名称
   */
  function splitNameRole(text) {
    var parts = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
    if (parts.length < 2) return { name: cleanPiece(text), role: '' };

    /* 从第 2 段开始找第一段「像角色」的内容，后面的都并进角色 */
    for (var i = 1; i < parts.length; i++) {
      if (ROLE_RE.test(parts[i]) && parts.slice(0, i).join('').length >= 2) {
        return { name: cleanPiece(parts.slice(0, i).join(' ')), role: cleanPiece(parts.slice(i).join(' ')) };
      }
    }
    /* 没有明显角色词：若第一段就是完整项目名（含项目类关键词），后面的算角色 */
    if (parts.length === 2 && TITLE_HINT_RE.test(parts[0])) {
      return { name: cleanPiece(parts[0]), role: cleanPiece(parts[1]) };
    }
    return { name: cleanPiece(text), role: '' };
  }

  function newCard(org, date) {
    var nr = splitNameRole(org);
    return {
      org: nr.name,
      date: normalizeDate(date) || '',
      title: nr.role,
      location: '',
      logo: '',
      blocks: []
    };
  }

  /* ----- 技能标签 */
  function buildSkills(block) {
    var SK = skillsApi();
    var groups = [];
    var loose = [];

    meaningfulLines(block).forEach(function (l) {
      var line = cleanPiece(l.text.replace(RE.bullet, ''));
      if (!line) return;
      var lm = RE.labelLine.exec(line);
      if (lm) {
        var title = cleanPiece(lm[1]);
        var items = SK.extractTags(lm[2]);
        if (items.length) groups.push({ title: title, items: items });
        return;
      }
      SK.extractTags(line).forEach(function (t) { loose.push(t); });
    });

    if (loose.length) {
      var existing = groups.filter(function (g) { return g.title === '其他'; })[0];
      if (existing) existing.items = existing.items.concat(loose);
      else groups.push({ title: '其他', items: loose });
    }

    return { id: block.id, title: block.title, sort: 'tags', src: 'labeled', groups: groups };
  }

  /* ----- 列表型区块（研究兴趣 / 综合能力 / 获奖…） */
  function buildList(block, warnings, unparsed) {
    var items = [];
    var current = null;

    meaningfulLines(block).forEach(function (l) {
      var bare = cleanPiece(l.text.replace(RE.bullet, ''));
      if (!bare) return;

      var lm = RE.labelLine.exec(bare);
      if (lm && cleanPiece(lm[1]).length <= 14) {
        current = { title: cleanPiece(lm[1]), text: cleanPiece(lm[2]) };
        items.push(current);
        return;
      }

      if (current && current.text) {
        /* 没换行的长段被切开时合并，否则另起一条 */
        if (bare.length < 60 && !/[。！？]$/.test(bare)) {
          current.text = (current.text + ' ' + bare).replace(/\s+/g, ' ').trim();
        } else {
          items.push({ title: '', text: bare });
          current = items[items.length - 1];
        }
      } else if (current && !current.text) {
        current.text = bare;
      } else {
        items.push({ title: '', text: bare });
        current = items[items.length - 1];
      }
    });

    /* 「获奖项目：xxx」这种前缀已被 labelLine 吃掉 */
    items.forEach(function (it) {
      if (!it.title || it.title === '其他') it.title = '';
    });

    return { id: block.id, title: block.title, sort: 'list', src: 'labeled', items: items };
  }

  /* ------------------------------------------- 自由文本降级（无任何小标题） */

  /* 自由文本分类：按「关键词得分」而不是「命中第一个词」来定区块，
     避免「毕业设计做的是…」被误判成教育背景这类连锁错误 */
  var FREE_HINTS = [
    {
      id: 'education', title: '教育背景', sort: 'timeline',
      strong: /(大学|学院|学校|University|College|Institute)/i,
      words: [/教育(背景|经历)/, /学历/, /本科/, /硕士/, /博士/, /研究生/, /主修课程/, /所学课程/, /专业课/, /就读/, /GPA/i, /学分/, /毕业(?!设计|论文|课题|项目)/, /专业[：:（(]/]
    },
    {
      id: 'skills', title: '相关技能', sort: 'tags',
      strong: /(技能|专业技能|编程语言|技术栈)/,
      words: [/熟悉|掌握|精通|了解|会用|能用/, /CET-?\s*[46]/i, /证书/, /英语(四|六)级/, /Software|工具|软件/]
    },
    {
      id: 'projects', title: '项目经历', sort: 'cards',
      strong: /(项目|系统|平台|课题|作品)/,
      words: [/开发|实现|设计|搭建|构建|部署|负责|参与|完成|优化|算法/, /实验|仿真|调试|测试|数据集|模型/]
    },
    {
      id: 'research', title: '研究兴趣与复试方向', sort: 'list',
      strong: /(研究兴趣|复试方向|研究方向|兴趣方向)/,
      words: [/拟|希望|计划|打算|关注|进一步|读研|深造/]
    },
    {
      id: 'awards', title: '荣誉奖项', sort: 'list',
      strong: /(获奖|荣誉|奖项|奖学金)/,
      words: [/一等奖|二等奖|三等奖|金奖|银奖|铜奖|优秀|标兵|竞赛/]
    },
    {
      id: 'abilities', title: '综合能力', sort: 'list',
      strong: /(自我评价|综合能力|个人优势|个人特点)/,
      words: [/能力|善于|擅长|性格|团队|沟通|抗压|负责|学习能力/]
    },
    {
      id: 'work', title: '工作经历', sort: 'cards',
      strong: /(工作经历|实习经历|任职经历)/,
      words: [/公司|集团|实习|任职|在职|岗位|部门/]
    }
  ];

  function emptyHints() {
    var o = Object.create(null);
    FREE_HINTS.forEach(function (h) { o[h.id] = {}; });
    return o;
  }

  function addHints(store, line) {
    FREE_HINTS.forEach(function (h) {
      if (h.strong && h.strong.test(line)) store[h.id].strong = (store[h.id].strong || 0) + 1;
      h.words.forEach(function (re) {
        if (re.test(line)) store[h.id].weak = (store[h.id].weak || 0) + 1;
      });
    });
  }

  function bestHint(store) {
    var best = null;
    var bestScore = 0;
    var second = 0;
    FREE_HINTS.forEach(function (h) {
      var s = store[h.id] || {};
      var score = (s.strong || 0) * 3 + (s.weak || 0);
      if (score > bestScore) { second = bestScore; bestScore = score; best = h; }
      else if (score > second) second = score;
    });
    if (bestScore === 0) return { id: 'others', title: '其他经历', sort: 'list', score: 0, weak: true };
    return { id: best.id, title: best.title, sort: best.sort, score: bestScore, weak: bestScore <= 3 };
  }

  function guessSection(text) {
    var store = emptyHints();
    addHints(store, text);
    var best = bestHint(store);
    return best.id === 'others' ? null : best;
  }

  function freeformParse(lines, profile, warnings) {
    var textLines = lines.filter(function (l) { return trim(l).length; });
    if (!textLines.length) return { sections: [], unparsed: [] };

    var unparsed = [];
    var name = '';
    var headline = '';
    var intent = '';
    var scores = null;
    var cursor = 0;

    /* --- 开头连续 1-3 行当作头部信息 --- */
    var headerLines = [];
    while (cursor < textLines.length && headerLines.length < 3) {
      var line = textLines[cursor];
      var looksHeader = RE.phone.test(line) || RE.email.test(line) || RE.intentLine.test(line) ||
        /^[\u4e00-\u9fa5·]{2,4}$/.test(trim(line)) || RE.nameLine.test(line);
      if (!looksHeader && headerLines.length) break;
      if (!looksHeader && !headerLines.length) break;
      headerLines.push(line);
      cursor++;
    }

    headerLines.forEach(function (line) {
      var m;
      if ((m = RE.nameLine.exec(line))) { name = cleanPiece(m[1]); return; }
      if ((m = RE.intentLine.exec(line))) { intent = cleanPiece(m[1]); return; }
      if ((m = RE.inlineIntent.exec(cleanPiece(line)))) {
        var mi = RE.inlineIntent.exec(cleanPiece(line));
        name = name || mi[1];
        intent = intent || mi[3];
        return;
      }
      if (/^[\u4e00-\u9fa5·]{2,4}$/.test(trim(line)) && !name) { name = trim(line); return; }
      /* 「我叫xxx，男，24岁……」这类自我介绍句里的姓名 */
      var ms = SELF_NAME_RE.exec(line);
      if (ms && !name && !RE.uni.test(ms[1])) { name = ms[1]; }
      if (RE.phone.test(line) || RE.email.test(line)) {
        var fake = { id: '__basic', lines: [{ text: line }] };
        extractHeader(fake, profile, warnings, unparsed, null);
        return;
      }
      if (!headline) headline = cleanPiece(line);
    });

    /* 整段文本里再兜一次：应聘岗位 / 求职意向 */
    if (!intent) {
      for (var q = 0; q < textLines.length && q < 6; q++) {
        var mm = INTENT_ANY_RE.exec(textLines[q]);
        if (mm) { intent = cleanPiece(mm[1]); break; }
      }
    }

    var sc = extractScores(textLines.slice(0, Math.min(textLines.length, 8)));
    if (sc) scores = sc;

    /* --- 用「日期行 / 强关键词行」把剩余正文切成块，块类型按累计得分判定 --- */
    var chunks = [];
    var cur = null;

    function openChunk(seedText, fallback) {
      cur = {
        lines: [],
        hints: emptyHints(),
        seed: seedText || '',
        resolved: fallback || null,
        entries: 0
      };
      chunks.push(cur);
      return cur;
    }

    function pushLine(chunk, line, bare) {
      chunk.lines.push({ text: line, bullet: RE.bullet.test(line) });
      addHints(chunk.hints, bare);
      if (DATE_LINE_ONLY_RE.test(line)) chunk.entries++;
    }

    function isEduChunk(chunk) {
      var edu = chunk.hints.education || {};
      var prj = chunk.hints.projects || {};
      return (edu.strong || 0) > 0 || (edu.weak || 0) > (prj.strong || 0) * 3 + (prj.weak || 0);
    }

    /* 短标题行开出的新块，若自身信号很弱（只有「项目」两个字这种），沿用上一块的类型 */
    function resolveHint(chunk) {
      var hint = bestHint(chunk.hints);
      if (hint.weak && chunk.resolved) {
        return { id: chunk.resolved.id, title: chunk.resolved.title, sort: chunk.resolved.sort, score: 1, weak: true };
      }
      return hint;
    }

    for (var i = cursor; i < textLines.length; i++) {
      var l = textLines[i];
      var bare = cleanPiece(l.replace(RE.bullet, ''));
      var store = emptyHints();
      addHints(store, bare);
      var lineHint = bestHint(store);
      var strongIds = Object.keys(store).filter(function (k) { return store[k].strong; });
      var hasStrong = strongIds.length > 0;
      var hasDateLine = DATE_LINE_ONLY_RE.test(l);
      var isTitleish = bare.length <= 60 && !/[。；;]$/.test(bare);

      if (!cur) { openChunk(bare); pushLine(cur, l, bare); continue; }

      var curType = resolveHint(cur);
      var startNew = false;

      /* 这一行明显属于另一个区块，且累积得分够高 → 换块 */
      if (lineHint.id !== 'others' && lineHint.score >= 3 &&
          lineHint.id !== curType.id && cur.lines.length) {
        startNew = true;
      }
      /* 短标题行 + 强关键词 → 换块（例如「工作经历」「获奖情况」） */
      if (!startNew && hasStrong && isTitleish && strongIds.indexOf(curType.id) === -1 && cur.lines.length) {
        startNew = true;
      }
      /* 纯日期行：教育块的第一段时间留在一起（多条学历），之后才另起 */
      if (!startNew && hasDateLine && cur.lines.length && !(isEduChunk(cur) && cur.entries < 1)) {
        startNew = true;
      }

      if (startNew) { openChunk(bare, curType); pushLine(cur, l, bare); continue; }

      pushLine(cur, l, bare);
    }

    /* --- 每个块按累计得分定类型，再转成对应结构 --- */
    var sections = [];
    var merged = Object.create(null);
    chunks.forEach(function (ch) {
      if (!ch.lines.length) return;
      var hint = resolveHint(ch);
      ch.resolved = hint;
      var built = buildSection({ id: hint.id, title: hint.title, sort: hint.sort, lines: ch.lines }, warnings, unparsed);
      if (!built) return;
      var count = (built.items && built.items.length) || (built.groups && built.groups.length) || 0;
      if (!count) return;
      if (ch.sort === 'tags') {
        /* 技能块合并成一组 */
        var exist = merged[ch.id];
        if (exist) {
          built.groups.forEach(function (g) { exist.groups.push(g); });
        } else {
          built.src = 'inferred';
          merged[ch.id] = built;
          sections.push(built);
        }
        return;
      }
      built.src = 'inferred';
      sections.push(built);
    });

    /* --- 如果技能一条都没抽到，用词表全文扫一遍补上 --- */
    if (!sections.some(function (s) { return s.id === 'skills'; })) {
      var SK = skillsApi();
      var scanned = SK.scanText(textLines.join('\n'));
      if (scanned.length) {
        sections.push({
          id: 'skills', title: '相关技能', sort: 'tags', src: 'inferred',
          groups: [{ title: '从文本中识别到的技能', items: scanned }]
        });
      }
    }

    return { sections: sections, unparsed: unparsed, name: name, headline: headline, intent: intent, scores: scores };
  }

  /* ------------------------------------------------------------ 质量评分 */

  function scoreQuality(res) {
    var hits = 0;
    var total = 0;

    function check(cond) { total++; if (cond) hits++; return cond; }

    check(!!trim(res.profile.name));
    check(res.profile.contacts.length > 0);
    /* 「有没有意向」和「有没有成绩」是两件事：求职简历通常只有意向，
       所以成绩缺失不算扣分项；只有整份文本看起来是成绩单时（既没意向也没成绩）才扣。 */
    check(!!trim(res.profile.intent));
    if (!res.scores) {
      check(!/初试|复试|考研|笔试|测评/.test(res.sourceText || ''));
    }

    var find = function (id) {
      return res.sections.filter(function (s) { return s.id === id; })[0];
    };
    var edu = find('education');
    var prj = find('projects') || find('engineering') || find('work') || find('internships');
    var skl = find('skills');
    var listSec = res.sections.filter(function (s) { return s.sort === 'list'; })[0];

    check(!!(edu && edu.items && edu.items.length));
    check(!!(prj && prj.items && prj.items.length));
    check(!!(skl && skl.groups && skl.groups.length));
    check(!!listSec);

    /* 教育条目的完整度：有没有拿到学校名和日期 */
    if (edu && edu.items && edu.items.length) {
      check(edu.items.some(function (it) { return it.org && it.date; }));
      check(edu.items.some(function (it) { return it.bullets && it.bullets.length; }));
    } else { total += 2; }

    /* 项目卡片的完整度：有没有正文 */
    if (prj && prj.items && prj.items.length) {
      check(prj.items.some(function (it) { return it.blocks && it.blocks.length; }));
    } else { total++; }

    var score = total ? hits / total : 0;
    var label = score >= 0.85 ? '识别良好' : score >= 0.6 ? '基本可用，建议核对' : '识别较差，请重点核对';
    return { score: Math.round(score * 100), label: label, hits: hits, lines: total, mode: res.mode };
  }

  /* ---------------------------------------------------- Review → 数据补丁 */

  /**
   * 把（勾选过的）Review 转成 store 能应用的补丁
   * @param {Object} review
   * @param {Object} [checked] 形如 { 'profile.name': true, 'section.education': true }
   */
  function parseToPatches(review, checked) {
    var patches = [];
    var on = function (path) { return !checked || checked[path] !== false; };

    if (on('profile.name') && review.profile.name) patches.push({ path: 'profile.name', value: review.profile.name });
    if (on('profile.headline') && review.profile.headline) patches.push({ path: 'profile.headline', value: review.profile.headline });
    if (on('profile.intent') && review.profile.intent) patches.push({ path: 'profile.intent', value: review.profile.intent });
    if (on('profile.contacts') && review.profile.contacts.length) patches.push({ path: 'profile.contacts', value: review.profile.contacts });
    if (on('scores') && review.scores && (review.scores.items.length || review.scores.total.value)) {
      patches.push({ path: 'scores', value: review.scores });
    }

    var listSections = [];
    review.sections.forEach(function (s) {
      if (!on('section.' + s.id)) return;
      var val = s.sort === 'tags' ? { id: s.id, title: s.title, anchor: s.id, sort: 'tags', groups: s.groups }
        : { id: s.id, title: s.title, anchor: s.id, sort: s.sort, items: s.items };
      listSections.push(val);
    });

    /* 区块整体替换：已识别到的区块覆盖默认，未识别到的保留默认 */
    if (listSections.length) {
      patches.push({ path: 'sections', value: listSections, merge: false });
    }
    return patches;
  }

  /* ------------------------------------------------------------ 模板与示例 */

  var TEMPLATE = [
    '# ---------------------------- 使用说明（本行以 # 开头，识别时会自动忽略）----------------------------',
    '# 1. 照着下面的结构把你的内容填进去，【】里的小标题是关键，保留它们识别率最高（约 95%）。',
    '# 2. 没有的信息直接删掉那一行，识别结果里会标红提示「未识别到，请补充」，可在右侧手动补。',
    '# 3. 什么小标题都不想写？全部删掉直接粘贴原始文本也行，会自动分段，但准确率会降一些。',
    '# ---------------------------------------------------------------------------------------------',
    '',
    '【基本信息】',
    '姓名：',
    '身份：学校 | 学历（专业） | 一句话介绍',
    '求职意向：',
    '电话：',
    '邮箱：',
    '其他：男 | 23岁 | 政治面貌',
    '',
    '【相关技能】',
    '编程语言：',
    '科研基础：',
    '专业软件：',
    '专业知识：',
    '英语能力：',
    '',
    '【教育背景】',
    '2021.09 - 2025.07 | 学校名称 | 本科 | 专业名称 | 城市',
    '主修课程：课程一、课程二、课程三',
    '2022.09 - 2025.12 | 学校名称 | 辅修 | 专业名称',
    '主修课程：课程一、课程二',
    '',
    '【项目经历】',
    '2024.03 - 2024.06 | 项目名称 | 承担角色',
    '技术实现：用了什么技术、做了什么、解决什么问题。',
    '项目价值：达成了什么结果、量化指标是多少。',
    '（第二个项目接着往下写，格式相同）',
    '',
    '【工程设计】',
    '2024.09 - 2025.05 | 设计课题名称',
    '技术实现：',
    '项目价值：',
    '',
    '【研究兴趣与方向】',
    '关注方向：',
    '研究设想：',
    '',
    '【综合能力】',
    '学习与拆解：',
    '工程文档：',
    '跨学科整合：'
  ].join('\n');

  /* 演示用文本：故意使用「示例姓名」「示例大学」「13800000000」这类一眼可辨的占位值。
     千万不要在这里放假人名 —— 用户点「填入示例 → 一键识别 → 应用到简历」之后，
     假人名会变成页面上的显示名，看起来就像简历写错了人。 */
  var SAMPLE_FREETEXT = [
    '我叫示例姓名，男，24岁，2025年6月毕业于示例大学通信工程专业，本科，联系电话13800000000，邮箱example@example.com。',
    '2021.09 - 2025.06 示例大学 通信工程 本科，主修课程包括通信原理、数字信号处理、嵌入式系统设计。',
    '毕业设计做的是基于STM32的智能环境监测终端，用C语言完成下位机驱动开发，通过ESP8266把数据上传到云端，并用Python写了数据可视化脚本，最终功耗比参考方案降低约30%。',
    '在校期间参与全国大学生电子设计竞赛，负责信号采集与滤波算法实现，获得省级二等奖。',
    '技能方面熟悉C语言、Python、MATLAB，掌握STM32与FreeRTOS，能用Altium Designer画双层板，英语通过CET-6。',
    '自我评价：学习能力强，能独立完成从需求分析到硬件调试的全流程，具备良好的团队协作与文档撰写能力。'
  ].join('\n');

  /* ------------------------------------------------------------ 对外接口 */

  var API = {
    parse: parse,
    parseToPatches: parseToPatches,
    freeformParse: freeformParse,
    extractScores: extractScores,
    normalizeDate: normalizeDate,
    lookupSection: lookupSection,
    TEMPLATE: TEMPLATE,
    SAMPLE_FREETEXT: SAMPLE_FREETEXT,
    SECTION_MAP: SECTION_MAP
  };

  global.ResumeParser = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
