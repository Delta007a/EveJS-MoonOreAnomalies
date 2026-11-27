"use strict";
// Launcher API 1: read-only preflight. Actual patches live only in process memory.
const fs=require('node:fs'),path=require('node:path');
function execute(request){
  if(!['prepare_server_start','verify'].includes(request.action))throw Error('Unsupported Moon helper action');
  let success=true,message='Moon source seams and ID namespaces ready.';
  try{
    const root=path.resolve(request.runtime.evejsRoot),mod=__dirname;
    if(request.runtime.backend!=='native')throw Error('Native runtime required');
    require('./lib/viability').run(root,{enabled:require('./config').load(mod).enabled,rules:require('./data/moonOreSiteRules.json')});
    const build = require('./lib/transientNames').getClientBuild(root);
    message += build === null
      ? ' Transient names unavailable for this client or server contract.'
      : ` Transient names are ready for client build ${build}.`;
  }catch(error){success=false;message=error.message;}
  return {protocol:request.protocol,requestId:request.requestId,success,state:success?'ready':'failed',message,restartRequired:[],contributions:[],environment:{},arguments:[]};
}
if(require.main===module){const arg=n=>process.argv[process.argv.indexOf(n)+1];fs.writeFileSync(arg('--result'),JSON.stringify(execute(JSON.parse(fs.readFileSync(arg('--request'),'utf8')))));}
module.exports={execute};
