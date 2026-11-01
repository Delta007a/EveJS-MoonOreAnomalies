"use strict";
// Narrow integration: production mining persistence -> native scene completion
// -> production durable scheduler -> native universe rotation. Storage and grid
// occupancy are memory fixtures. No gameStore/service/client is opened.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const vm=require('node:vm'),Module=require('node:module');
const modDir=path.resolve(__dirname,'..');
const runtimeRoot=path.resolve(process.argv[2]);
const transforms=require('../lib/sourceTransforms');
const rules=require('../data/moonOreSiteRules.json'),snapshots=require('../data/moonOreTemplates.v1.json');
const apiModule=require('../lib/runtimeApi'),content=require('../lib/contentOverlay');
const templateIDs=Object.fromEntries(Object.entries(snapshots.templatesByFamily).map(([k,v])=>[k,v.templateID]));
let api=apiModule.createRuntimeApi({enabled:true,rules,version:'0.5.4',templateIDs});
const source=fs.readFileSync(path.join(runtimeRoot,transforms.SITE_SERVICE_TARGET),'utf8');
const fixed=transforms.transformSiteService(source);
const fn=(s,n)=>{const a=s.indexOf('function '+n+'(');assert(a>=0,n);const b=s.indexOf('\n}',a);assert(b>a);return s.slice(a,b+2);};
const clone=x=>JSON.parse(JSON.stringify(x));
const effectivePayload={templatesByID:{},spawnProfiles:{families:{}}};
for(const family of Object.keys(rules.families)) {
 effectivePayload.templatesByID[templateIDs[family]]=content.buildTemplate(family,rules.families[family],snapshots.templatesByFamily[family],snapshots.common,'0.5.4','0.2.0');
 effectivePayload.spawnProfiles.families[family]=content.buildProfile(family,rules.families[family],'0.5.4');
}
let parked=false;
const referenceTests=fs.readFileSync(path.join(__dirname,'run.js'),'utf8');
const harnessContext=vm.createContext({require,fs,path,vm,Module,assert,runtimeRoot,effectivePayload,rules,transforms,
 isParked:()=>parked,console});
const harnessNames=['clone','loadSourceModule','compileSourceModule','authorityFacade','createUniverseHarness','createRepository','createUpstreamRuntimeHarness'];
let harnessSource=harnessNames.map(n=>fn(referenceTests,n)).join('\n');
harnessSource=harnessSource.replace('"/dungeon/dungeonRuntimeState": {},','"/dungeon/dungeonRuntimeState": {}, "/dungeon/dungeonUniverseSiteService": {isUniverseSiteTeardownParked:()=>isParked()},');
harnessSource=harnessSource.replace('const mocks = {','const mocks = { "/homefrontPopulationPolicy": require(path.join(runtimeRoot,"server/src/services/dungeon/homefrontPopulationPolicy.js")),');
harnessSource+='\nconst baseFacade=authorityFacade; authorityFacade=(...args)=>{const a=baseFacade(...args);return {...a,getSpawnProfileReadOnly:a.getSpawnProfile,getTemplateByIDReadOnly:a.getTemplateByID,listTemplatesByFamilyReadOnly:a.listTemplatesByFamily};};';
harnessSource=harnessSource.replace('function createUpstreamRuntimeHarness()', 'function createUpstreamRuntimeHarness(initial = null)')
 .replace('const repo = createRepository({ version:', 'const repo = createRepository(initial || { version:');
vm.runInContext(harnessSource,harnessContext);
const harness=vm.runInContext('({createUpstreamRuntimeHarness,createUniverseHarness,loadSourceModule})',harnessContext);
const primitive={toInt:(v,f=0)=>Number.isFinite(Number(v))?Math.trunc(Number(v)):f,
 toFiniteNumber:(v,f=0)=>Number.isFinite(Number(v))?Number(v):f,
 normalizeLowerText:(v,f='')=>String(v??f).trim().toLowerCase()||f,
 normalizeObject:v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{},
 SITE_CONTENT_MAX_MINING_ROCK_COUNT:64,SITE_CONTENT_MAX_EXACT_MINING_ROCK_COUNT:512,
 SITE_CONTENT_MINING_ROCK_ID_BASE:6600000000000,SITE_CONTENT_ID_FOLD_MODULUS:1000000000,
 CLEARED_ANOMALY_ROTATION_DELAY_MS:0,MINED_OUT_SITE_FAMILIES:new Set(['ore','gas']),path,__dirname:path.join(runtimeRoot,'server/src/services/dungeon')};
