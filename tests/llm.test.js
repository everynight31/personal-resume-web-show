 'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
function env(fetch){const e={fetch,AbortController,setTimeout,clearTimeout,console};e.window=e;for(const file of ['helpers','llm'])vm.runInNewContext(fs.readFileSync(path.join(root,'js/'+file+'.js'),'utf8'),e);return e;}
const success=object=>({ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(object)}}]})});
async function main(){
  const requests=[];const e=env(async(url,options)=>{requests.push(JSON.parse(options.body));return success({profile:{name:'测试'},sections:[]});});
  const review=await e.ResumeLLM.parseWithLLM('电话13800000000 邮箱test@example.com',{apiKey:'test-only'});
  assert.equal(requests[0].response_format.type,'json_object');
  assert.ok(!JSON.stringify(requests).includes('13800000000')&&!JSON.stringify(requests).includes('test@example.com'));
  assert.ok(review.profile.contacts.some(c=>c.value==='13800000000'));assert.ok(review.profile.contacts.some(c=>c.value==='test@example.com'));
  const malicious=e.ResumeLLM.normalizeReview({profile:{contacts:[{label:'网站',value:'click',href:'javascript:alert(1)'}]},sections:[
    {id:'hero',sort:'list',items:[{text:'a'}]}, {id:'projects',sort:'list',items:[{text:'b'}]}, {id:'projects',sort:'list',items:[{text:'c'}]},
    {id:'page-footer',sort:'timeline',items:[{org:'test',logo:'data:image/svg+xml,<svg onload=alert(1)>'}]}
  ]},'');
  assert.equal(malicious.profile.contacts[0].href,'');assert.equal(malicious.sections[3].items[0].logo,'');
  assert.ok(malicious.sections.every(s=>/^sec-[a-z0-9-]+$/.test(s.id)));assert.equal(new Set(malicious.sections.map(s=>s.id)).size,4);
  let attempts=0;const fallback=env(async(_,options)=>{attempts++;const body=JSON.parse(options.body);if(attempts===1){assert.ok(body.response_format);return {ok:false,status:400,text:async()=>'unsupported response_format'};}assert.ok(!body.response_format);return success({profile:{},sections:[]});});
  await fallback.ResumeLLM.parseWithLLM('示例',{apiKey:'test-only'});assert.equal(attempts,2);
  let failures=0;const forbidden=env(async()=>{failures++;return {ok:false,status:401,text:async()=>'unauthorized'};});
  await assert.rejects(forbidden.ResumeLLM.parseWithLLM('示例',{apiKey:'test-only'}));assert.equal(failures,1);
  const hanging=env(()=>new Promise(()=>{}));
  await assert.rejects(hanging.ResumeLLM.testConnection({apiKey:'test-only',timeoutMs:15}),/超时/);
  await assert.rejects(hanging.ResumeLLM.parseWithLLM('示例',{apiKey:'test-only',timeoutMs:15}),/超时/);
  console.log('LLM 协议白名单、ID、JSON 降级、脱敏和两种请求超时检查通过（无外网调用）');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
