 'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const env={};env.window=env;vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../js/ui-codec.js'),'utf8'),env);
const codec=env.ResumeUICodec.create({});
const cases={
  line:['阿依古丽·买买提','·真实内容','带\反斜线与\n换行\n末尾'],
  kv:[{label:'联系人',value:'阿依古丽·买买提',href:'mailto:a@example.com',icon:'mail'},{label:'标签·内容',value:' | '},{label:'',value:'·行首内容'}],
  kvtitle:[{title:'说明·补充',text:'原样 | 内容\n下一行'}],
  addr:[{org:'学校 | 学院',date:'2021.09 – 2025.06',degree:'本科',location:'乌鲁木齐',logo:'avatar.svg',bullets:['·保留行首间隔号','第一行\n第二行']}],
  card:[{org:'A|B',date:'2024',title:'开发·负责人',location:'',logo:'',blocks:[{label:'目标·结果',text:'保留 |、· 与换行\n第二行'}]}],
  taggroup:[{title:'语言·工具',items:[{text:'A/B',level:'main'},{text:'Python',level:'aux'}]}]
};
for(const [kind,input] of Object.entries(cases)){
  const output=codec.textToItemList(codec.itemListToText(input,kind),kind);
  assert.deepEqual(JSON.parse(JSON.stringify(output)),input,kind+' round trip');
}
assert.throws(()=>codec.textToItemList('[{"value":','kv'),/格式/);
console.log('六种编辑格式的特殊字符与附加字段往返检查通过');

const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const scripts=[...html.matchAll(/<script\s+src="([^"]+)"[^>]*>/g)].map(m=>m[1]);
assert.ok(!/<script[^>]*type="module"/.test(html));
for(const name of ['codec','review','drawer','avatar','settings'])assert.ok(scripts.indexOf('js/ui-'+name+'.js')<scripts.indexOf('js/ui.js'));
for(const script of scripts)assert.ok(fs.existsSync(path.resolve(__dirname,'..',script)));

assert.equal(codec.textToItemList('阿依古丽·买买提','kv')[0].value,'阿依古丽·买买提');
