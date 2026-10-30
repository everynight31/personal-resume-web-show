/* 宣纸与水墨：缓存纸纹和毛边墨迹，只动画位置、扩散半径与浓淡。 */
(function (global) {
  'use strict';
  function create(ctx, w, h, density, dark, rnd) {
    var time = 0, drift = 0, targetDrift = 0, drops = [];
    var lastTime = -1, lastX = -1000, lastY = -1000;
    var pigments = dark ? ['143,169,155','129,150,149','166,169,151'] : ['31,57,56','57,69,63','74,79,67'];
    var paper = document.createElement('canvas');
    paper.width = 240; paper.height = 240;
    var p = paper.getContext('2d');
    if (!p) return { frame:function(){ctx.fillStyle=dark?'#151d1c':'#f4f1e8';ctx.fillRect(0,0,w,h);} };
    p.fillStyle = dark ? '#151d1c' : '#f4f1e8'; p.fillRect(0,0,240,240);
    for (var grain=0;grain<3400;grain++) {
      p.fillStyle = dark ? 'rgba(197,203,176,.035)' : 'rgba(85,74,48,.045)';
      p.fillRect(rnd()*240,rnd()*240,rnd()>.8?1.8:.7,.6+rnd());
    }
    for (var fiber=0;fiber<140;fiber++) {
      var x=rnd()*240, y=rnd()*240;
      p.strokeStyle=dark?'rgba(198,204,177,.025)':'rgba(99,83,50,.035)';
      p.lineWidth=.45; p.beginPath();p.moveTo(x,y);p.lineTo(x+2+rnd()*9,y+(rnd()-.5)*4);p.stroke();
    }
    var pattern = ctx.createPattern(paper,'repeat');
    function stamp(color) {
      var image=document.createElement('canvas'); image.width=320;image.height=320;
      var brush=image.getContext('2d');
      if (!brush) return image;
      var phase=[rnd()*6.28,rnd()*6.28,rnd()*6.28];
      /* 外缘薄、内层浓，叠出毛细扩散留下的不规则墨晕。 */
      for(var layer=0;layer<24;layer++) {
        var radius=139-layer*2.6;
        brush.fillStyle='rgba('+color+','+(.012+layer*.00085)+')';
        brush.beginPath();
        for(var k=0;k<=112;k++) {
          var a=k/112*Math.PI*2;
          var rough=1+.07*Math.sin(a*3+phase[0])+.055*Math.sin(a*7+phase[1])+ .026*Math.sin(a*17+phase[2])+.012*Math.sin(a*37+layer*.16);
          var px=160+Math.cos(a)*radius*rough, py=160+Math.sin(a)*radius*rough;
          if(k===0) brush.moveTo(px,py);else brush.lineTo(px,py);
        }
        brush.closePath();brush.fill();
      }
      /* 零散纸纤维吸墨，避免边缘像规则的高斯光斑。 */
      for(var fleck=0;fleck<520;fleck++) {
        var angle=rnd()*Math.PI*2, r=100+rnd()*44;
        brush.fillStyle='rgba('+color+','+(.015+rnd()*.025)+')';
        brush.fillRect(160+Math.cos(angle)*r,160+Math.sin(angle)*r,.6+rnd()*1.4,.6+rnd()*1.4);
      }
      return image;
    }
    var stamps=pigments.map(stamp);
    var base=Math.min(w,h);
    var washes=[
      {x:-w*.02,y:h*.75,r:base*.68,phase:.7,alpha:.72,index:0},
      {x:w*1.02,y:h*.22,r:base*.60,phase:2.4,alpha:.55,index:1},
      {x:w*.12,y:h*.08,r:base*.28,phase:4.1,alpha:.22,index:2},
      {x:w*.84,y:h*.98,r:base*.36,phase:5.6,alpha:.3,index:0}
    ];
    function disturb(x,y,force) {
      if(!isFinite(x)||!isFinite(y))return;
      if(!force && (time-lastTime<.09 || Math.hypot(x-lastX,y-lastY)<24)) return;
      lastTime=time;lastX=x;lastY=y;
      drops.push({x:Math.max(0,Math.min(w,x)),y:Math.max(0,Math.min(h,y)),age:0,size:force?115:44,index:Math.floor(rnd()*3),force:force});
      if(drops.length>14)drops.shift();
    }
    return {
      disturb:disturb,
      scroll:function(y){targetDrift=y*.015;},
      frame:function(dt){
        time+=dt;drift+=(targetDrift-drift)*Math.min(1,dt*3);
        ctx.globalAlpha=1;ctx.fillStyle=pattern || (dark?'#151d1c':'#f4f1e8');ctx.fillRect(0,0,w,h);
        var strength=Math.max(.4,Math.min(2,density));
        washes.forEach(function(wash){
          var radius=wash.r*(1+Math.sin(time*.09+wash.phase)*.045);
          var x=wash.x+Math.sin(time*.07+wash.phase)*9;
          var y=wash.y+Math.cos(time*.08+wash.phase)*7-drift*.35;
          ctx.globalAlpha=Math.min(1,wash.alpha*strength);
          ctx.drawImage(stamps[wash.index],x-radius,y-radius,radius*2,radius*2);
        });
        for(var i=drops.length-1;i>=0;i--){
          var drop=drops[i];drop.age+=dt;
          if(drop.age>=12){drops.splice(i,1);continue;}
          var growth=1-Math.exp(-drop.age*.52);
          var r=8+growth*drop.size;
          var fade=Math.min(1,(12-drop.age)/3)*(1-Math.exp(-drop.age*4));
          ctx.globalAlpha=Math.min(.95,(drop.force?.9:.55)*strength)*fade;
          ctx.drawImage(stamps[drop.index],drop.x-r,drop.y-r,r*2,r*2);
        }
        ctx.globalAlpha=1;
      }
    };
  }
  global.ResumeInk={create:create};
})(typeof window!=='undefined'?window:globalThis);
