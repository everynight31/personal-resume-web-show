/* 解析器测试台：node tests/parse.test.js
 * 用示例简历文本 + 自由段落 + 招聘站式文本，检查解析结果是否符合预期。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadInto(sandbox, rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

const sandbox = vm.createContext({ console, setTimeout, clearTimeout, JSON, Math, Date, RegExp });
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
loadInto(sandbox, 'js/skills.js');
loadInto(sandbox, 'js/parser.js');

const Parser = sandbox.ResumeParser;
const Skills = sandbox.ResumeSkills;

/* ------------------------------------------------------------------ 测试数据 */
/* 注意：这里用的所有人名、电话、邮箱、学校均为虚构示例数据 */

const RESUME_LABELED = fs.readFileSync(path.join(ROOT, 'tests/fixtures/resume_sample.txt'), 'utf8');

const RESUME_TEMPLATED = `# 使用说明：本行以 # 开头，识别时会自动忽略
【基本信息】
姓名：示例姓名
身份：示例大学 | 本科（计算机科学与技术） | 2025 届
求职意向：后端开发工程师
电话：13800000000
邮箱：example@example.com
其他：男 | 23岁 | 中共党员

【相关技能】
编程语言：Java、Go、Python
后端框架：Spring Boot、Gin
数据存储：MySQL、Redis、Kafka
工程工具：Docker、Kubernetes、Git
英语能力：CET-6

【教育背景】
2021.09 - 2025.06 | 示例大学 | 本科 | 计算机科学与技术 | 南京
主修课程：数据结构与算法、操作系统、计算机网络
2023.03 - 2023.07 | 示例大学 | 交换学习 | 数据科学
主修课程：机器学习、数据可视化

【项目经历】
2024.03 - 2024.06 | 分布式短链服务 | 后端负责人
技术实现：用 Go + Gin 实现发号器与 Base62 编码生成短链。
项目价值：单机压测 1.2 万 QPS、P99 28ms。

【研究兴趣与复试方向】
关注方向：高并发系统设计、分布式存储
研究设想：结合实习实践开展应用研究。

【综合能力】
工程习惯：习惯先写测试再改代码。
学习与排查：能顺着日志与监控定位到具体代码行。
`;

const RESUME_MARKDOWN = `# 示例姓名

电话：13800000000 邮箱：example@example.com

## 教育背景
- 2019.09 - 2023.06 | 某某大学 | 本科 | 计算机科学与技术

## 项目经历
### 2023.01 - 2023.09 | 分布式爬虫平台
**技术实现**：使用 Python + Scrapy + Redis 构建。
**项目价值**：日抓取量提升到 500 万条。

## 专业技能
- **编程语言**：Python、Go、Java
- **框架**：Django、Flask
`;

const FREE_TEXT = Parser.SAMPLE_FREETEXT;

/* ------------------------------------------------------------------ 断言工具 */

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, label, extra) {
  if (cond) { pass++; return true; }
  fail++;
  failures.push(label + (extra ? '  →  ' + extra : ''));
  return false;
}

function section(rev, id) {
  return rev.sections.filter(s => s.id === id)[0];
}

function dump(rev) {
  const out = [];
  out.push(`  模式=${rev.mode}  完整度=${rev.quality.score}%  ${rev.quality.label}`);
  out.push(`  姓名=${JSON.stringify(rev.profile.name)}  意向=${JSON.stringify(rev.profile.intent)}`);
  out.push(`  联系方式=${rev.profile.contacts.map(c => c.label + '=' + c.value).join(' , ') || '（无）'}`);
  if (rev.scores) out.push(`  成绩: 总分=${rev.scores.total.value} 各科=${rev.scores.items.map(i => i.label + i.value).join('/')}`);
  rev.sections.forEach(s => {
    const n = (s.items && s.items.length) || (s.groups && s.groups.length) || 0;
    out.push(`  [${s.id}] ${s.title} sort=${s.sort} src=${s.src} 条目=${n}`);
    if (s.sort === 'timeline') {
      s.items.forEach(it => out.push(`      · ${it.org} | ${it.date} | ${it.degree} | ${it.location} | bullets=${it.bullets.length}`));
    } else if (s.sort === 'cards') {
      s.items.forEach(it => out.push(`      · ${it.org} | ${it.date} | ${it.title} | blocks=${it.blocks.map(b => b.label).join(',')}`));
    } else if (s.sort === 'tags') {
      s.groups.forEach(g => out.push(`      · ${g.title}: ${g.items.map(i => i.text + (i.level === 'main' ? '*' : '')).join(' ')}`));
    } else {
      s.items.forEach(it => out.push(`      · ${it.title || '(无题)'} :: ${String(it.text).slice(0, 40)}`));
    }
  });
  if (rev.unparsed.length) out.push(`  未归类: ${rev.unparsed.length} 段`);
  if (rev.warnings.length) out.push(`  提示: ${rev.warnings.join(' / ')}`);
  return out.join('\n');
}

