"use strict";
// Launcher API 1: read-only preflight. Actual patches live only in process memory.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function execute(request){
  if(!['prepare_server_start','verify'].includes(request.action))throw Error('Unsupported Moon helper action');
  let success=true,message='Moon source seams and ID namespaces ready; transient names require client build 3396210.';
  try{
    const root=path.resolve(request.runtime.evejsRoot),mod=__dirname;
    if(request.runtime.backend!=='native')throw Error('Native runtime required');
    require('./lib/viability').run(root,{enabled:require('./config').load(mod).enabled,rules:require('./data/moonOreSiteRules.json')});
    const version=JSON.parse(fs.readFileSync(path.join(root,'server/package.json'),'utf8')).version;
    const handshake=fs.readFileSync(path.join(root,'server/src/network/tcp/handshake.js'),'utf8').replace(/\r\n/g,'\n');
    if(version==='261028.1'){if(crypto.createHash('sha256').update(handshake).digest('hex')!=='c84cffe20c00cf075a97daa31ca53c435af4f14c814e46d828760dbbb55fb566')throw Error('Unreviewed Moon login source/version');}else if(['0.12.8','0.12.9'].includes(version)){message='Legacy Moon gameplay ready; transient names unavailable on this release.';}else throw Error('Unreviewed Moon login source/version');
  }catch(error){success=false;message=error.message;}
  return {protocol:request.protocol,requestId:request.requestId,success,state:success?'ready':'failed',message,restartRequired:[],contributions:[],environment:{},arguments:[]};
}
if(require.main===module){const arg=n=>process.argv[process.argv.indexOf(n)+1];fs.writeFileSync(arg('--result'),JSON.stringify(execute(JSON.parse(fs.readFileSync(arg('--request'),'utf8')))));}
module.exports={execute};
