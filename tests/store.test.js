/* 数据层测试：node tests/store.test.js
   覆盖三件事：
     1. 版本戳自愈 —— 改了 data.js 之后，浏览器里的旧覆盖必须自动作废
     2. 背景特效偏好的读写与夹取
     3. 区块（模块）管理 —— 批量更新 / 删除 / 上下移
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; return true; }
  fail++;
  failures.push(label + (extra ? '  →  ' + extra : ''));
  return false;
}

/** 造一个带假 localStorage 的沙箱，加载 store.js */
function makeEnv(baseData) {
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const sandbox = vm.createContext({
    console, setTimeout, clearTimeout, JSON, Math, Date, RegExp, localStorage
  });
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.RESUME_DATA = JSON.parse(JSON.stringify(baseData));
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8'), sandbox, { filename: 'store.js' });
  return { Store: sandbox.ResumeStore, localStorage };
}

const DATA_V1 = {
  meta: { dataVersion: 1, title: 'v1', footer: 'f1' },
  profile: { name: '示例姓名', headline: '示例大学', contacts: [] },
  sections: [{ id: 'education', title: '教育背景', sort: 'timeline', items: [{ org: '示例大学' }] }]
};

const DATA_V2 = {
  meta: { dataVersion: 2, title: 'v2', footer: 'f2' },
  profile: { name: '示例姓名', headline: '示例大学 | 求职意向：后端开发', contacts: [] },
  sections: [{ id: 'education', title: '教育背景', sort: 'timeline', items: [{ org: '示例大学' }] }]
};

console.log('\n══════ 数据层 ══════');

/* ------------------------------------------------------------ 版本戳 */
console.log('\n-- 版本戳自愈 --');

/* 1. 没有本地数据时，直接用默认值 */
{
  const { Store } = makeEnv(DATA_V1);
  const d = Store.load();
  ok(d.meta.title === 'v1', '1.1 无覆盖时用默认数据', d.meta.title);
  ok(!Store.hasOverride(), '1.2 无覆盖时 hasOverride 应为 false');
}

/* 2. 保存后能读回来（覆盖生效） */
{
  const { Store, localStorage } = makeEnv(DATA_V1);
  const d = Store.load();
  d.profile.headline = '我手动改过的身份行';
  Store.save(d);

  ok(Store.hasOverride(), '2.1 保存后 hasOverride 应为 true');
  const raw = JSON.parse(localStorage.getItem(Store.LS_DATA));
  ok(raw.__v === 1, '2.2 落盘数据应带 __v=1', String(raw.__v));

  const back = Store.load();
  ok(back.profile.headline === '我手动改过的身份行', '2.3 覆盖应生效', back.profile.headline);
}

/* 3. 关键场景：data.js 升版后，旧覆盖必须被丢弃 */
{
  const env1 = makeEnv(DATA_V1);
  const d1 = env1.Store.load();
  d1.profile.headline = '这是旧版数据留下的内容';
  d1.meta.title = '旧标题';
  env1.Store.save(d1);
  const carried = env1.localStorage.getItem(env1.Store.LS_DATA);

  const env2 = makeEnv(DATA_V2);
  env2.localStorage.setItem(env2.Store.LS_DATA, carried);

  const loaded = env2.Store.load();
  ok(loaded.meta.title === 'v2', '3.1 升版后应改用新的默认数据', loaded.meta.title);
  ok(loaded.profile.headline.indexOf('旧版数据') === -1, '3.2 旧覆盖内容不应残留', loaded.profile.headline);
  ok(loaded.profile.headline === DATA_V2.profile.headline, '3.3 应拿到 v2 的值', loaded.profile.headline);
  ok(!!env2.Store.lastDiscard, '3.4 应记录丢弃原因供 UI 提示', String(env2.Store.lastDiscard));
  ok(env2.localStorage.getItem(env2.Store.LS_DATA) === null, '3.5 过期数据应从 localStorage 清掉');
  ok(!env2.Store.hasOverride(), '3.6 丢弃后 hasOverride 应为 false');
}