const rockFns=['buildSiteContentItemID','resolveMiningRockLimit','apportionMiningRockCounts','resolveMiningRockCounts',
 'listMiningObjectiveRockDescriptors','readRecordedMiningRockRemainders','readRecordedMiningRockRemainder'];
const checks=[];
const previous=globalThis[Symbol.for(apiModule.API_SYMBOL)];
globalThis[Symbol.for(apiModule.API_SYMBOL)]=api;
async function run() {
 try {
  for(const delayMinutes of [0,15]) for(const family of Object.keys(rules.families)) {
   api=apiModule.createRuntimeApi({enabled:true,rules,version:'0.5.4',templateIDs,settings:{respawnDelayMinutes:delayMinutes}});
   globalThis[Symbol.for(apiModule.API_SYMBOL)]=api;
   let upstream=harness.createUpstreamRuntimeHarness();
   let integrated=harness.createUniverseHarness(upstream.runtime);
   let systemID;
   for(let id=30010000;id<30020000;id++)if(api.slotSpawnsInSystem(id,family,'nullsec')){systemID=id;break;}
   integrated.systemRecords.set(systemID,{solarSystemID:systemID,securityStatus:-0.5,regionID:10000002});
   const definition=integrated.universe.listDesiredUniverseDungeonSiteDefinitions([systemID],1000,{families:[family]}).definitions[0];
   assert(definition);
   upstream.runtime.reconcileUniverseSeededInstances([definition],{systemIDs:[systemID],siteFamilyFilter:[family],siteOriginFilter:['universe_dungeon'],nowMs:1000});
   let instance=upstream.runtime.listInstancesByFamily(family,{full:true})[0];
   assert(api.isOwnedMinedOutSite(instance));
   const firstID=instance.instanceID;
   const hints=effectivePayload.templatesByID[instance.templateID].populationHints;
   let notices=0;
   const mining=new Map();
   const sceneContext=vm.createContext({...primitive,
    dungeonRuntime:upstream.runtime,
    dungeonTrackingRuntime:{notifyDungeonCompletedForScene:()=>{notices++;}},
    require:name=>{assert(name.endsWith('miningRuntimeState'));return {getMineableState:(_scene,id)=>mining.get(id)||null};},
   });
   sceneContext[Symbol.for(apiModule.API_SYMBOL)]=api;
   vm.runInContext(rockFns.map(n=>fn(source,n)).join('\n'),sceneContext);
   const completeOld=vm.runInContext(fn(source,'maybeCompleteMinedOutSite')+'\nmaybeCompleteMinedOutSite',sceneContext);
   const completeFixed=vm.runInContext(fn(fixed,'maybeCompleteMinedOutSite')+'\nmaybeCompleteMinedOutSite',sceneContext);
   const descriptors=vm.runInContext('listMiningObjectiveRockDescriptors',sceneContext)(instance,hints);
   assert.equal(descriptors.length,16);
   const scene={};
   assert.equal(completeFixed(scene,instance,hints,{nowMs:2000}),false,'unknown remainders must not complete');
   for(const rock of descriptors)mining.set(rock.entityID,{remainingQuantity:0});
   mining.set(descriptors.at(-1).entityID,{remainingQuantity:1});
   assert.equal(completeFixed(scene,instance,hints,{nowMs:2000}),false,'one remaining unit must prevent completion');
   mining.set(descriptors.at(-1).entityID,{remainingQuantity:0});
   assert.equal(completeOld(scene,instance,hints,{nowMs:2000}),false,'published bug must reproduce');
   assert.equal(upstream.runtime.getInstance(firstID).lifecycleState,'active');
   // Record all zero remainders through the actual mining persistence function.
   const miningSource=fs.readFileSync(path.join(runtimeRoot,'server/src/services/mining/miningRuntimeState.js'),'utf8');
   const recordContext=vm.createContext({...primitive,getDungeonRuntimeModule:()=>upstream.runtime,
    isGeneratedIceMineableEntity:()=>false,log:{debug(){}}});
   const record=vm.runInContext(fn(miningSource,'recordDungeonRockRemainder')+'\nrecordDungeonRockRemainder',recordContext);
   for(const rock of descriptors)assert(record({itemID:rock.entityID,dungeonSiteInstanceID:firstID,dungeonMaterializedMiningRock:true},{remainingQuantity:0},{nowMs:2000}));
   mining.clear(); // Depleted rocks have left the scene; use persisted zeroes.
   instance=upstream.runtime.getInstance(firstID);
   for(const changed of [
    {...instance,templateID:'foreign:moon'}, {...instance,siteOrigin:'mission'},
    {...instance,siteFamily:'homefront_mining'}, {...instance,runtimeFlags:{}},
    {...instance,lifecycleState:'completed'},
   ])assert.equal(completeFixed(scene,changed,hints,{nowMs:2000}),false);
   assert.equal(completeFixed(scene,instance,{miningRocks:[]},{nowMs:2000}),false);
   // Actual scene tick invokes the owned handler before encounter processing.
   Object.assign(sceneContext,{
    ensureSceneMaterializedSiteSet:()=>new Set([definition.metadata.siteID]),
    resolveManagedUniverseSiteInstance:()=>upstream.runtime.getInstance(firstID),isManagedMaterializedSiteInstance:()=>true,
    resolvePopulationHints:()=>hints,dungeonAuthority:{getTemplateByID:()=>({populationHints:hints})},
    drainPendingSiteTeardowns:()=>{},processToxicCloudHazards:()=>{},retryInstanceHackingOutcomes:()=>true,
    log:{warn(){}},require:name=>{
     if(name.endsWith('miningRuntimeState'))return {getMineableState:()=>null};
     if(name.endsWith('siteHazardOutcomes'))return {recoverForScene(){},replayPendingSiteHazardDamage:()=>({success:true})};
     if(name.endsWith('eventHooks'))return {fabricator:{refreshDepartedBonuses(){},isFabricator:()=>false},fw:{isSite:()=>false},depot:{isDepot:()=>false}};
     throw Error('Blocked lazy import '+name);
    },
   });
   vm.runInContext(fn(fixed,'maybeCompleteMinedOutSite'),sceneContext);
   const tick=vm.runInContext(fn(source,'tickSceneSiteBehaviors')+'\ntickSceneSiteBehaviors',sceneContext);
   parked=true;
   tick(scene,{nowMs:2000});
   const completed=upstream.runtime.getInstance(firstID);
   assert.equal(completed.lifecycleState,'completed');assert.equal(completed.lifecycleReason,'depleted');assert.equal(notices,1);
   const deadline=2000+delayMinutes*60000;
   assert.equal(completed.timers.expiresAtMs,deadline);
   assert.equal(integrated.universe.getUniversePersistentLifecycleBoundary(2000,{systemIDs:[systemID]}),null,'occupied grid must hold rotation');
   assert.equal(integrated.universe.advanceUniversePersistentSites({nowMs:2000,systemIDs:[systemID],refreshLoadedScenes:false}).rotatedCount,0);
   parked=false;
   if(delayMinutes>0) {
    assert.equal(integrated.universe.advanceUniversePersistentSites({nowMs:deadline-1,systemIDs:[systemID],refreshLoadedScenes:false}).rotatedCount,0);
    // Simulate a fresh server process loading the persisted instance snapshot.
    upstream=harness.createUpstreamRuntimeHarness(upstream.repo.snapshot());
    integrated=harness.createUniverseHarness(upstream.runtime);
    integrated.systemRecords.set(systemID,{solarSystemID:systemID,securityStatus:-0.5,regionID:10000002});
    assert.equal(upstream.runtime.getInstance(firstID).timers.expiresAtMs,deadline);
    assert.equal(integrated.universe.getUniversePersistentLifecycleBoundary(3000,{systemIDs:[systemID]}).boundaryAtMs,deadline);
   }
   const schedulerModule=harness.loadSourceModule(path.join(runtimeRoot,'server/src/services/dungeon/globalSiteSchedulerRuntime.js'),{
    '/gameStore':{},'/utils/logger':{},'/dungeon/dungeonRuntime':{},'/dungeon/dungeonRuntimeState':{},
    '/dungeon/dungeonUniverseRuntime':{},'/mining/miningRuntimeState':{},'/scheduler/scheduledJobStates':{isDeadLetteredJob:()=>false},
   });
   const jobs=new Map();
   const scheduler={schedule:async job=>{jobs.set(job.jobID,job);},cancel:async id=>{jobs.delete(id);},list:async()=>[...jobs.values()]};
   const owner=schedulerModule.createGlobalSiteSchedulerRuntime({database:{flushTableAsync(){}},log:{warn(){}},
    dungeonRuntime:upstream.runtime,dungeonRuntimeState:{DUNGEON_RUNTIME_TABLE:'dungeonRuntime'},
    dungeonUniverseRuntime:integrated.universe,miningRuntimeState:{MINING_RUNTIME_TABLE:'miningRuntime'}});
   owner.bindDurableScheduler(scheduler);
   await owner.reconcileDurableGlobalSites({nowMs:2000});
   const due=[...jobs.values()].find(j=>j.payload.instanceID===firstID);
   assert(due,'completed Moon must schedule a rotation');
   assert.equal(due.payload.boundaryAtMs,deadline);
   if(delayMinutes>0)await assert.rejects(()=>owner.handleDurableGlobalSiteLifecycle(due,{nowMs:deadline-1}),/before its boundary/);
   const result=await owner.handleDurableGlobalSiteLifecycle(due,{nowMs:deadline+100});
   assert.equal(result.rotated,1);
   const active=upstream.runtime.listInstancesByFamily(family,{full:true});
   assert.equal(active.length,1);assert(active[0].instanceID>firstID);assert.equal(active[0].lifecycleState,'active');
   assert.equal(Object.keys(active[0].spawnState.miningRockRemainingByID||{}).length,0);
   const afterID=active[0].instanceID;
   await owner.handleDurableGlobalSiteLifecycle(due,{nowMs:deadline+200});
   assert.equal(upstream.runtime.listInstancesByFamily(family,{full:true})[0].instanceID,afterID);
   owner.unbindDurableScheduler(scheduler);
   checks.push({family,delayMinutes,rocks:descriptors.length,publishedBugReproduced:true,completed:true,durableRotation:true,newInstanceID:afterID,partialAndForeignProtected:true,occupiedGridHeld:true,restartPreservesDeadline:delayMinutes>0});
   console.log('PASS '+family+' delay='+delayMinutes+': depletion -> completed -> occupied-grid hold -> durable scheduler -> new active instance');
  }
  api=apiModule.createRuntimeApi({enabled:true,rules,version:'0.5.4',templateIDs,
   settings:{spawnChanceMultiplier:0.5,maxSitesPerSystem:2,respawnDelayMinutes:15}});
  globalThis[Symbol.for(apiModule.API_SYMBOL)]=api;
  const populationRuntime=harness.createUpstreamRuntimeHarness();
  const populationPlanner=harness.createUniverseHarness(populationRuntime.runtime);
  for(let systemID=30010000;systemID<30010200;systemID++) {
   populationPlanner.systemRecords.set(systemID,{solarSystemID:systemID,securityStatus:-0.5,regionID:10000002});
   const desired=populationPlanner.universe.listDesiredUniverseDungeonSiteDefinitions([systemID],1000,{families:Object.keys(rules.families)}).definitions;
   assert(desired.length<=2,'Native planner must enforce the aggregate cap');
   assert.equal(desired.length,Object.keys(rules.families).filter(f=>api.slotSpawnsInSystem(systemID,f,'nullsec')).length);
  }
  const forcedRules=clone(rules);
  for(const r of Object.values(forcedRules.families))r.density.nullsec.p=1;
  globalThis[Symbol.for(apiModule.API_SYMBOL)]=apiModule.createRuntimeApi({enabled:true,rules:forcedRules,version:'0.5.4',templateIDs});
  const crowdedSystem=30010000;
  const originalDesired=populationPlanner.universe.listDesiredUniverseDungeonSiteDefinitions([crowdedSystem],1000,{families:Object.keys(rules.families)}).definitions;
  assert.equal(originalDesired.length,5);
  const previousPayload={templatesByID:{},spawnProfiles:{families:{}}};
  for(const family of Object.keys(rules.families)) {
   previousPayload.templatesByID[templateIDs[family]]=content.buildTemplate(family,rules.families[family],snapshots.templatesByFamily[family],snapshots.common,'0.5.3','0.2.0');
   previousPayload.spawnProfiles.families[family]=content.buildProfile(family,rules.families[family],'0.5.3');
  }
  const previousPlanner=harness.createUniverseHarness(null,previousPayload);
  previousPlanner.systemRecords.set(crowdedSystem,{solarSystemID:crowdedSystem,securityStatus:-0.5,regionID:10000002});
  const previousDefinitions=previousPlanner.universe.listDesiredUniverseDungeonSiteDefinitions([crowdedSystem],1000,{families:Object.keys(rules.families)}).definitions;
  assert.deepEqual(originalDesired.map(d=>d.metadata.definitionHash),previousDefinitions.map(d=>d.metadata.definitionHash),'Release upgrade must retain existing definition hashes');
  populationRuntime.runtime.reconcileUniverseSeededInstances(originalDesired,{systemIDs:[crowdedSystem],siteOriginFilter:['universe_dungeon'],siteFamilyFilter:Object.keys(rules.families),nowMs:1000});
  globalThis[Symbol.for(apiModule.API_SYMBOL)]=api;
  const retainedDesired=populationPlanner.universe.listDesiredUniverseDungeonSiteDefinitions([crowdedSystem],2000,{families:Object.keys(rules.families)}).definitions;
  assert.equal(retainedDesired.length,5,'Lower density/cap must retain all existing work');
  const retained=populationRuntime.runtime.reconcileUniverseSeededInstances(retainedDesired,{systemIDs:[crowdedSystem],siteOriginFilter:['universe_dungeon'],siteFamilyFilter:Object.keys(rules.families),nowMs:2000});
  assert.equal(retained.removedCount,0);assert.equal(retained.replacedCount,0);assert.equal(retained.retainedCount,5);
  const retiring=populationRuntime.runtime.listInstancesBySystem(crowdedSystem,{full:true})[0];
  populationRuntime.runtime.setLifecycleState(retiring.instanceID,'completed',{nowMs:3000,completedAtMs:3000,expiresAtMs:3000,lifecycleReason:'depleted'});
  const reduced=populationPlanner.universe.advanceUniversePersistentSites({nowMs:3000,systemIDs:[crowdedSystem],refreshLoadedScenes:false});
  assert.equal(reduced.retiredWithoutReplacementCount,1,'Over-cap slot drains only after completion');
  console.log('PASS native planner cap across 200 systems; five existing sites retained, completed over-cap slot retires');
  assert.equal(transforms.inspectSiteService(source).ok,true);
  assert.throws(()=>transforms.transformSiteService(fixed),/ALREADY_APPLIED/);
  assert.throws(()=>transforms.transformSiteService(source.replace('remaining === null || remaining > 0','remaining > 0')),/SEAM_CHANGED/);
  assert.equal(transforms.inspectSiteService(source.replaceAll('\r\n','\n')).ok,true);
  assert.equal(transforms.inspectSiteService(source.replaceAll('\r\n','\n').replaceAll('\n','\r\n')).ok,true);
  const ordinaryContext=vm.createContext({...primitive,
   listMiningObjectiveRockDescriptors:()=>[{entityID:1}],readRecordedMiningRockRemainders:()=>({'1':0}),
   readRecordedMiningRockRemainder:()=>0,
   require:()=>({getMineableState:()=>({remainingQuantity:0})}),
   dungeonRuntime:{setLifecycleState:(instanceID,state,options)=>({instanceID,state,...options})},
   dungeonTrackingRuntime:{notifyDungeonCompletedForScene(){}},
  });
  ordinaryContext[Symbol.for(apiModule.API_SYMBOL)]={isOwnedMinedOutSite:()=>{throw Error('Native ore/gas must short-circuit Moon ownership');}};
  const ordinaryOld=vm.runInContext(fn(source,'maybeCompleteMinedOutSite')+'\nmaybeCompleteMinedOutSite',ordinaryContext);
  const ordinaryFixed=vm.runInContext(fn(fixed,'maybeCompleteMinedOutSite')+'\nmaybeCompleteMinedOutSite',ordinaryContext);
  for(const siteFamily of ['ore','gas']) {
   const row={instanceID:1,siteFamily,lifecycleState:'active'};
   assert.equal(ordinaryOld({},row,{},{}),true);assert.equal(ordinaryFixed({},row,{},{}),true);
  }
  const disabled=apiModule.createRuntimeApi({enabled:false,rules,version:'0.5.4',templateIDs});
  ordinaryContext[Symbol.for(apiModule.API_SYMBOL)]=disabled;
  assert.equal(ordinaryFixed({},{instanceID:1,siteFamily:'moon_r4',templateID:templateIDs.moon_r4,
   siteOrigin:'universe_dungeon',lifecycleState:'active',runtimeFlags:{universeSeeded:true,universePersistent:true}},{},{}),false);
  console.log('PASS semantic drift rejection, duplicate protection and LF/CRLF seams');
  if(process.env.MOON_DEPLETION_EVIDENCE)fs.writeFileSync(process.env.MOON_DEPLETION_EVIDENCE,JSON.stringify({checks,noWorldBoot:true,noDatabaseOpened:true,gameplay:'NEEDS USER GAMEPLAY'},null,2)+'\n');
 } finally {
  if(previous===undefined)delete globalThis[Symbol.for(apiModule.API_SYMBOL)];else globalThis[Symbol.for(apiModule.API_SYMBOL)]=previous;
 }
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;});
