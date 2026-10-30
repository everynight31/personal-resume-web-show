'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }

/* 用可控的动画时钟验证停播/恢复，避免后台和关闭效果仍持续申请帧。 */
const events = {}, docEvents = {}, queue = new Map(), calls = [];
let motionChange, nextFrame = 0;
let starArcs = 0;
const gradient = () => ({ addColorStop() {} });
const ctx = { clearRect() {}, setTransform() {}, fillRect() {}, beginPath() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, arc() { starArcs++; }, createRadialGradient:gradient, createLinearGradient:gradient };
const canvas = { style: {}, clientWidth: 800, clientHeight: 600, getContext: () => ctx };
const doc = {
  hidden: false,
  getElementById: () => canvas,
  documentElement: { getAttribute: () => 'light', setAttribute(name, value) { this[name] = value; } },
  addEventListener: (name, fn) => { docEvents[name] = fn; }
};
const env = {
  document: doc, Float32Array, Math, isFinite, setTimeout, clearTimeout,
  scrollY: 0,
  matchMedia: () => ({ matches: false, addEventListener: (name, fn) => { motionChange = fn; } }),
  addEventListener: (name, fn, options) => { events[name] = fn; if (/touch|pointer/.test(name)) check(options.passive, name+' 不应阻止触屏滚动'); },
  requestAnimationFrame: fn => { queue.set(++nextFrame, fn); return nextFrame; },
  cancelAnimationFrame: id => queue.delete(id),
  ResumeWater: { create: () => ({
    frame: dt => calls.push(['frame',dt]),
    disturb: (...args) => calls.push(['ripple',...args]),
    scroll: y => calls.push(['scroll',y])
  }) },
  ResumePetals: { create: () => ({
    frame: dt => calls.push(['petals',dt]),
    disturb: (...args) => calls.push(['wind',...args])
  }) }
};
env.window = env;
vm.runInNewContext(fs.readFileSync(path.join(ROOT,'js/particles.js'),'utf8'), env);
const P = env.ResumeParticles;
check(P.getEffect() === 'water', '首次使用应显示流动水面');
check(doc.documentElement['data-background'] === 'water', '文字主题与当前水面效果同步');
check(queue.size === 1, '启动只申请一条动画链');
events.pointermove({clientX: 120, clientY: 80});
check(calls.some(c => c[0] === 'ripple' && c[1] === 120), '鼠标移动传递到水面');
events.touchmove({touches:[{clientX:140,clientY:90}]});
check(calls.some(c => c[0] === 'ripple' && c[1] === 140), '触摸滑动传递到水面');
const before = calls.length;
events.pointerdown({clientX:20,clientY:20,target:{closest:()=>true}});
check(calls.length === before, '点击编辑器和按钮不触发背景');
env.scrollY = 450; events.scroll();
check(calls.some(c => c[0] === 'scroll' && c[1] === 450), '滚动位置传递到水面');
P.setEffect('off');
check(queue.size === 0 && canvas.style.display === 'none', '关闭背景应停止调度并隐藏画布');
check(doc.documentElement['data-background'] === 'off', '关闭水面后同时移除水感文字主题');
P.setEffect('water');
check(queue.size === 1, '重新启用应恢复且不重复调度');
doc.hidden = true; docEvents.visibilitychange();
check(queue.size === 0, '隐藏页面停止调度');
doc.hidden = false; docEvents.visibilitychange();
check(queue.size === 1, '回到页面恢复调度');
motionChange({matches:true});
check(queue.size === 0, '减少动态效果时不申请动画帧');
const staticCalls = calls.length;
events.pointermove({clientX:200,clientY:100});
check(calls.length === staticCalls, '减少动态效果时不生成交互波纹');
motionChange({matches:false});
check(queue.size === 1, '关闭减少动态效果后恢复');
events.beforeprint();
check(queue.size === 0 && canvas.style.display === 'none', '打印暂停并隐藏水面');
docEvents.visibilitychange();
check(queue.size === 0, '打印期间 visibilitychange 不能重启动画');
events.afterprint();
check(queue.size === 1, '打印结束恢复单条动画链');
check(!P.setEffect('unknown') && P.getEffect() === 'water', '无效效果不能破坏当前效果');