/* 4. 同版本内的覆盖不受影响（用户正常编辑不会莫名丢失） */
{
  const env = makeEnv(DATA_V1);
  const d = env.Store.load();
  d.profile.headline = '同版本内的修改';
  env.Store.save(d);
  env.Store.lastDiscard = null;

  const again = env.Store.load();
  ok(again.profile.headline === '同版本内的修改', '4.1 同版本覆盖应保留', again.profile.headline);
  ok(!env.Store.lastDiscard, '4.2 同版本不应触发丢弃');
}

/* 5. 老格式（没有 __v）的存量覆盖也要被丢掉 */
{
  const env = makeEnv(DATA_V1);
  env.localStorage.setItem(env.Store.LS_DATA, JSON.stringify({
    profile: { headline: '没有版本号的老数据' }, meta: { title: '老标题' }
  }));
  const d = env.Store.load();
  ok(d.meta.title === 'v1', '5.1 无版本号的老覆盖应被丢弃', d.meta.title);
  ok(d.profile.headline !== '没有版本号的老数据', '5.2 老覆盖内容不应生效', d.profile.headline);
}

/* 6. 损坏的 JSON 不应让页面崩掉 */
{
  const env = makeEnv(DATA_V1);
  env.localStorage.setItem(env.Store.LS_DATA, '{ 这不是合法 JSON');
  const d = env.Store.load();
  ok(d.meta.title === 'v1', '6.1 坏数据应回退到默认值', d.meta.title);
}

/* -------------------------------------------------------- 背景偏好 */
console.log('\n-- 背景特效偏好 --');
{
  const { Store } = makeEnv(DATA_V1);

  const def = Store.getBg();
  ok(def.effect === 'network' && def.density === 1, '7.1 背景默认值应为 network / 1',
    JSON.stringify(def));

  Store.setBg({ effect: 'starfield' });
  ok(Store.getBg().effect === 'starfield', '7.2 应能记住特效选择', Store.getBg().effect);
  ok(Store.getBg().density === 1, '7.3 只改特效不应影响密度', String(Store.getBg().density));

  Store.setBg({ density: 1.6 });
  ok(Math.abs(Store.getBg().density - 1.6) < 1e-9, '7.4 应能记住密度', String(Store.getBg().density));
  ok(Store.getBg().effect === 'starfield', '7.5 只改密度不应影响特效', Store.getBg().effect);

  Store.setBg({ density: 99 });
  ok(Store.getBg().density === 2, '7.6 密度上限应夹到 2', String(Store.getBg().density));
  Store.setBg({ density: 0.01 });
  ok(Store.getBg().density === 0.4, '7.7 密度下限应夹到 0.4', String(Store.getBg().density));
  Store.setBg({ density: 'abc' });
  ok(Store.getBg().density === 1, '7.8 非法密度应回落到 1', String(Store.getBg().density));

  Store.wipeLocal();
  ok(Store.getBg().effect === 'network', '7.9 wipeLocal 应清掉背景偏好', Store.getBg().effect);
}

