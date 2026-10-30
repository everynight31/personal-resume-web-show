/* 云海晨雾：缓存晨光、远山和云絮，以不同速度叠出远近层次。 */
(function(global){
  'use strict';
  function create(ctx,w,h,density,dark,rnd){
    var time=0,scroll=0,targetScroll=0;
    var pointer={x:w/2,y:h/2,age:10,force:0};
    var sky=document.createElement('canvas');
    sky.width=Math.max(1,Math.round(Math.min(w,1100)));
    sky.height=Math.max(1,Math.round(Math.min(h,800)));
    var paint=sky.getContext('2d');
    if(!paint)return {frame:function(){ctx.fillStyle=dark?'#172b3c':'#e5edf2';ctx.fillRect(0,0,w,h);}};
    var sw=sky.width,sh=sky.height;
    var gradient=paint.createLinearGradient(0,0,0,sh);
    gradient.addColorStop(0,dark?'#142437':'#cfdfec');
    gradient.addColorStop(.57,dark?'#233a4c':'#e8eef2');
    gradient.addColorStop(1,dark?'#344d5e':'#f6eee4');
    paint.fillStyle=gradient;paint.fillRect(0,0,sw,sh);
    var light=paint.createRadialGradient(sw*.78,sh*.19,0,sw*.78,sh*.19,Math.max(sw,sh)*.55);
    light.addColorStop(0,dark?'rgba(188,207,217,.10)':'rgba(255,241,214,.65)');
    light.addColorStop(1,'rgba(255,241,214,0)');
    paint.fillStyle=light;paint.fillRect(0,0,sw,sh);
    for(var ridge=0;ridge<3;ridge++){
      paint.fillStyle=dark?'rgba(15,34,48,'+(.10+ridge*.025)+')':'rgba(105,140,161,'+(.07+ridge*.025)+')';
      paint.beginPath();paint.moveTo(0,sh);
      for(var x=0;x<=sw+12;x+=12){
        var y=sh*(.58+ridge*.10)+Math.sin(x/sw*6.8+ridge*1.8)*sh*.032+Math.sin(x/sw*15+ridge)*sh*.014;
        paint.lineTo(x,y);
      }
      paint.lineTo(sw,sh);paint.closePath();paint.fill();
    }
    function puff(imageCtx,x,y,r,color,opacity){
      var g=imageCtx.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,'rgba('+color+','+opacity+')');
      g.addColorStop(.45,'rgba('+color+','+opacity*.65+')');
      g.addColorStop(1,'rgba('+color+',0)');
      imageCtx.fillStyle=g;imageCtx.fillRect(x-r,y-r,r*2,r*2);
    }
    var sprites=[];
    for(var texture=0;texture<3;texture++){
      var image=document.createElement('canvas');image.width=512;image.height=220;
      var brush=image.getContext('2d');
      if(brush){
        for(var k=0;k<13;k++){
          var cx=40+k*36+(rnd()-.5)*20,cy=85+rnd()*35,r=48+rnd()*37;
          puff(brush,cx,cy+24,r*1.1,dark?'57,85,107':'166,188,203',.12);
          puff(brush,cx,cy,r,dark?'172,196,208':'255,255,253',.33+rnd()*.16);
        }
        /* 云纹理四边归零，移动和叠加时不能露出缓存画布的矩形边缘。 */
        brush.globalCompositeOperation='destination-in';
        var edgeX=brush.createLinearGradient(0,0,512,0);
        edgeX.addColorStop(0,'rgba(255,255,255,0)');edgeX.addColorStop(.16,'white');
        edgeX.addColorStop(.84,'white');edgeX.addColorStop(1,'rgba(255,255,255,0)');
        brush.fillStyle=edgeX;brush.fillRect(0,0,512,220);
        var edgeY=brush.createLinearGradient(0,0,0,220);
        edgeY.addColorStop(0,'rgba(255,255,255,0)');edgeY.addColorStop(.18,'white');
        edgeY.addColorStop(.72,'white');edgeY.addColorStop(1,'rgba(255,255,255,0)');
        brush.fillStyle=edgeY;brush.fillRect(0,0,512,220);
        brush.globalCompositeOperation='source-over';
      }
      sprites.push(image);
    }
    var strength=Math.max(.4,Math.min(2,Number(density)||1));
    var perLayer=Math.max(3,Math.min(6,Math.round(4*strength)));
    var clouds=[];
    for(var layer=0;layer<3;layer++){
      for(var i=0;i<perLayer;i++){
        var size=Math.max(340,w*.48)*(1+layer*.22)*( .86+rnd()*.25);
        clouds.push({x:(i+rnd()*.35)/perLayer*(w+size*2),y:h*(.67+layer*.17)+(rnd()-.5)*h*.08,
          size:size,phase:rnd()*6.28,speed:5+layer*7,depth:(layer+1)/3,alpha:.34+layer*.20,index:i%3});
      }
    }
    function disturb(x,y,force){
      if(!isFinite(x)||!isFinite(y))return;
      pointer.x=Math.max(0,Math.min(w,x));pointer.y=Math.max(0,Math.min(h,y));
      pointer.age=0;pointer.force=force?1:.45;
    }
    return {
      disturb:disturb,
      scroll:function(y){if(isFinite(y))targetScroll=Math.max(0,Math.min(h*3,y))*.025;},
      frame:function(dt){
        time+=dt;pointer.age+=dt;scroll+=(targetScroll-scroll)*Math.min(1,dt*3);
        ctx.globalAlpha=1;ctx.drawImage(sky,0,0,w,h);
        var activity=Math.max(0,1-pointer.age/3)*pointer.force;
        clouds.forEach(function(cloud){
          var span=w+cloud.size*2;
          var x=(cloud.x+time*cloud.speed)%span-cloud.size;
          var height=cloud.size*220/512;
          var y=cloud.y-height/2+Math.sin(time*.13+cloud.phase)*10-scroll*cloud.depth;
          var dx=x+cloud.size/2-pointer.x,dy=y+height/2-pointer.y;
          var near=Math.exp(-(dx*dx+dy*dy)/(Math.max(160,w*.22)*Math.max(160,w*.22)));
          x+=(pointer.x-w/2)*.018*cloud.depth*activity+(dx<0?-1:1)*near*activity*24;
          y+=(pointer.y-h/2)*.012*cloud.depth*activity;
          ctx.globalAlpha=cloud.alpha*(1-near*activity*.3);
          ctx.drawImage(sprites[cloud.index],x,y,cloud.size,height);
        });
        ctx.globalAlpha=1;
      }
    };
  }
  global.ResumeClouds={create:create};
})(typeof window!=='undefined'?window:globalThis);