/* 星光是独立选项，交互星尘应有数量上限并及时消退。 */
check(P.EFFECTS.some(e => e.id === 'starlight') && P.EFFECTS.some(e => e.id === 'starfield'), '新增星光选项并保留旧星空');
starArcs = 0;
P.setEffect('starlight');
const baseStars = starArcs;
check(baseStars > 0 && doc.documentElement['data-background'] === 'starlight', '星光立即绘制并同步文字主题');
for (let i=0;i<50;i++) events.pointerdown({ clientX:200, clientY:150 });
function frame(ts) {
  const [id, fn] = queue.entries().next().value;
  queue.delete(id); starArcs = 0; fn(ts);
}
frame(1000);
check(starArcs <= baseStars + 32, '连续点击的星尘最多保留32颗');
for(let i=1;i<=35;i++) frame(1000+i*50);
check(starArcs === baseStars, '交互星尘会自然消退');
motionChange({matches:true});
check(queue.size === 0 && starArcs > 0, '减少动态效果时星光保留静态画面');
P.setEffect('water'); motionChange({matches:false});
check(P.getEffect() === 'water' && queue.size === 1, '星光与水面可以切换且不重复调度');

check(P.EFFECTS.length === 11 && P.EFFECTS.some(e => e.id === 'petals'), '花瓣加入设置列表，共11个背景选项');
P.setEffect('petals');
check(doc.documentElement['data-background'] === 'petals', '花瓣与文字主题同步');
events.touchmove({touches:[{clientX:180,clientY:220}]});
check(calls.some(c => c[0] === 'wind' && c[1] === 180), '手指滑动向花瓣传递阵风');
motionChange({matches:true});
check(queue.size === 0, '减少动态效果时花瓣不申请动画帧');
const windCalls = calls.length;
events.pointerdown({clientX:200,clientY:100});
check(calls.length === windCalls, '减少动态效果时不触发花瓣阵风');
P.setEffect('water'); motionChange({matches:false});

