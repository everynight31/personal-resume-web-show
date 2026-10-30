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
console.log('通过 ' + checks + ' 项，失败 0 项');
