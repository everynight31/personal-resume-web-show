/* 粗读 PDF：统计页数、检查是否误印了工具界面文字
   用法：node tools/inspect-pdf.js tests/_shots/resume.pdf */
'use strict';
const fs = require('fs');
const zlib = require('zlib');

const file = process.argv[2];
if (!file) { console.error('用法: node tools/inspect-pdf.js <file.pdf>'); process.exit(1); }
const buf = fs.readFileSync(file);

const pageCount = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log('文件: ' + file);
console.log('大小: ' + (buf.length / 1024).toFixed(0) + ' KB');
console.log('页数: ' + pageCount);

/* 解压所有 FlateDecode 流，看里面有哪些文字 */
const texts = [];
let idx = 0;
while (true) {
  const s = buf.indexOf('stream', idx);
  if (s === -1) break;
  let start = s + 6;
  if (buf[start] === 13) start++;
  if (buf[start] === 10) start++;
  const e = buf.indexOf('endstream', start);
  if (e === -1) break;
  const chunk = buf.slice(start, e);
  try {
    texts.push(zlib.inflateSync(chunk).toString('latin1'));
  } catch (err) { /* 非 Flate 流，跳过 */ }
  idx = e + 9;
}

const all = texts.join('\n');
console.log('解压流数量: ' + texts.length);

function has(label, re) {
  console.log((re.test(all) ? '  含  ' : '  无  ') + label);
}

/* 中文字在 PDF 里通常被编码过，这里主要检查英文/UI 关键词 */
console.log('工具界面检查（出现在 PDF 里说明打印样式没生效）:');
has('粘贴识别 FAB', /粘贴识别/);
has('drawer 标题“识别校对”', /识别校对/);
has('“应用到简历”按钮', /应用到简历/);
has('“一键识别”按钮', /一键识别/);
has('页脚版权行', /All rights reserved|Designed with a modern touch/);
has('正文关键英文（Python/MATLAB）', /Python|MATLAB/);
has('导航锚点', /教育背景/);

/* 找一下页面尺寸，确认是 A4 */
const mb = buf.toString('latin1').match(/\/MediaBox\s*\[([^\]]+)\]/g) || [];
console.log('MediaBox: ' + JSON.stringify(mb.slice(0, 3)));