/* ============================================================ 场景 1：结构完整的小标题简历 */
console.log('\n══════ 场景 1：带小标题的示例简历文本（虚构数据）══════');
{
  const rev = Parser.parse(RESUME_LABELED);
  console.log(dump(rev));

  ok(rev.profile.name === '示例姓名', '1.1 姓名应为示例姓名', rev.profile.name);
  ok(/13800000000/.test(JSON.stringify(rev.profile.contacts)), '1.2 应抽到手机号');
  ok(/example@example\.com/.test(JSON.stringify(rev.profile.contacts)), '1.3 应抽到邮箱');
  ok(/后端开发/.test(rev.profile.intent), '1.4 应抽到求职意向', rev.profile.intent);
  ok(!rev.scores, '1.5 求职简历没有成绩段，scores 应为 null', JSON.stringify(rev.scores));
  ok(!/初试|考研|复试|政治|专业课/.test(rev.sourceText), '1.6 原文里不应残留考研相关字样');

  const edu = section(rev, 'education');
  ok(!!edu, '1.7 应有教育背景区块');
  if (edu) {
    ok(edu.items.length === 2, '1.8 应有 2 条学历', String(edu.items.length));
    ok(edu.items[0].org === '示例大学', '1.9 学校名应为示例大学', edu.items[0].org);
    ok(/2021\.09\s*–\s*2025\.06/.test(edu.items[0].date), '1.10 日期应规范化成 en dash', edu.items[0].date);
    ok(edu.items.some(i => /计算机科学与技术/.test(i.degree)), '1.11 应抽到专业（计算机科学与技术）');
    ok(edu.items.every(i => i.bullets.length >= 1), '1.12 两条学历都应带主修课程要点');
  }

  const intern = section(rev, 'internships');
  ok(!!intern && intern.items.length === 1, '1.13 实习经历应有 1 条', intern ? String(intern.items.length) : 'null');
  if (intern) {
    ok(/互联网科技/.test(intern.items[0].org), '1.14 实习公司名', intern.items[0].org);
    ok(/后端开发实习生/.test(intern.items[0].title), '1.15 实习岗位', intern.items[0].title);
  }

  const prj = section(rev, 'projects');
  ok(!!prj && prj.items.length === 2, '1.16 项目经历应有 2 个项目', prj ? String(prj.items.length) : 'null');
  if (prj) {
    ok(/短链服务/.test(prj.items[0].org), '1.17 第一个项目名', prj.items[0].org);
    ok(prj.items[0].blocks.length === 2, '1.18 第一个项目应有 2 个正文块', String(prj.items[0].blocks.length));
    ok(/二手交易/.test(prj.items[1].org), '1.19 第二个项目名', prj.items[1].org);
    ok(/组长/.test(prj.items[1].title), '1.20 第二个项目的角色', prj.items[1].title);
  }

  const skl = section(rev, 'skills');
  ok(!!skl && skl.groups.length === 5, '1.21 技能应有 5 组', skl ? String(skl.groups.length) : 'null');
  if (skl) {
    const all = skl.groups.reduce((a, g) => a.concat(g.items.map(i => i.text)), []);
    ok(all.includes('Java') && all.includes('Go'), '1.22 技能里应有 Java 与 Go', all.join('/'));
    ok(all.includes('Spring Boot'), '1.23 技能里应有 Spring Boot');
    ok(all.includes('Kubernetes'), '1.24 技能里应有 Kubernetes');
  }

  ok(!!section(rev, 'awards'), '1.25 应有荣誉奖项区块');
  ok(!!section(rev, 'abilities'), '1.26 应有自我评价区块');
  ok(rev.mode === 'labeled', '1.27 应判定为 labeled 模式', rev.mode);
  ok(rev.quality.score >= 90, '1.28 无成绩段的求职简历完整度仍应 >= 90', String(rev.quality.score));
}

