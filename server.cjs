// Local-only file server and Blender mesh conversion. No runtime packages.
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{spawn}=require('child_process');
const root=__dirname,port=Number(process.env.FLOW_LAB_PORT||8766),host='127.0.0.1';
function findBlender(){
 if(process.env.BLENDER_PATH&&fs.existsSync(process.env.BLENDER_PATH))return process.env.BLENDER_PATH;
 const base='C:\\Program Files\\Blender Foundation';
 if(fs.existsSync(base)){const dirs=fs.readdirSync(base).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));for(const d of dirs){const p=path.join(base,d,'blender.exe');if(fs.existsSync(p))return p;}}
 for(const p of ['/Applications/Blender.app/Contents/MacOS/Blender','/usr/bin/blender','/usr/local/bin/blender'])if(fs.existsSync(p))return p;
 return null;
}
const blender=findBlender();let busy=false;
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.md':'text/plain'};
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
 const origin=`http://${host}:${port}`;
 if(![`${host}:${port}`,`localhost:${port}`].includes(req.headers.host)){reply(res,403,{error:'Local access only.'});return;}
 if(req.headers.origin&&!['http://localhost:'+port,origin].includes(req.headers.origin)){reply(res,403,{error:'Origin rejected.'});return;}
 const url=new URL(req.url,origin);
 if(url.pathname==='/api/status'){reply(res,200,{blender:!!blender,version:blender?path.basename(path.dirname(blender)):null});return;}
 if(url.pathname==='/api/blend'&&req.method==='POST'){
   if(!blender){reply(res,503,{error:'Blender was not found. Install Blender or set BLENDER_PATH, then restart the launcher.'});return;}
   if(busy){reply(res,409,{error:'Another import is running. Wait for it to finish.'});return;}busy=true;
   let dir;
   try{
     let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>150*1024*1024)throw Error('File exceeds the 150 MB import limit.');chunks.push(chunk);}if(size<12)throw Error('The Blender file is empty or incomplete.');
     dir=fs.mkdtempSync(path.join(os.tmpdir(),'flow-lab-'));const input=path.join(dir,'input.blend'),output=path.join(dir,'mesh.json');fs.writeFileSync(input,Buffer.concat(chunks));
     await new Promise((resolve,reject)=>{
       const proc=spawn(blender,['--background','--factory-startup','--disable-autoexec',input,'--python-exit-code','1','--python',path.join(root,'convert.py'),'--',output],{windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';
       proc.stdout.on('data',d=>{log=(log+d).slice(-4000);});proc.stderr.on('data',d=>{log=(log+d).slice(-4000);});
       const timer=setTimeout(()=>{proc.kill();reject(Error('Blender conversion timed out after 90 seconds. Simplify the scene and retry.'));},90000);
       proc.on('error',e=>{clearTimeout(timer);reject(e);});proc.on('close',code=>{clearTimeout(timer);if(code===0&&fs.existsSync(output))resolve();else reject(Error(log.match(/FLOW_ERROR: (.*)/)?.[1]||'Blender could not evaluate this file. Check its version and mesh geometry.'));});
     });
     res.writeHead(200,{'Content-Type':'application/json'});res.end(fs.readFileSync(output));
   }catch(e){if(!res.headersSent)reply(res,400,{error:e.message});}finally{busy=false;if(dir&&path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('flow-lab-'))fs.rmSync(dir,{recursive:true,force:true});}
   return;
 }
 if(req.method!=='GET'){reply(res,405,{error:'Method not allowed.'});return;}
 const routes={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/solver.js':'solver.js','/style.css':'style.css'};const file=routes[url.pathname];if(!file){res.writeHead(404);res.end('Not found');return;}
 fs.readFile(path.join(root,file),(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(data);});
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Flow Lab is already running at http://127.0.0.1:'+port:e.message);process.exitCode=1;});
server.listen(port,host,()=>console.log(`Flow Lab: http://${host}:${port}\nBlender import: ${blender||'not found'}`));

