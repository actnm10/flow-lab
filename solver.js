'use strict';
// D3Q19, isothermal BGK. SI scaling preserves Reynolds number.
const C=[[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,0],[-1,-1,0],[1,-1,0],[-1,1,0],[1,0,1],[-1,0,-1],[1,0,-1],[-1,0,1],[0,1,1],[0,-1,-1],[0,1,-1],[0,-1,1]];
const W=C.map((_,q)=>q===0?1/3:q<7?1/18:1/36), OP=[0,2,1,4,3,6,5,8,7,10,9,12,11,14,13,16,15,18,17];
let nx=96,ny=48,nz=48,n,dx,f,g,mask,field,offsets,params,ul=.075,tau,dt,nu,time=0,stepCount=0,paused=false,scheduled=false,generation=0,solidCount=0,lastPerf=0,lastSteps=0,stepRate=0,playbackRate=1,wallTick=0,targetTime=0;
const eq=(q,r,u,v,w)=>{const cu=C[q][0]*u+C[q][1]*v+C[q][2]*w;return W[q]*r*(1+3*cu+4.5*cu*cu-1.5*(u*u+v*v+w*w));};
function voxelize(tri,parts){
  // Ray parity per connected source object; union objects, retain holes.
  for(const part of parts||[{start:0,count:tri.length/9}]){
    const bins=Array.from({length:ny*nz},()=>[]);
    for(let t=part.start*9;t<(part.start+part.count)*9;t+=9){
      const ax=tri[t],ay=tri[t+1],az=tri[t+2],bx=tri[t+3],by=tri[t+4],bz=tri[t+5],cx=tri[t+6],cy=tri[t+7],cz=tri[t+8];
      const det=(by-ay)*(cz-az)-(bz-az)*(cy-ay);if(Math.abs(det)<1e-10)continue;
      const y0=Math.max(1,Math.floor((Math.min(ay,by,cy)+4)/dx)),y1=Math.min(ny-2,Math.ceil((Math.max(ay,by,cy)+4)/dx));
      const z0=Math.max(1,Math.floor((Math.min(az,bz,cz)+4)/dx)),z1=Math.min(nz-2,Math.ceil((Math.max(az,bz,cz)+4)/dx));
      for(let z=z0;z<=z1;z++)for(let y=y0;y<=y1;y++){
        const yy=-4+(y+.5)*dx+1.234e-7,zz=-4+(z+.5)*dx+2.345e-7;
        const b=((yy-ay)*(cz-az)-(zz-az)*(cy-ay))/det,c=((by-ay)*(zz-az)-(bz-az)*(yy-ay))/det;
        if(b>=0&&c>=0&&b+c<=1)bins[y+ny*z].push(ax+b*(bx-ax)+c*(cx-ax));
      }
    }
    let odd=0;
    for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++){
      const hits=bins[y+ny*z].sort((a,b)=>a-b),xs=[];for(const h of hits)if(!xs.length||Math.abs(h-xs[xs.length-1])>1e-6)xs.push(h);
      if(xs.length%2)odd++;
      for(let j=0;j+1<xs.length;j+=2){const x0=Math.max(1,Math.ceil((xs[j]+6)/dx-.5)),x1=Math.min(nx-2,Math.floor((xs[j+1]+6)/dx-.5));for(let x=x0;x<=x1;x++)mask[x+nx*(y+ny*z)]=3;}
    }
    if(odd>3)postMessage({type:'warning',text:'Open or non-manifold mesh detected. Close holes in Blender for reliable solid boundaries.'});
  }
}
function init(p){
  generation++;params=p;nx=p.resolution;ny=nz=nx/2;n=nx*ny*nz;dx=16/nx;time=0;stepCount=0;lastSteps=0;lastPerf=performance.now();wallTick=performance.now();targetTime=0;playbackRate=p.rate||1;
  nu=Math.max(p.viscosity,.014*dx*p.speed/ul);tau=.5+3*nu*ul/(dx*p.speed);dt=ul*dx/p.speed;
  mask=new Uint8Array(n);f=new Float32Array(n*19);g=new Float32Array(n*19);field=new Float32Array(n*4);offsets=C.map(c=>c[0]+nx*c[1]+nx*ny*c[2]);
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    let i=x+nx*(y+ny*z);if(x===nx-1)mask[i]=2;if(x===0||y===0||z===0||y===ny-1||z===nz-1)mask[i]=1;
    if(p.sphere&&Math.hypot(-6+(x+.5)*dx,-4+(y+.5)*dx,-4+(z+.5)*dx)<p.size/2)mask[i]=3;
  }
  if(!p.sphere)voxelize(p.triangles,p.parts);
  solidCount=0;
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const i=x+nx*(y+ny*z);let u=ul,v=0,w=0;
    if(mask[i]===3){u=0;solidCount++;}
    else if(p.sphere&&mask[i]===0){
      // Creeping-flow solution is an initial guess only. Every subsequent field is solved.
      const px=-6+(x+.5)*dx,py=-4+(y+.5)*dx,pz=-4+(z+.5)*dx,r=Math.hypot(px,py,pz),a=p.size/2,s=a/r,s3=s*s*s;
      const A=1-.75*s-.25*s3,B=(-.75*s+.75*s3)*px/(r*r);
      u=ul*(A+B*px);v=ul*B*py;w=ul*B*pz;
    }
    for(let q=0;q<19;q++)f[q*n+i]=eq(q,1,u,v,w);
    field[4*i]=u/ul*p.speed;field[4*i+1]=v/ul*p.speed;field[4*i+2]=w/ul*p.speed;
  }
  g.set(f);
  if(solidCount===0)postMessage({type:'warning',text:'No closed solid cells were resolved. Increase object size or use a closed, watertight mesh.'});
  postMessage({type:'ready',nx,ny,nz,dx,mask,nu,tau,dt,re:p.speed*p.size/nu,solidCount,generation});publish();schedule();
}
const vals=new Float64Array(19);
function step(){
let maxU=0,minR=2,maxR=0,bad=false;
const omega=1/tau;
const n1=1*n,o1=1+nx*0+nx*ny*0;
const n2=2*n,o2=-1+nx*0+nx*ny*0;
const n3=3*n,o3=0+nx*1+nx*ny*0;
const n4=4*n,o4=0+nx*-1+nx*ny*0;
const n5=5*n,o5=0+nx*0+nx*ny*1;
const n6=6*n,o6=0+nx*0+nx*ny*-1;
const n7=7*n,o7=1+nx*1+nx*ny*0;
const n8=8*n,o8=-1+nx*-1+nx*ny*0;
const n9=9*n,o9=1+nx*-1+nx*ny*0;
const n10=10*n,o10=-1+nx*1+nx*ny*0;
const n11=11*n,o11=1+nx*0+nx*ny*1;
const n12=12*n,o12=-1+nx*0+nx*ny*-1;
const n13=13*n,o13=1+nx*0+nx*ny*-1;
const n14=14*n,o14=-1+nx*0+nx*ny*1;
const n15=15*n,o15=0+nx*1+nx*ny*1;
const n16=16*n,o16=0+nx*-1+nx*ny*-1;
const n17=17*n,o17=0+nx*1+nx*ny*-1;
const n18=18*n,o18=0+nx*-1+nx*ny*1;
for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++)for(let x=1;x<nx-1;x++){
const i=x+nx*(y+ny*z);if(mask[i]===3)continue;
const a0=f[i];
const a1=mask[i-o1]===3?f[n2+i]:f[n1+i-o1];
const a2=mask[i-o2]===3?f[n1+i]:f[n2+i-o2];
const a3=mask[i-o3]===3?f[n4+i]:f[n3+i-o3];
const a4=mask[i-o4]===3?f[n3+i]:f[n4+i-o4];
const a5=mask[i-o5]===3?f[n6+i]:f[n5+i-o5];
const a6=mask[i-o6]===3?f[n5+i]:f[n6+i-o6];
const a7=mask[i-o7]===3?f[n8+i]:f[n7+i-o7];
const a8=mask[i-o8]===3?f[n7+i]:f[n8+i-o8];
const a9=mask[i-o9]===3?f[n10+i]:f[n9+i-o9];
const a10=mask[i-o10]===3?f[n9+i]:f[n10+i-o10];
const a11=mask[i-o11]===3?f[n12+i]:f[n11+i-o11];
const a12=mask[i-o12]===3?f[n11+i]:f[n12+i-o12];
const a13=mask[i-o13]===3?f[n14+i]:f[n13+i-o13];
const a14=mask[i-o14]===3?f[n13+i]:f[n14+i-o14];
const a15=mask[i-o15]===3?f[n16+i]:f[n15+i-o15];
const a16=mask[i-o16]===3?f[n15+i]:f[n16+i-o16];
const a17=mask[i-o17]===3?f[n18+i]:f[n17+i-o17];
const a18=mask[i-o18]===3?f[n17+i]:f[n18+i-o18];
const rho=a0+a1+a2+a3+a4+a5+a6+a7+a8+a9+a10+a11+a12+a13+a14+a15+a16+a17+a18;
const u=(0 + a1 - a2 + a7 - a8 + a9 - a10 + a11 - a12 + a13 - a14)/rho;
const v=(0 + a3 - a4 + a7 - a8 - a9 + a10 + a15 - a16 + a17 - a18)/rho;
const w=(0 + a5 - a6 + a11 - a12 - a13 + a14 + a15 - a16 - a17 + a18)/rho;
const us=u*u+v*v+w*w,base=1-1.5*us;
const sponge=x>nx-10?.09*((x-nx+10)/9)**2:0;
{const cu=0,feq=0.3333333333333333*rho*(base+3*cu+4.5*cu*cu);let val=a0+omega*(feq-a0);if(sponge)val=val*(1-sponge)+sponge*eq(0,1,ul,0,0);g[i]=val;}
{const cu=0 + u,feq=0.05555555555555555*rho*(base+3*cu+4.5*cu*cu);let val=a1+omega*(feq-a1);if(sponge)val=val*(1-sponge)+sponge*eq(1,1,ul,0,0);g[n1+i]=val;}
{const cu=0 - u,feq=0.05555555555555555*rho*(base+3*cu+4.5*cu*cu);let val=a2+omega*(feq-a2);if(sponge)val=val*(1-sponge)+sponge*eq(2,1,ul,0,0);g[n2+i]=val;}
{const cu=0 + v,feq=0.05555555555555555*rho*(base+3*cu+4.5*cu*cu);let val=a3+omega*(feq-a3);if(sponge)val=val*(1-sponge)+sponge*eq(3,1,ul,0,0);g[n3+i]=val;}
{const cu=0 - v,feq=0.05555555555555555*rho*(base+3*cu+4.5*cu*cu);let val=a4+omega*(feq-a4);if(sponge)val=val*(1-sponge)+sponge*eq(4,1,ul,0,0);g[n4+i]=val;}
{const cu=0 + w,feq=0.05555555555555555*rho*(base+3*cu+4.5*cu*cu);let val=a5+omega*(feq-a5);if(sponge)val=val*(1-sponge)+sponge*eq(5,1,ul,0,0);g[n5+i]=val;}
{const cu=0 - w,feq=0.05555555555555555*rho*(base+3*cu+4.5*cu*cu);let val=a6+omega*(feq-a6);if(sponge)val=val*(1-sponge)+sponge*eq(6,1,ul,0,0);g[n6+i]=val;}
{const cu=0 + u + v,feq=0.027777777777777776*rho*(base+3*cu+4.5*cu*cu);let val=a7+omega*(feq-a7);if(sponge)val=val*(1-sponge)+sponge*eq(7,1,ul,0,0);g[n7+i]=val;}
{const cu=0 - u - v,feq=0.027777777777777776*rho*(base+3*cu+4.5*cu*cu);let val=a8+omega*(feq-a8);if(sponge)val=val*(1-sponge)+sponge*eq(8,1,ul,0,0);g[n8+i]=val;}
{const cu=0 + u - v,feq=0.027777777777777776*rho*(base+3*cu+4.5*cu*cu);let val=a9+omega*(feq-a9);if(sponge)val=val*(1-sponge)+sponge*eq(9,1,ul,0,0);g[n9+i]=val;}
{const cu=0 - u + v,feq=0.027777777777777776*rho*(base+3*cu+4.5*cu*cu);let val=a10+omega*(feq-a10);if(sponge)val=val*(1-sponge)+sponge*eq(10,1,ul,0,0);g[n10+i]=val;}
{const cu=0 + u + w,feq=0.027777777777777776*rho*(base+3*cu+4.5*cu*cu);let val=a11+omega*(feq-a11);if(sponge)val=val*(1-sponge)+sponge*eq(11,1,ul,0,0);g[n11+i]=val;}
{const cu=0 - u - w,feq=0.027777777777777776*rho*(base+3*cu+4.5*cu*cu);let val=a12+omega*(feq-a12);if(sponge)val=val*(1-sponge)+sponge*eq(12,1,ul,0,0);g[n12+i]=val;}
{const cu=0 + u - w,feq=0.027777777777777776*rho*(base+3*cu+4.5*cu*cu);let val=a13+omega*(feq-a13);if(sponge)val=val*(1-sponge)+sponge*eq(13,1,ul,0,0);g[n13+i]=val;}
{const cu=0 - u + w,feq=0.027777777777777776*rho*(base+3*cu+4.5*cu*cu);let val=a14+omega*(feq-a14);if(sponge)val=val*(1-sponge)+sponge*eq(14,1,ul,0,0);g[n14+i]=val;}
{const cu=0 + v + w,feq=0.027777777777777776*rho*(base+3*cu+4.5*cu*cu);let val=a15+omega*(feq-a15);if(sponge)val=val*(1-sponge)+sponge*eq(15,1,ul,0,0);g[n15+i]=val;}
{const cu=0 - v - w,feq=0.027777777777777776*rho*(base+3*cu+4.5*cu*cu);let val=a16+omega*(feq-a16);if(sponge)val=val*(1-sponge)+sponge*eq(16,1,ul,0,0);g[n16+i]=val;}
{const cu=0 + v - w,feq=0.027777777777777776*rho*(base+3*cu+4.5*cu*cu);let val=a17+omega*(feq-a17);if(sponge)val=val*(1-sponge)+sponge*eq(17,1,ul,0,0);g[n17+i]=val;}
{const cu=0 - v + w,feq=0.027777777777777776*rho*(base+3*cu+4.5*cu*cu);let val=a18+omega*(feq-a18);if(sponge)val=val*(1-sponge)+sponge*eq(18,1,ul,0,0);g[n18+i]=val;}
field[4*i]=u/ul*params.speed;field[4*i+1]=v/ul*params.speed;field[4*i+2]=w/ul*params.speed;field[4*i+3]=(rho-1)*2/(3*ul*ul);
maxU=Math.max(maxU,us);minR=Math.min(minR,rho);maxR=Math.max(maxR,rho);if(!Number.isFinite(rho)||rho<.7||rho>1.3||us>.15)bad=true;
}
for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++){const i=nx-1+nx*(y+ny*z);for(let q=0;q<19;q++)g[q*n+i]=f[q*n+i-1];}
[f,g]=[g,f];time+=dt;stepCount++;
if(bad){paused=true;postMessage({type:'unstable',text:'Solver paused: stability limit reached. Increase viscosity or resolution, then restart.'});}
self.diagnostics={maxMach:Math.sqrt(maxU)*Math.sqrt(3),densityVariation:maxR-minR};
}
function publish(reason='update'){
  const now=performance.now();if(now-lastPerf>1000){stepRate=(stepCount-lastSteps)*1000/(now-lastPerf);lastPerf=now;lastSteps=stepCount;}
  const copy=new Float32Array(field);postMessage({type:'field',reason,field:copy,time,steps:stepCount,rate:stepRate,generation,diagnostics:self.diagnostics||{}},[copy.buffer]);
}
function schedule(){if(scheduled||paused)return;scheduled=true;setTimeout(run,0);}
function run(){scheduled=false;if(paused||!f)return;const now=performance.now();targetTime+=Math.min(.15,(now-wallTick)/1000)*playbackRate;wallTick=now;targetTime=Math.min(targetTime,time+dt*6);let count=0;for(let i=0;i<3&&!paused&&time+dt<=targetTime;i++){step();count++;}if(count)publish();if(!paused){scheduled=true;setTimeout(run,count?0:4);}}
self.onmessage=e=>{const m=e.data;if(m.type==='init'){paused=!!m.paused;init(m.params);}else if(m.type==='pause'){paused=m.value;if(paused){publish('pause');postMessage({type:'paused'});}else{wallTick=performance.now();targetTime=time;schedule();}}else if(m.type==='step'&&paused){step();publish('step');}else if(m.type==='rate'){playbackRate=m.value;wallTick=performance.now();targetTime=time;}else if(m.type==='snapshot'){publish();}};
