/* 全项目占位值体检：node tools/audit-placeholders.js
   目的：确保仓库里不存在「像真人」的姓名/联系方式，避免用户误当成真实身份。 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const EXTS = /\.(js|html|css|md|txt|json|svg|gitignore)$/;
/* 本文件自己就写着各种「像真名 / 像真邮箱」的示例，扫自己没有意义 */
const SKIP_FILES = new Set(['tools/audit-placeholders.js']);

/* 常见中文姓氏 + 常见名字用字 —— 组合出「像真人名」的两三字词 */
const SURNAME = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜林黄徐高马刘郭';
const GIVEN = '明伟芳娜秀英敏静丽强磊洋艳勇军杰娟涛超霞平刚桂兰志远豪鑫';
const NAME_LIKE = new RegExp('[' + SURNAME + '][' + GIVEN + '][' + GIVEN + ']?', 'g');

/* 姓名拼音：邮箱、账号、文件名里最容易漏掉的一种泄漏。
   规则：常见姓氏拼音 + 常见名字拼音，拼在一起算命中（chenxiao / zhangwei）。
   这条是补漏加的 —— 之前有个测试用例用了 chenxiao@test.com，中文规则查不出来。 */
const SURNAME_PY = 'zhao|qian|sun|li|zhou|wu|zheng|wang|feng|chen|chu|wei|jiang|shen|han|yang|' +
  'zhu|qin|you|xu|he|lv|lu|shi|zhang|kong|cao|yan|hua|jin|wei|tao|jiang|huang|xu|gao|ma|liu|guo|lin|xie';
const GIVEN_PY = 'ming|wei|fang|na|xiu|ying|min|jing|li|qiang|lei|yang|yan|yong|jun|jie|juan|tao|' +
  'chao|xia|ping|gang|gui|lan|zhi|yuan|hao|xin|xiao|chen|hui|ting|feng|long|peng|yu';
const PINYIN_NAME = new RegExp('\\b(?:' + SURNAME_PY + ')(?:' + GIVEN_PY + '){1,2}\\b', 'gi');
/* 明确是示例域的邮箱不算问题 */
const MAIL_EXAMPLE = /@(?:[\w-]*example[\w-]*)\.[a-z]+$/i;

/* 允许出现在仓库里的占位值（README 会举例说明，属正常） */
const ALLOW_LINES = /README\.md$/;
/* 明确标注为示例的占位名一律放行 */
const ALLOW_NAME = /示例姓名|某某大学|示例大学/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let problems = 0;
console.log('══ 占位值体检 ══\n');

for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  if (SKIP_FILES.has(rel.split(path.sep).join('/'))) continue;
  if (!EXTS.test(file) && !/gitignore/.test(file)) continue;

  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach(function (line, i) {
    const hits = line.match(NAME_LIKE);
    if (!hits) return;
    if (ALLOW_NAME.test(line)) return;
    if (ALLOW_LINES.test(rel) && /示例数据|姓名「|均为编造|示例姓名/.test(line)) return;
    console.log('  姓名疑似真名  ' + rel + ':' + (i + 1));
    console.log('      ' + hits.join(' ') + '   ←   ' + line.trim().slice(0, 84));
    problems++;
  });
}

/* 真实手机号 / 邮箱特征：133-139、150-199 开头的 11 位数字，
   只放行仓库里约定的占位号段 13800000000 起 */
const PHONE = /\b1[3-9]\d{9}\b/g;
const PHONE_OK = /^1380000000\d$/;
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  if (SKIP_FILES.has(rel.split(path.sep).join('/'))) continue;
  if (!EXTS.test(file)) continue;
  fs.readFileSync(file, 'utf8').split('\n').forEach(function (line, i) {
    const hits = line.match(PHONE) || [];
    const bad = hits.filter(h => !PHONE_OK.test(h));
    if (!bad.length) return;
    console.log('  可疑手机号    ' + rel + ':' + (i + 1) + '  ' + bad.join(' '));
    problems++;
  });
}

/* 邮箱：非示例域的一律要人工确认（可能是真实邮箱泄漏） */
const MAIL = /[\w.+-]+@[\w-]+\.[a-z]{2,}/gi;
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  if (SKIP_FILES.has(rel.split(path.sep).join('/'))) continue;
  if (!EXTS.test(file)) continue;
  fs.readFileSync(file, 'utf8').split('\n').forEach(function (line, i) {
    (line.match(MAIL) || []).forEach(function (m) {
      if (MAIL_EXAMPLE.test(m)) return;
      console.log('  非示例邮箱    ' + rel + ':' + (i + 1) + '  ' + m);
      problems++;
    });
  });
}

/* 拼音姓名：中文规则查不出来的那类 */
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  if (SKIP_FILES.has(rel.split(path.sep).join('/'))) continue;
  if (!EXTS.test(file)) continue;
  fs.readFileSync(file, 'utf8').split('\n').forEach(function (line, i) {
    /* 只在不含占位标记的行上报警，避免 example 之类误报 */
    if (/example|示例|placeholder|示例姓名/i.test(line)) return;
    const hits = line.match(PINYIN_NAME) || [];
    const bad = hits.filter(h => !/^(?:li|ma|lu|xu|he|yu|chen|yang)$/i.test(h));
    if (!bad.length) return;
    console.log('  拼音姓名疑似  ' + rel + ':' + (i + 1) + '  ' + bad.join(' '));
    console.log('      ←   ' + line.trim().slice(0, 84));
    problems++;
  });
}

console.log('');
console.log(problems ? '  ❌ 发现 ' + problems + ' 处需要处理' : '  ✅ 未发现像真实身份的内容');
process.exit(problems ? 1 : 0);
