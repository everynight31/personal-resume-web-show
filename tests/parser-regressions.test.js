 'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(skills=true){const env={};env.window=env;for(const name of (skills?['skills','parser']:['parser']))vm.runInNewContext(fs.readFileSync(path.join(root,'js/'+name+'.js'),'utf8'),env);return env.ResumeParser;}
const p=load();
assert.doesNotThrow(()=>load(false).parse('独立完成接口开发和功能调试。'));
assert.ok(!/\(\?<([=!])/.test(fs.readFileSync(path.join(root,'js/parser.js'),'utf8')),'parser must load in engines without lookbehind');
assert.equal(p.parse('科研经历较少\n参与过课程实践。').mode,'freeform');
assert.equal(p.parse('项目经历（节选）\n测试系统 | 2024.01 - 2024.06\n技术实现：完成开发').mode,'labeled');
const warnings=[];assert.ok(p.lookupSection('教育背景与项目经历',warnings));assert.ok(warnings.length);
assert.equal(p.lookupSection('研究兴趣与复试方向（节选）').id,'research');
for(const input of ['2021138000000001','113800000000','138000000001'])assert.ok(!p.parse(input).profile.contacts.some(x=>x.label==='电话'));
for(const input of ['+86 138-0000-0000','138 0000 0000','13800000000'])assert.ok(p.parse('电话：'+input).profile.contacts.some(x=>x.value==='13800000000'));
assert.equal(p.extractScores(['成绩优异，功耗降低约30%']),null);
assert.equal(p.extractScores(['考试成绩 数学30%']),null);
assert.equal(p.extractScores(['总分90 数学95']).total.value,'90');
assert.equal(p.parse('主页：www.x.com).').profile.contacts.find(x=>x.label==='主页').href,'https://www.x.com');
assert.equal(p.normalizeDate('2021-9-1'),'2021.09.01');
const dates=p.parse('【教育背景】\n2021-9-1 - 2025-6-30 示例大学 本科').sections[0].items[0].date;
assert.ok(dates.includes('2021.09.01')&&dates.includes('2025.06.30'));
const chunks=p.freeformParse(['编程语言：熟练掌握Python、Java、SQL，技能开发工具','项目开发：设计系统平台，完成接口开发与测试','技术栈：熟练掌握Go、C++、Rust技能'],{name:'',headline:'',intent:'',contacts:[]},[]).sections;
const skills=chunks.filter(x=>x.id==='skills');assert.equal(skills.length,1);assert.ok(JSON.stringify(skills).includes('Python')&&JSON.stringify(skills).includes('Rust'));
/* 内置「填入示例」必须能完整识别：毕业设计归项目，「大学生竞赛」获奖归奖项，而不是教育背景 */
const sample=p.parse(p.SAMPLE_FREETEXT).sections;
const ids=sample.map(x=>x.id);
assert.equal(sample.find(x=>x.id==='education').items.length,1,'示例只有一段学历');
assert.ok(ids.includes('projects')&&ids.includes('awards')&&ids.includes('skills')&&ids.includes('abilities'),'示例应识别出项目、奖项、技能、自我评价：'+ids.join(','));
assert.ok(sample.find(x=>x.id==='projects').items[0].org.length<=31,'整句描述不应当成项目名');
/* 自由文本里「至今 + 公司 + 职位」是工作经历，后面的描述留在同一段 */
const job=p.parse('2019.09-2023.06 清华大学 软件工程 本科\n2023.07-至今 字节跳动 后端工程师\n负责推荐系统接口开发，QPS 提升 3 倍').sections;
const work=job.find(x=>x.id==='work');
assert.ok(work&&!job.some(x=>x.id==='projects'),'工作经历不应拆成项目：'+job.map(x=>x.id).join(','));
assert.equal(work.items.length,1);assert.equal(work.items[0].blocks[0].label,'工作内容');
assert.ok(work.items[0].blocks[0].text.includes('QPS'));
console.log('解析兼容性、联系方式、日期、分数、标题与技能合并回归检查通过');