/* ============================================================ 场景 2：模板文本 */
console.log('\n══════ 场景 2：按模板填写（含 # 注释行）══════');
{
  const rev = Parser.parse(RESUME_TEMPLATED);
  console.log(dump(rev));
  ok(rev.profile.name === '示例姓名', '2.1 姓名', rev.profile.name);
  ok(rev.quality.score >= 90, '2.2 完整度应 >= 90', String(rev.quality.score));
  const skl = section(rev, 'skills');
  ok(!!skl && skl.groups.length === 5, '2.3 技能 5 组', skl ? String(skl.groups.length) : 'null');
  const edu = section(rev, 'education');
  ok(!!edu && edu.items.length === 2, '2.4 教育 2 条', edu ? String(edu.items.length) : 'null');
  if (edu) ok(edu.items[0].degree.includes('计算机科学与技术'), '2.5 专业方向', edu.items[0].degree);
  const prj = section(rev, 'projects');
  ok(!!prj && /短链服务/.test(prj.items[0].org), '2.6 项目名', prj ? prj.items[0].org : 'null');
  ok(!rev.scores, '2.7 模板里已无成绩行，scores 应为 null', JSON.stringify(rev.scores));
}

/* ============================================================ 场景 3：Markdown */
console.log('\n══════ 场景 3：Markdown 简历 ══════');
{
  const rev = Parser.parse(RESUME_MARKDOWN);
  console.log(dump(rev));
  ok(rev.profile.name === '示例姓名', '3.1 姓名应从 # 一级标题抽到', rev.profile.name);
  ok(/13800000000/.test(JSON.stringify(rev.profile.contacts)), '3.2 手机号');
  const edu = section(rev, 'education');
  ok(!!edu && edu.items.length === 1, '3.3 教育 1 条', edu ? String(edu.items.length) : 'null');
  if (edu) ok(/某某大学/.test(edu.items[0].org), '3.4 学校名', edu.items[0].org);
  const skl = section(rev, 'skills');
  ok(!!skl, '3.5 应识别出技能区块');
  if (skl) {
    const all = skl.groups.reduce((a, g) => a.concat(g.items.map(i => i.text)), []);
    ok(all.includes('Python') && all.includes('Go'), '3.6 技能词', all.join('/'));
    ok(all.includes('Django') && all.includes('Flask'), '3.7 框架词', all.join('/'));
  }
  const prj = section(rev, 'projects');
  ok(!!prj && prj.items.length === 1, '3.8 项目 1 个', prj ? String(prj.items.length) : 'null');
}

/* ============================================================ 场景 4：自由文本 */
console.log('\n══════ 场景 4：完全没有小标题的自由段落（降级模式）══════');
{
  const rev = Parser.parse(FREE_TEXT);
  console.log(dump(rev));
  ok(rev.mode === 'freeform', '4.1 应判定为 freeform 模式', rev.mode);
  ok(rev.profile.name === '示例姓名', '4.2 姓名', rev.profile.name);
  ok(/13800000000/.test(JSON.stringify(rev.profile.contacts)), '4.3 手机号');
  ok(/example@example\.com/.test(JSON.stringify(rev.profile.contacts)), '4.4 邮箱');
  ok(rev.sections.length >= 3, '4.5 至少切出 3 个区块', String(rev.sections.length));
  const skl = section(rev, 'skills');
  ok(!!skl, '4.6 应识别到技能区块');
  if (skl) {
    const all = skl.groups.reduce((a, g) => a.concat(g.items.map(i => i.text)), []);
    ok(all.includes('Python') && all.includes('MATLAB') && all.includes('STM32'),
      '4.7 技能词表应扫出 Python/MATLAB/STM32', all.join('/'));
  }
  const edu = section(rev, 'education');
  ok(!!edu, '4.8 应猜到教育背景区块');
}