/* -------------------------------------------------------- 模块管理 */
console.log('\n-- 区块（模块）管理 --');
{
  const { Store } = makeEnv(DATA_V1);

  const d1 = Store.load();
  d1.sections = [
    { id: 'a', title: 'A', sort: 'list', items: [] },
    { id: 'b', title: 'B', sort: 'list', items: [] },
    { id: 'c', title: 'C', sort: 'list', items: [] }
  ];
  Store.save(d1);

  /* update：一次写多个位置，路径写入与整体替换都要支持 */
  Store.update({
    'profile.name': '新名字',
    sections: [
      { id: 'a', title: 'A', sort: 'list', items: [] },
      { id: 'b', title: 'B', sort: 'list', items: [] }
    ]
  });
  ok(Store.load().profile.name === '新名字', '8.1 update 支持按路径写入', Store.load().profile.name);
  ok(Store.load().sections.length === 2, '8.2 update 支持整体替换数组', String(Store.load().sections.length));

  ok(!!Store.removeSection('a'), '8.3 removeSection 应返回新数据');
  ok(Store.load().sections.length === 1, '8.4 删除后只剩一个',
    JSON.stringify(Store.load().sections.map(s => s.id)));
  ok(Store.load().sections[0].id === 'b', '8.5 删掉的应是目标区块', Store.load().sections[0].id);
  ok(Store.removeSection('不存在') === null, '8.6 删除不存在的区块应返回 null（不白写一次）');

  /* 上下移 */
  const env2 = makeEnv(DATA_V1);
  const d2 = env2.Store.load();
  d2.sections = [
    { id: 'x', title: 'X', sort: 'list', items: [] },
    { id: 'y', title: 'Y', sort: 'list', items: [] },
    { id: 'z', title: 'Z', sort: 'list', items: [] }
  ];
  env2.Store.save(d2);

  env2.Store.moveSection('y', -1);
  ok(env2.Store.load().sections.map(s => s.id).join('') === 'yxz', '8.7 上移结果应为 yxz',
    env2.Store.load().sections.map(s => s.id).join(''));

  env2.Store.moveSection('y', 1);
  ok(env2.Store.load().sections.map(s => s.id).join('') === 'xyz', '8.8 再下移应恢复 xyz',
    env2.Store.load().sections.map(s => s.id).join(''));

  ok(env2.Store.moveSection('x', -1) === null, '8.9 首个区块上移应返回 null');
  ok(env2.Store.moveSection('z', 1) === null, '8.10 末个区块下移应返回 null');
  ok(env2.Store.load().sections.map(s => s.id).join('') === 'xyz', '8.11 越界移动不应改变顺序');

  /* 落盘后不应被外部对象后续修改带偏 */
  const patch = { profile: { name: '甲' } };
  Store.update(patch);
  patch.profile.name = '乙';
  ok(Store.load().profile.name === '甲', '8.12 落盘数据不应被外部对象后续修改影响',
    Store.load().profile.name);
}

/* 删除区块要能持久化：重新 load 仍是删掉的状态 */
{
  const env3 = makeEnv(DATA_V1);
  env3.Store.load();
  env3.Store.removeSection('education');
  ok(env3.Store.load().sections.length === 0, '8.13 删除结果应已落盘',
    String(env3.Store.load().sections.length));
}

/* ------------------------------------------------------ 真实 data.js */
console.log('\n-- 真实 data.js --');
{
  const sandbox = vm.createContext({ console, JSON, Math, Date, RegExp });
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'), sandbox, { filename: 'data.js' });
  const real = sandbox.RESUME_DATA;

  ok(typeof (real.meta && real.meta.dataVersion) === 'number',
    '9.1 data.js 的 meta.dataVersion 必须是数字', String(real.meta && real.meta.dataVersion));
  ok(!('scores' in real), '9.2 求职简历的 data.js 不应有 scores 字段',
    JSON.stringify(Object.keys(real)));

  /* 电话/邮箱/链接必须是示例值；「基本信息」那条是性别年龄，不在检查范围 */
  const byLabel = {};
  real.profile.contacts.forEach(c => { byLabel[c.label] = c.value; });
  ok(byLabel['电话'] === '13800000000', '9.3 电话应为 13800000000', byLabel['电话']);
  ok(/@example\.com$/.test(byLabel['邮箱'] || ''), '9.4 邮箱应为 example.com 示例域', byLabel['邮箱']);
  ok(/github\.com\/example$/.test(byLabel['GitHub'] || ''), '9.5 主页应为示例链接', byLabel['GitHub']);

  ok(Array.isArray(real.sections) && real.sections.length > 0, '9.6 应至少有一个区块',
    String(real.sections && real.sections.length));
  const ids = (real.sections || []).map(s => s.id);
  ok(new Set(ids).size === ids.length, '9.7 区块 id 不应重复', ids.join(','));
  ok((real.sections || []).every(s => s.id && s.title && s.sort), '9.8 每个区块都应有 id/title/sort');
}

console.log('\n' + '═'.repeat(60));
console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
if (fail) { console.log('\n  失败明细：'); failures.forEach(f => console.log('   ✗ ' + f)); }
console.log('═'.repeat(60) + '\n');
process.exit(fail ? 1 : 0);
