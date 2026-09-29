/* 调试用：把解析过程中间结果打出来 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const sandbox = vm.createContext({ console, setTimeout, clearTimeout, JSON, Math, Date, RegExp });
sandbox.window = sandbox; sandbox.globalThis = sandbox;
for (const f of ['js/skills.js', 'js/parser.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const P = sandbox.ResumeParser;

const text = fs.readFileSync(path.join(ROOT, 'tests/fixtures/resume_docx.txt'), 'utf8');
const rev = P.parse(text);

console.log('--- 联系方式原始对象 ---');
console.log(JSON.stringify(rev.profile.contacts, null, 1));

console.log('\n--- 教育条目 ---');
(rev.sections.find(s => s.id === 'education') || { items: [] }).items.forEach(i => console.log(JSON.stringify(i)));

console.log('\n--- 项目/工程条目 ---');
[...(rev.sections.filter(s => s.sort === 'cards'))].forEach(s => {
  console.log('[' + s.id + '] ' + s.title);
  s.items.forEach(i => {
    console.log('  org=' + JSON.stringify(i.org) + ' date=' + JSON.stringify(i.date) + ' title=' + JSON.stringify(i.title));
    i.blocks.forEach((b, n) => console.log('    block' + n + ' label=' + JSON.stringify(b.label) + ' text=' + JSON.stringify(String(b.text).slice(0, 60))));
  });
});

console.log('\n--- 逐行：日期切分结果 ---');
text.split('\n').forEach((l, i) => {
  const t = l.trim();
  if (!t) return;
  const dm = P.__splitAnyDate ? P.__splitAnyDate(t) : null;
  const range = /(\d{4}\s*[.\-/年]\s*\d{1,2}|\d{4}\s*年|至今)[\s\S]{0,4}?(?:--|—|–|-|~|～|至|到|to|－)[\s\S]{0,4}?(\d{4}\s*[.\-/年]\s*\d{1,2}|\d{4}\s*年|至今)/.exec(t);
  console.log(String(i).padStart(2) + ' | ' + (range ? 'DATE ' + JSON.stringify(range[0]) : '     ') + ' | ' + t.slice(0, 70));
});