/* ============================================================ 场景 5：招聘站风格 */
console.log('\n══════ 场景 5：招聘网站导出文本（字段名不同）══════');
{
  const text = `示例姓名 应聘岗位：后端开发工程师
手机：13800000001
E-mail：example@example.com
性别：女  年龄：26  现居：杭州

教育经历
2015.09-2019.06 示例大学 软件工程 本科

工作经历
2021.07-至今 某互联网公司 后端开发工程师
• 负责订单系统重构，QPS 从 800 提升到 5000，使用 Go + MySQL + Redis。
• 主导服务拆分，落地 Kubernetes 与 CI/CD 流程。

技能特长
精通 Java、Go，熟悉 Spring Boot、MySQL、Redis、Docker、Kubernetes，了解 Kafka。

自我评价
学习能力强，能快速定位线上问题，具备良好的跨团队沟通能力。`;
  const rev = Parser.parse(text);
  console.log(dump(rev));
  ok(rev.profile.name === '示例姓名', '5.1 姓名', rev.profile.name);
  ok(/13800000001/.test(JSON.stringify(rev.profile.contacts)), '5.2 手机号');
  ok(rev.profile.intent.length > 0, '5.3 应抽到应聘岗位', rev.profile.intent);
  const edu = section(rev, 'education');
  ok(!!edu && edu.items.length === 1, '5.4 教育经历 1 条', edu ? String(edu.items.length) : 'null');
  const work = section(rev, 'work');
  ok(!!work && work.items.length === 1, '5.5 工作经历 1 条', work ? String(work.items.length) : 'null');
  if (work) {
    ok(/互联网公司/.test(work.items[0].org), '5.6 公司名', work.items[0].org);
    ok(work.items[0].blocks.length >= 2, '5.7 工作内容应成块', String(work.items[0].blocks.length));
  }  const skl = section(rev, 'skills');
  ok(!!skl, '5.8 技能区块');
  if (skl) {
    const all = skl.groups.reduce((a, g) => a.concat(g.items.map(i => i.text)), []);
    ok(all.includes('Go') && all.includes('Spring Boot') && all.includes('Kubernetes'),
      '5.9 技能词', all.join('/'));
  }
  ok(!!section(rev, 'abilities'), '5.10 自我评价 → 综合能力');
}

/* ============================================================ 场景 6：补丁生成 */
console.log('\n══════ 场景 6：Review → 数据补丁 ══════');
{
  const rev = Parser.parse(RESUME_LABELED);
  const patches = Parser.parseToPatches(rev);
  const paths = patches.map(p => p.path);
  console.log('  补丁路径：' + paths.join(', '));
  ok(paths.includes('profile.name'), '6.1 含 profile.name');
  ok(paths.includes('profile.contacts'), '6.2 含 profile.contacts');
  ok(paths.includes('profile.intent'), '6.3 含 profile.intent');
  ok(!paths.includes('scores'), '6.4 无成绩段时不应生成 scores 补丁');
  ok(paths.includes('sections'), '6.5 含 sections');
  const secs = patches.filter(p => p.path === 'sections')[0];
  ok(secs && secs.value.every(s => s.id && s.title && s.sort), '6.6 区块结构合法');
  ok(secs && secs.value.every(s => !('src' in s)), '6.7 不应把 src 写进最终数据');
  ok(secs && secs.value.some(s => s.sort === 'timeline') && secs.value.some(s => s.sort === 'cards'),
    '6.8 timeline 与 cards 都在');
}

/* ============================================================ 场景 7：鲁棒性 */
console.log('\n══════ 场景 7：异常输入不应崩溃 ══════');
{
  const cases = ['', '   ', '\n\n\n', '随便一句话', '【】', '【项目经历】', '2021.09 - 2025.07',
    '电话：', '::::::', 'a'.repeat(5000), '【技能】\n：\n：：：'];
  let crashed = 0;
  cases.forEach((c, i) => {
    try {
      const r = Parser.parse(c);
      if (!r || !r.profile || !Array.isArray(r.sections)) throw new Error('结构不完整');
    } catch (e) {
      crashed++;
      console.log(`  用例 ${i} 崩溃: ${e.message}  ${JSON.stringify(c.slice(0, 30))}`);
    }
  });
  ok(crashed === 0, '7.1 全部异常输入都应安全返回', crashed + ' 个崩溃');
}

