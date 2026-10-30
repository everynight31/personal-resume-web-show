/* 流动水面：GPU 折射光纹 + 有界的交互涟漪；无 WebGL 时使用 Canvas 波纹。 */
(function (global) {
  'use strict';
  var surface = null, gpu = null, unavailable = false;
  var VERTEX = 'attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}';
  var FRAGMENT = [
    'precision mediump float;',
    'uniform vec2 resolution;',
    'uniform float time, dark, strength, drift;',
    'uniform vec4 ripples[8];',
    'float heightAt(vec2 p) {',
    '  return sin(p.x*1.7 + sin(p.y*1.4 + time*.24))*.32',
    '    + sin(p.y*2.3 - time*.34 + sin(p.x*1.2))*.22',
    '    + sin(dot(p,vec2(2.9,1.8))+time*.42)*.12;',
    '}',
    'void main(){',
    '  vec2 uv=gl_FragCoord.xy/resolution;',
    '  float aspect=resolution.x/resolution.y;',
    '  vec2 p=uv*vec2(aspect,1.)*5.;',
    '  p.y+=drift*.22;',
    '  vec2 disturbance=vec2(0.); float rings=0.;',
    '  for(int i=0;i<8;i++){',
    '    vec4 r=ripples[i]; float age=time-r.z;',
    '    vec2 delta=(uv-r.xy)*vec2(aspect,1.); float dist=length(delta);',
    '    float front=dist-age*.18;',
    '    float envelope=exp(-front*front*170.)*exp(-age*1.15)*r.w;',
    '    float wave=sin(front*72.)*envelope;',
    '    disturbance+=delta/max(dist,.005)*wave*.16;',
    '    rings+=wave;',
    '  }',
    '  p+=disturbance;',
    '  float h=heightAt(p);',
    '  vec2 gradient=vec2(heightAt(p+vec2(.025,0.))-h,heightAt(p+vec2(0.,.025))-h)/.025;',
    '  vec2 q=p+vec2(sin(p.y*1.3+time*.19),cos(p.x*1.2-time*.21))*.75;',
    '  q+=vec2(sin(q.y*2.1-time*.28),sin(q.x*1.8+time*.25))*.38;',
    '  float ridge=sin(q.x*3.+q.y*1.6+sin(q.y*2.4));',
    '  float ridge2=cos(q.y*3.4-q.x*1.3+cos(q.x*2.1));',
    '  float caustic=pow(max(0.,1.-abs(ridge+ridge2)*.7),13.);',
    '  vec3 normal=normalize(vec3(-gradient*.45,1.));',
    '  float spec=pow(max(0.,dot(normal,normalize(vec3(-.35,.4,1.)))),18.);',
    '  vec3 deep=mix(vec3(.40,.72,.85),vec3(.015,.08,.14),dark);',
    '  vec3 shallow=mix(vec3(.77,.94,.97),vec3(.035,.25,.31),dark);',
    '  vec3 color=mix(deep,shallow,.5+h*.35);',
    '  color+=vec3(.65,.94,1.)*(caustic*.28+spec*.17+rings*.09)*strength;',
    '  float calm=exp(-pow(abs(uv.x-.5)*2.2,4.));',
    '  vec3 paper=mix(vec3(.965,.98,.99),vec3(.038,.055,.075),dark);',
    '  color=mix(color,paper,calm*mix(.67,.43,dark));',
    '  gl_FragColor=vec4(color,1.);',
    '}'
  ].join('\n');

  function renderer() {
    if (unavailable) return null;
    if (gpu) return gpu.gl.isContextLost() ? null : gpu;
    if (!surface) {
      surface = document.createElement('canvas');
      surface.addEventListener('webglcontextlost', function (e) { e.preventDefault(); });
      surface.addEventListener('webglcontextrestored', function () { gpu = null; });
    }
    var gl;
    try { gl = surface.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' }); }
    catch (e) { unavailable = true; return null; }
    if (!gl) { unavailable = true; return null; }
    var program = gl.createProgram();
    var shaders = [];
    function compile(kind, source) {
      var shader = gl.createShader(kind);
      shaders.push(shader);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Water shader unavailable');
      gl.attachShader(program, shader);
    }
    try {
      compile(gl.VERTEX_SHADER, VERTEX); compile(gl.FRAGMENT_SHADER, FRAGMENT);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Water program unavailable');
    } catch (e) {
      shaders.forEach(function (s) { gl.deleteShader(s); });
      gl.deleteProgram(program); unavailable = true; return null;
    }
    shaders.forEach(function (s) { gl.deleteShader(s); });
    gl.useProgram(program);
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    var position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    var locations = {};
    ['resolution','time','dark','strength','drift','ripples[0]'].forEach(function (name) {
      locations[name] = gl.getUniformLocation(program, name);
    });
    gpu = { gl: gl, locations: locations };
    return gpu;
  }

  function create(ctx, w, h, density, dark) {
    var time = 0, drift = 0, targetDrift = 0, next = 0;
    var ripples = new Float32Array(32);
    var lastX = -1000, lastY = -1000, lastTime = -1;
    var scale = Math.min(1, 1100 / w, 800 / h);
    function disturb(x, y, force) {
      if (!isFinite(x) || !isFinite(y)) return;
      if (!force && (time - lastTime < .045 || Math.hypot(x-lastX, y-lastY) < 12)) return;
      lastX = x; lastY = y; lastTime = time;
      var i = (next++ % 8) * 4;
      ripples[i] = Math.max(0, Math.min(1, x / w));
      ripples[i+1] = 1 - Math.max(0, Math.min(1, y / h));
      ripples[i+2] = time; ripples[i+3] = force ? 1 : .65;
    }
    function fallback() {
      ctx.fillStyle = dark ? '#10242f' : '#e5f2f7'; ctx.fillRect(0,0,w,h);
      for (var j=0;j<12;j++) {
        ctx.beginPath();
        for(var x=-20;x<=w+20;x+=14) {
          var y=h*j/11 + drift*15 + Math.sin(x*.007+time*.35+j)*28 + Math.sin(x*.013-time*.22)*12;
          if(x===-20) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        }
        ctx.strokeStyle=dark ? 'rgba(80,210,235,.12)' : 'rgba(45,150,195,.13)';
        ctx.lineWidth=1+density; ctx.stroke();
      }
      for(var k=0;k<8;k++) {
        var at=k*4, age=time-ripples[at+2];
        if(!ripples[at+3] || age>4) continue;
        ctx.strokeStyle='rgba(70,180,215,'+Math.max(0,(1-age/4)*.3)+')';
        ctx.beginPath(); ctx.arc(ripples[at]*w,(1-ripples[at+1])*h,4+age*100,0,Math.PI*2); ctx.stroke();
      }
    }
    return {
      disturb: disturb,
      scroll: function (y) { targetDrift = y / Math.max(1,h); },
      frame: function (dt) {
        time += dt; drift += (targetDrift-drift)*Math.min(1,dt*5);
        var r=renderer();
        if (!r) { fallback(); return; }
        var sw=Math.max(1,Math.round(w*scale)), sh=Math.max(1,Math.round(h*scale));
        if(surface.width!==sw || surface.height!==sh) { surface.width=sw; surface.height=sh; }
        var gl=r.gl, u=r.locations;
        gl.viewport(0,0,sw,sh);
        gl.uniform2f(u.resolution,sw,sh); gl.uniform1f(u.time,time);
        gl.uniform1f(u.dark,dark?1:0); gl.uniform1f(u.strength,Math.max(.4,Math.min(2,density)));
        gl.uniform1f(u.drift,drift); gl.uniform4fv(u['ripples[0]'],ripples);
        gl.drawArrays(gl.TRIANGLES,0,6);
        ctx.clearRect(0,0,w,h); ctx.drawImage(surface,0,0,w,h);
      }
    };
  }
  global.ResumeWater = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
