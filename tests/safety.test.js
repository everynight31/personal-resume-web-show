 'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.resolve(__dirname,'..');
function memory(){const map=new Map();return {getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};}
function env(local=memory(),session=memory(),version=1){const e={localStorage:local,sessionStorage:session,console,setTimeout,clearTimeout,RESUME_DATA:{meta:{dataVersion:version},profile:{name:'默认',contacts:[]},scores:{total:{value:'90'},items:[]},sections:[]}};e.window=e;for(const n of ['helpers','store'])vm.runInNewContext(fs.readFileSync(path.join(root,'js/'+n+'.js'),'utf8'),e);return e;}
const a=env();const data=a.ResumeStore.load();data.profile.name='我的修改';delete data.scores;a.ResumeStore.save(data);
const b=env(a.localStorage,a.sessionStorage,2);
assert.equal(b.ResumeStore.load().profile.name,'我的修改','version updates must preserve edits');
assert.ok(b.ResumeStore.exportRecovery(),'migration must retain exportable original data');
assert.equal(b.ResumeStore.load().scores,undefined,'deleted fields must not reappear from defaults');
assert.throws(()=>b.ResumeStore.parseJSON('{"sections":"abc"}'));
const merged=b.ResumeStore.deepMerge({},JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'));
assert.equal(merged.polluted,undefined);assert.ok(!Object.prototype.hasOwnProperty.call(merged,'constructor'));
const target={};b.ResumeStore.setByPath(target,'__proto__.polluted',true);assert.equal(target.polluted,undefined);
b.ResumeStore.pushUndo({profile:{name:'一步',contacts:[]},sections:[]});b.ResumeStore.pushUndo({profile:{name:'两步',contacts:[]},sections:[]});
const c=env(a.localStorage,a.sessionStorage,2);assert.ok(c.ResumeStore.canUndo());assert.equal(c.ResumeStore.undo().profile.name,'两步');assert.equal(c.ResumeStore.undo().profile.name,'一步');
console.log('版本迁移、快照删除、导入、防原型污染和跨刷新撤销检查通过');

// Backup failure must leave the original bytes untouched, including on attempted save.
const full=memory();const legacy=JSON.stringify({__v:1,profile:{name:'保留',contacts:[]},sections:[]});full.setItem('resume.data.v1',legacy);
full.setItem=()=>{throw new Error('quota');};const limited=env(full,memory(),2);assert.equal(limited.ResumeStore.load().profile.name,'保留');assert.equal(full.getItem('resume.data.v1'),legacy);
assert.throws(()=>limited.ResumeStore.save({profile:{name:'新值',contacts:[]},sections:[]}));assert.equal(full.getItem('resume.data.v1'),legacy);
for(const text of ['{"profile":{"contacts":"bad"}}','{"sections":[{"sort":"cards","items":[{"blocks":"bad"}]}]}','{"sections":[{"sort":"tags","groups":[{"items":[null]}]}]}'])assert.throws(()=>a.ResumeStore.parseJSON(text));
const capped=env();for(let i=0;i<15;i++)capped.ResumeStore.pushUndo({profile:{name:String(i),contacts:[]},sections:[]});assert.equal(capped.ResumeStore.getUndoState().length,10);
const fail=capped.ResumeStore.getUndoState();capped.localStorage.setItem=()=>{throw new Error('quota');};assert.throws(()=>capped.ResumeStore.undo());assert.equal(capped.ResumeStore.getUndoState().length,fail.length);
const wiped=env();wiped.ResumeStore.setThemePref('dark');wiped.ResumeStore.pushUndo({profile:{name:'test',contacts:[]},sections:[]});wiped.ResumeStore.wipeLocal();assert.equal(wiped.ResumeStore.getThemePref(),'');assert.ok(!wiped.ResumeStore.canUndo());

const transactions=env();const initial=transactions.ResumeStore.load();
transactions.ResumeStore.commit(initial,'无变化');const noChangeCount=transactions.ResumeStore.getUndoState().length;
transactions.ResumeStore.commit(transactions.ResumeStore.load(),'仍无变化');assert.equal(transactions.ResumeStore.getUndoState().length,noChangeCount);
transactions.ResumeStore.update({'profile.name':'姓名修改'},'编辑姓名');transactions.ResumeStore.update({'profile.avatar':'assets/avatar.svg'},'更换头像');
assert.equal(transactions.ResumeStore.nextUndoLabel(),'更换头像');transactions.ResumeStore.undo();assert.equal(transactions.ResumeStore.load().profile.avatar,undefined);assert.equal(transactions.ResumeStore.nextUndoLabel(),'编辑姓名');
transactions.ResumeStore.undo();assert.equal(transactions.ResumeStore.load().profile.name,initial.profile.name);
const failureCount=transactions.ResumeStore.getUndoState().length;transactions.localStorage.setItem=()=>{throw new Error('quota');};assert.throws(()=>transactions.ResumeStore.update({'profile.name':'失败修改'}));assert.equal(transactions.ResumeStore.getUndoState().length,failureCount);