/* ============================================================ 场景 8：技能词表 */
console.log('\n══════ 场景 8：技能词表切分 ══════');
{
  const tags = Skills.extractTags('C 语言、Java；可完成基础算法实现、Android 客户端开发与嵌入式控制程序编写');
  console.log('  ' + tags.map(t => t.text + (t.level === 'main' ? '*' : '')).join(' | '));
  ok(tags.some(t => t.text === 'C 语言'), '8.1 C 语言');
  ok(tags.some(t => t.text === 'Java'), '8.2 Java');
  ok(tags.some(t => t.level === 'main'), '8.3 至少有主要技能');

  const t2 = Skills.extractTags('精通 Java、Go，熟悉 Spring Boot、MySQL、Redis、Docker、Kubernetes，了解 Kafka');
  const names = t2.map(t => t.text);
  ok(names.includes('Go') && names.includes('Spring Boot') && names.includes('Kubernetes'),
    '8.4 长词优先匹配且英文词正确', names.join('/'));
  ok(!names.includes('C'), '8.5 不应把 Java 里的 C 抠出来');

  const scanned = Skills.scanText('本科学过数据结构与计算机网络，用过 MATLAAB 和 pytorch');
  ok(scanned.some(s => s.text === '数据结构'), '8.6 全文扫描命中数据结构');
  ok(scanned.some(s => s.text === 'PyTorch'), '8.7 大小写不敏感命中 PyTorch');
}

/* ================================================== 场景 9：演示文本必须是纯占位值
   这是一条防回归断言：演示文本早期用过具体人名，用户点
   「填入示例 → 一键识别 → 应用到简历」之后，页面显示名就被换成了那个名字，
   看起来像简历写错了人。演示文本与模板只允许使用一眼可辨的占位值。 */
console.log('\n══════ 场景 9：演示文本的占位值约束 ══════');
{
  const sample = Parser.SAMPLE_FREETEXT;
  const tpl = Parser.TEMPLATE;

  /* 常见中文姓氏 + 常见名字用字，用来抓「像真人名」的两三字词 */
  const SURNAME = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜林黄徐高马刘郭';
  const GIVEN = '明伟芳娜秀英敏静丽强磊洋艳勇军杰娟涛超霞平刚桂兰志远豪鑫';
  const realNameLike = new RegExp('[' + SURNAME + '][' + GIVEN + '][' + GIVEN + ']?');
  const PLACEHOLDER = /示例姓名|某某|示例大学|示例公司/;

  ok(!realNameLike.test(sample.replace(new RegExp(PLACEHOLDER.source, 'g'), '')),
    '9.1 演示文本（去掉占位词后）不应出现像真人名的词',
    (sample.replace(new RegExp(PLACEHOLDER.source, 'g'), '').match(realNameLike) || [''])[0]);
  ok(sample.indexOf('示例姓名') !== -1, '9.2 演示文本应使用「示例姓名」占位');
  ok(sample.indexOf('13800000000') !== -1, '9.3 演示文本的电话应是 13800000000');
  ok(sample.indexOf('example@example.com') !== -1, '9.4 演示文本的邮箱应是 example 域');

  ok(!realNameLike.test(tpl.replace(new RegExp(PLACEHOLDER.source, 'g'), '')),
    '9.5 模板里也不应出现像真人名的词',
    (tpl.replace(new RegExp(PLACEHOLDER.source, 'g'), '').match(realNameLike) || [''])[0]);
  ok(tpl.indexOf('姓名：') !== -1, '9.6 模板里姓名一栏应留空给用户填');

  /* 演示文本必须仍能被解析出姓名，否则这条约束会把功能测没了 */
  const rev = Parser.parse(sample);
  ok(rev.profile.name === '示例姓名', '9.7 演示文本仍应能解析出姓名', rev.profile.name);
}

/* ================================================================== 汇总 */
console.log('\n' + '═'.repeat(64));
console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('\n  失败明细：');
  failures.forEach(f => console.log('   ✗ ' + f));
}
console.log('═'.repeat(64) + '\n');
process.exit(fail ? 1 : 0);