/* 没有 GPU 时仍能绘制，并且交互波纹最终消退。 */
let arcs = 0, fills = 0;
const fallbackCtx = { fillRect(){ fills++; }, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, arc(){ arcs++; } };
const fallback = { Math, Float32Array, isFinite, document:{ createElement:()=>({addEventListener(){}, getContext:()=>null}) } };
fallback.window = fallback;
vm.runInNewContext(fs.readFileSync(path.join(ROOT,'js/water.js'),'utf8'), fallback);
const water = fallback.ResumeWater.create(fallbackCtx,390,844,1,false);
water.frame(0);
check(fills > 0, '无 WebGL 时应绘制 Canvas 背景');
water.disturb(100,200,true); water.frame(.1);
check(arcs === 1, '回退模式同样显示触摸波纹');
arcs = 0; water.frame(5);
check(arcs === 0, '波纹会消退，不会无限堆积');
water.disturb(NaN,Infinity,true); water.frame(.1);
check(arcs === 0, '忽略无效输入坐标');
/* 水墨缓存、毛边扩散、交互上限和消退。 */
{
  let created = 0;
  const paint = { fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, closePath(){}, fill(){}, stroke(){} };
  const draws = [];
  const inkCtx = { createPattern:()=>({}), fillRect(){}, drawImage(...args){draws.push(args);} };
  const inkEnv = { Math, isFinite, document:{ createElement(){ created++; return {getContext:()=>paint}; } } };
  inkEnv.window=inkEnv;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'js/ink.js'),'utf8'),inkEnv);
  let seed=12;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const ink=inkEnv.ResumeInk.create(inkCtx,800,600,1,false,random);
  ink.frame(0);
  check(draws.length===4 && created===4, '水墨缓存一张宣纸和三种毛边墨迹，初始画面可见');
  draws.length=0;
  ink.disturb(300,200,true);ink.frame(.1);
  const small=draws[4][3];
  draws.length=0;ink.frame(1);
  check(draws[4][3]>small, '点击墨滴随时间扩散');
  for(let i=0;i<60;i++)ink.disturb(200+i,250,true);
  draws.length=0;ink.frame(.1);
  check(draws.length===18, '交互墨迹最多14处，防止无限累积');
  check(inkCtx.globalAlpha===1, '绘制后恢复透明度，不污染其他背景');
  draws.length=0;ink.frame(13);
  check(draws.length===4, '过期交互墨迹消退，仅保留环境墨晕');
  ink.disturb(NaN,Infinity,true);draws.length=0;ink.frame(.1);
  check(draws.length===4, '水墨忽略无效输入坐标');
  check(created===4, '每帧不会重新生成纸纹与墨迹缓存');
  inkEnv.document.createElement=()=>({getContext:()=>null});
  const plain=inkEnv.ResumeInk.create(inkCtx,390,844,1,true,random);
  check(typeof plain.frame==='function', '纹理画布不可用时仍提供纯色回退');
  plain.frame(0);
}
/* 云海纹理复用、数量上限、流动和无效输入。 */
{
  let created=0;
  const g=()=>({addColorStop(){}});
  const paint={createLinearGradient:g,createRadialGradient:g,fillRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){}};
  const draws=[];
  const screen={drawImage(...args){draws.push(args);},fillRect(){}};
  const cloudEnv={Math,isFinite,Number,document:{createElement(){created++;return {getContext:()=>paint};}}};
  cloudEnv.window=cloudEnv;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'js/clouds.js'),'utf8'),cloudEnv);
  const clouds=cloudEnv.ResumeClouds.create(screen,800,600,1,false,()=>.5);
  clouds.frame(0);
  check(created===4 && draws.length===13,'云海缓存天空和三种云絮，首帧绘制三层云');
  const startX=draws[1][1];draws.length=0;clouds.frame(1);
  check(draws[1][1]!==startX,'云絮会随时间缓慢流动');
  for(let i=0;i<100;i++)clouds.disturb(i*8,300,true);
  draws.length=0;clouds.scroll(900);clouds.frame(.1);
  check(draws.length===13 && created===4,'连续拨雾不累积粒子或重建纹理');
  check(screen.globalAlpha===1,'云海绘制后恢复透明度');
  clouds.disturb(NaN,Infinity,true);clouds.scroll(NaN);draws.length=0;clouds.frame(.1);
  check(draws.every(d=>d.slice(1).every(Number.isFinite)),'无效输入不能造成非法绘制坐标');
  const dense=cloudEnv.ResumeClouds.create(screen,390,844,99,true,()=>.5);
  draws.length=0;dense.frame(0);
  check(draws.length===19,'高强度云量最多18片');
  cloudEnv.document.createElement=()=>({getContext:()=>null});
  const plain=cloudEnv.ResumeClouds.create(screen,390,844,1,false,()=>.5);
  check(typeof plain.frame==='function','云纹理不可用时提供纯色回退');
  plain.frame(0);
}
/* 花瓣纹理缓存、交互风力、长期循环、移动端数量与无画布回退。 */
{
  let created = 0;
  const g = () => ({addColorStop(){}});
  const brush = {createLinearGradient:g,beginPath(){},moveTo(){},bezierCurveTo(){},closePath(){},fill(){},stroke(){}};
  const draws = [], positions = [];
  let position;
  const screen = {createLinearGradient:g,createRadialGradient:g,fillRect(){},save(){},restore(){},
    translate(x,y){position=[x,y];positions.push(position);},rotate(){},scale(){},drawImage(...args){draws.push(args);}};
  const petalEnv = {Math,Number,isFinite,document:{createElement(){created++;return {getContext:()=>brush};}}};
  petalEnv.window = petalEnv;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'js/petals.js'),'utf8'),petalEnv);
  const makePetals = (width=800,height=600,density=1,dark=false) => petalEnv.ResumePetals.create(screen,width,height,density,dark,()=>.25);
  const petals = makePetals();
  petals.frame(0);
  const total = draws.length;
  check(created===3 && total>=18 && total<=100, '花瓣缓存三种纹理，静态首帧可见');
  const start = positions[0].slice();draws.length=0;positions.length=0;
  petals.frame(.05);
  check(positions[0][1]>start[1] && positions[0][0]!==start[0], '花瓣同时飘落与随风横移');
  const calm = makePetals(), windy = makePetals();
  calm.frame(.05);const calmX=positions[positions.length-total][0];
  windy.disturb(0,150,true);windy.frame(.05);const windX=positions[positions.length-total][0];
  check(windX>calmX, '点击可以扬起花瓣并产生阵风');
  const scrolled=makePetals();scrolled.scroll(0);scrolled.scroll(100);scrolled.frame(.05);
  check(positions[positions.length-total][0]>calmX, '滚动产生短暂阵风');
  const cached=created;
  for(let i=0;i<2000;i++) {
    draws.length=0;positions.length=0;
    if(i%10===0) petals.disturb(i%800,300,true);
    petals.frame(.05);
    assert.equal(draws.length,total);
    assert.ok(positions.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)&&x>=-40&&x<=840&&y>=-40&&y<=640));
  }
  check(created===cached, '长时间交互不会增加花瓣数量、重建纹理或越过回收边界');
  petals.disturb(NaN,Infinity,true);petals.scroll(NaN);positions.length=0;petals.frame(.05);
  check(positions.every(p=>p.every(Number.isFinite)), '无效坐标不会破坏花瓣绘制');
  const dense=makePetals(1600,1000,99,true);draws.length=0;dense.frame(0);
  check(draws.length===100, '极高强度仍最多100片花瓣');
  const mobile=makePetals(390,844,.4);draws.length=0;mobile.frame(0);
  check(draws.length===18, '手机低强度使用轻量花瓣数量');
  petalEnv.document.createElement=()=>({getContext:()=>null});
  const plain=makePetals();draws.length=0;plain.frame(0);
  check(draws.length===0 && typeof plain.frame==='function', '纹理画布不可用时使用纯色渐变回退');
}
console.log('通过 ' + checks + ' 项，失败 0 项');
