'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const SCRIPT = path.resolve(__dirname, '../tools/serve.js');

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-serve-test-'));
  const root = path.join(temp, 'site'), sibling = path.join(temp, 'site-evil');
  let child;
  try {
    await fs.mkdir(path.join(root, 'tools'), {recursive:true});
    await fs.mkdir(path.join(root, 'nested'));
    await fs.mkdir(sibling);
    await fs.copyFile(SCRIPT, path.join(root, 'tools/serve.js'));
    await fs.writeFile(path.join(root, 'index.html'), '首页');
    await fs.writeFile(path.join(root, 'nested/index.html'), 'nested index');
    await fs.writeFile(path.join(sibling, 'secret.txt'), 'outside');
    const types = {jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',txt:'text/plain',map:'application/json',pdf:'application/pdf',woff:'font/woff',webmanifest:'application/manifest+json'};
    for (const ext of Object.keys(types)) await fs.writeFile(path.join(root, 'asset.'+ext), 'fixture');
    // Windows junctions require no developer-mode symlink privilege.
    await fs.symlink(sibling, path.join(root, 'outside'), process.platform==='win32'?'junction':'dir');
    const reservation = http.createServer();
    reservation.listen(0,'127.0.0.1'); await once(reservation,'listening');
    const port = reservation.address().port;
    await new Promise(resolve=>reservation.close(resolve));
    child = spawn(process.execPath,[path.join(root,'tools/serve.js'),String(port)],{stdio:['ignore','pipe','pipe']});
    let output=''; child.stdout.on('data', chunk=>{output+=chunk;});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('server startup timeout')),5000);
      child.stdout.on('data',()=>{if(output.includes(' at http://')){clearTimeout(timer);resolve();}});
      child.once('error',reject);
      child.once('exit',code=>{clearTimeout(timer);reject(new Error('server exited: '+code));});
    });
    async function request(url,method='GET') {
      return new Promise((resolve,reject)=>{
        const req=http.request({host:'127.0.0.1',port,path:url,method},res=>{
          const chunks=[];res.on('data',c=>chunks.push(c));
          res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
          res.on('error',reject);
        });req.on('error',reject);req.end();
      });
    }
    assert.equal((await request('/%E0%A4%A')).status,400,'malformed encoding must return 400 without killing the server');
    assert.equal((await request('/%00')).status,400);
    const home=await request('/?v=1');
    assert.equal(home.status,200);assert.equal(home.body,'首页');
    assert.equal(Number(home.headers['content-length']),Buffer.byteLength('首页'));
    assert.equal(home.headers['x-content-type-options'],'nosniff');
    assert.equal(home.headers['cache-control'],'no-store');
    assert.equal((await request('/nested/')).body,'nested index');
    assert.equal((await request('/outside/secret.txt')).status,403,'symlink must not escape the preview root');
    assert.equal((await request('/..%2fsite-evil/secret.txt')).status,403,'sibling-prefix traversal must be blocked');
    const head=await request('/','HEAD');
    assert.equal(head.status,200);assert.equal(head.body,'');assert.equal(head.headers['content-length'],home.headers['content-length']);
    const missing=await request('/not-here','HEAD');assert.equal(missing.status,404);assert.equal(missing.body,'');
    const post=await request('/','POST');assert.equal(post.status,405);assert.equal(post.headers.allow,'GET, HEAD');
    assert.equal((await request('/missing')).status,404);
    for(const [ext,type] of Object.entries(types)) assert.ok((await request('/asset.'+ext)).headers['content-type'].startsWith(type));
    const conflict=spawnSync(process.execPath,[SCRIPT,String(port)],{encoding:'utf8',timeout:5000});
    assert.equal(conflict.status,1);assert.match(conflict.stderr,/已被占用/);assert.doesNotMatch(conflict.stderr,/at Server/);
    for(const value of ['abc','5178abc','0','65536','1.5','']) {
      const invalid=spawnSync(process.execPath,[SCRIPT,value],{encoding:'utf8',timeout:5000});
      assert.equal(invalid.status,1);assert.match(invalid.stderr,/无效端口/);
    }
    assert.match(output,/400 GET/);assert.match(output,/200 HEAD/);assert.match(output,/405 POST/);
    console.log('预览服务器 HTTP 回归检查全部通过（编码、目录、边界、符号链接、HEAD、MIME、端口与日志）');
  } finally {
    if(child && child.exitCode===null) { const ended=once(child,'exit');child.kill();await ended; }
    // Only remove the freshly created, verified fixture directory.
    assert.equal(path.dirname(temp),path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('resume-serve-test-'));
    await fs.rm(temp,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
