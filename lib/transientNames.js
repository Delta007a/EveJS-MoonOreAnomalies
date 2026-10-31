"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const HASH='c84cffe20c00cf075a97daa31ca53c435af4f14c814e46d828760dbbb55fb566';
const hash=s=>crypto.createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
const KEY=Symbol.for('evejs.moonOreAnomalies.transientNames');
function install(root,modRoot) {
  if(globalThis[KEY])return globalThis[KEY];
  // Must be the innermost compile wrapper. Launcher loadBefore enforces this.
  if(globalThis[Symbol.for('evejs.ourMods.privateFittingRuntime')])return {active:false,reason:'Moon must preload before DCB/Solo'};
  const handshake=path.resolve(root,'server/src/network/tcp/handshake.js');
  const baseline=fs.readFileSync(handshake,'utf8');
  if(require(path.join(root,'server/package.json')).version!=='261028.1'||hash(baseline)!==HASH)return {active:false,reason:'unknown-handshake'};
  const snapshots=require('../data/moonOreTemplates.v1.json').templatesByFamily;
  // Client-only presentation: never rename persistent templates/content hashes.
  const displayNames=JSON.parse(fs.readFileSync(path.join(modRoot,'client/names.json'),'utf8'));
  if(Object.keys(displayNames).length!==Object.keys(snapshots).length||Object.keys(displayNames).some(f=>!Object.hasOwn(snapshots,f)))throw Error('MOON_NAMES_FAMILY_MISMATCH');
  const rows=Object.entries(snapshots).map(([family,row],i)=>{
    const displayName=displayNames[family];
    if(typeof displayName!=='string'||!displayName.trim()||displayName.length>128)throw Error('MOON_NAMES_LABEL_INVALID');
    return {family,...row,displayName,token:-591001-i};
  });
  const names=Object.fromEntries(rows.map(r=>[r.token,r.displayName]));
  const body=fs.readFileSync(path.join(modRoot,'client/names.py'),'utf8')+'\nstart('+JSON.stringify(names).replace(/"(-\d+)":/g,'$1:')+', _moon_context)\n';
  // An exec inside a lambda otherwise writes definitions into lambda locals,
  // while deferred methods resolve NamePatch/hashlib in their globals.
  const program='try:\n'+body.split('\n').map(line=>' '+line).join('\n')+'\nexcept Exception as error:\n print("MOON_NAMES:DELIVERY_FAILED:%s" % type(error).__name__)\n';
  const encoded=Buffer.from(program,'utf8').toString('base64');
  const append=`\nconst __moonPreviousLogin = buildTidiSignedFunc;
buildTidiSignedFunc = function() {
 const original=__moonPreviousLogin.apply(this,arguments);
 try {
  if(!Buffer.isBuffer(original)||original.length<5||original[0]!==0x74||original.readUInt32LE(1)!==original.length-5)return original;
  const expr="(lambda r: (eval(compile(__import__('base64').b64decode('${encoded}'), '<moon-transient-names>', 'exec'), {'__builtins__': __builtins__, '_moon_context': globals()}), r)[1])("+original.subarray(5).toString('ascii')+")";
  const data=Buffer.from(expr,'ascii');if(data.length>256*1024)return original;
  const head=Buffer.alloc(5);head[0]=0x74;head.writeUInt32LE(data.length,1);console.log('[moonOreAnomalies/names] LOGIN_PAYLOAD_READY bytes='+data.length);return Buffer.concat([head,data]);
 } catch (_) {return original;}
};\n`;
  const signature=path.resolve(root,'server/src/services/exploration/signatures/signatureRuntime.js');
  const previous=Module.prototype._compile;
  const announced=new Set();
  const state={active:true,rows,wire(site,field,fallback){
    const row=rows.find(r=>r.templateID===site?.templateID&&(!site.family||site.family===r.family));
    if(row&&!announced.has(row.family)){announced.add(row.family);console.log('[moonOreAnomalies/names] ANOMALY_WIRE_READY family='+row.family+' token='+row.token);}
    return row?(field==='dungeonID'?row.token:row.historicalDungeonNameID):fallback;
  },restore(){if(Module.prototype._compile===hook)Module.prototype._compile=previous;if(globalThis[KEY]===state)delete globalThis[KEY];}};
  function hook(content,filename){
    if(path.resolve(filename)===handshake){
      // Retain the full DCB/Solo tail. Only reviewed baseline plus that exact
      // known private-runtime tail is permitted; arbitrary edits fail vanilla.
      const tail=content.slice(baseline.length);
      const deliveryPath=path.join(root,'mods/soloProgressionBalance/simulation/delivery.js');
      const dcbPath=path.join(root,'mods/droneClassBalance/simulation/delivery.js');
      let allowed=tail.length===0;
      for(const candidate of [deliveryPath,dcbPath])if(fs.existsSync(candidate)){
        try {const transformed=require(candidate).extendSource(baseline);if(transformed===content)allowed=true;} catch (_) { /* optional delivery stays native */ }
      }
      if(content.startsWith(baseline)&&allowed){content+=append;console.log('[moonOreAnomalies/names] LOGIN_WRAPPER_READY');}
      else console.warn('[moonOreAnomalies/names] LOGIN_WRAPPER_UNAVAILABLE: conflicting source');
    }
    if(path.resolve(filename)===signature){
      const start=content.indexOf('function buildAnomalySiteInfo('),end=content.indexOf('\nfunction ',start+1);
      if(start<0||end<0)throw Error('MOON_NAMES_WIRE_SEAM_CHANGED');
      let part=content.slice(start,end);
      for(const [field,value] of [['dungeonID','site && site.dungeonID == null ? 0 : site.dungeonID'],['dungeonNameID','site && site.dungeonNameID == null ? null : site.dungeonNameID']]){
        const anchor='["'+field+'", '+value+']';
        if(part.split(anchor).length!==2)throw Error('MOON_NAMES_WIRE_SEAM_CHANGED');
        part=part.replace(anchor,'["'+field+'", globalThis[Symbol.for("evejs.moonOreAnomalies.transientNames")]?.wire(site,"'+field+'", '+value+') ?? ('+value+')]');
      }
      content=content.slice(0,start)+part+content.slice(end);
    }
    return previous.call(this,content,filename);
  }
  Module.prototype._compile=hook;globalThis[KEY]=state;return state;
}
module.exports={install};
