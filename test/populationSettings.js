"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const config=require('../config'),{createRuntimeApi}=require('../lib/runtimeApi');
const rules=require('../data/moonOreSiteRules.json'),snapshots=require('../data/moonOreTemplates.v1.json');
const templateIDs=Object.fromEntries(Object.entries(snapshots.templatesByFamily).map(([k,v])=>[k,v.templateID]));
const families=Object.keys(templateIDs);
const make=settings=>createRuntimeApi({enabled:true,rules,version:'0.5.4',templateIDs,settings});
const defaults=config.load(root,{});
assert.equal(defaults.enabled,false);
assert.deepEqual(Object.fromEntries(Object.keys(config.DEFAULTS).map(k=>[k,defaults[k]])),config.DEFAULTS);
const manifest=require('../evejs-launcher.mod.json');
const example=require('../settings.example.json');
for(const field of manifest.settings.fields) {
 assert.equal(field.file,'preferences');assert.deepEqual(field.key,[field.id]);
 assert.equal(defaults[field.id],field.default);assert.equal(example[field.id],field.default);
 assert(['boolean','integer','number'].includes(field.type));
}
assert.equal(manifest.settings.fields.length,5);
const env=config.load(root,{EVEJS_MOON_SPAWN_CHANCE_MULTIPLIER:'0.5',EVEJS_MOON_MAX_SITES_PER_SYSTEM:'2',EVEJS_MOON_RESPAWN_DELAY_MINUTES:'15'});
assert.equal(env.spawnChanceMultiplier,0.5);assert.equal(env.maxSitesPerSystem,2);assert.equal(env.respawnDelayMinutes,15);
for(const [key,value] of [['EVEJS_MOON_SPAWN_CHANCE_MULTIPLIER','-1'],['EVEJS_MOON_MAX_SITES_PER_SYSTEM','2.5'],['EVEJS_MOON_RESPAWN_DELAY_MINUTES','NaN']])assert.throws(()=>config.load(root,{[key]:value}),/Invalid Moon/);
const legacy=make({}),half=make({spawnChanceMultiplier:0.5}),capped=make({spawnChanceMultiplier:0.5,maxSitesPerSystem:2});
let oldTotal=0,halfTotal=0,capTotal=0;
for(let system=30000001;system<30002001;system++) {
 const old=families.filter(f=>legacy.slotSpawnsInSystem(system,f,'nullsec'));
 const reduced=families.filter(f=>half.slotSpawnsInSystem(system,f,'nullsec'));
 const limited=families.filter(f=>capped.slotSpawnsInSystem(system,f,'nullsec'));
 assert(reduced.every(f=>old.includes(f)));assert(limited.length<=2);assert(limited.every(f=>reduced.includes(f)));
 assert.deepEqual(limited,families.filter(f=>make({spawnChanceMultiplier:0.5,maxSitesPerSystem:2}).slotSpawnsInSystem(system,f,'nullsec')));
 oldTotal+=old.length;halfTotal+=reduced.length;capTotal+=limited.length;
}
assert(halfTotal<oldTotal&&capTotal<=halfTotal);
const rows=families.map(siteFamily=>({siteFamily,templateID:templateIDs[siteFamily],siteOrigin:'universe_dungeon',
 lifecycleState:'active',runtimeFlags:{universeSeeded:true,universePersistent:true}}));
assert(families.every(f=>capped.slotSpawnsInSystem(30000001,f,'nullsec',0,()=>rows)),'Existing work must survive lower cap/density');
rows[0]={...rows[0],lifecycleState:'completed',lifecycleReason:'depleted'};
assert.equal(capped.slotSpawnsInSystem(30000001,rows[0].siteFamily,'nullsec',0,()=>rows),false,'Over-cap completed slot must drain, not respawn');
const chanceOneRules=JSON.parse(JSON.stringify(rules));
for(const r of Object.values(chanceOneRules.families))r.density.nullsec.p=1;
const two=createRuntimeApi({enabled:true,rules:chanceOneRules,version:'0.5.4',templateIDs,settings:{maxSitesPerSystem:2}});
const selected=families.filter(f=>two.slotSpawnsInSystem(30000001,f,'nullsec'));
const held=rows.filter(r=>selected.includes(r.siteFamily)).map(r=>({...r,lifecycleState:'completed',lifecycleReason:'depleted'}));
assert.equal(held.length,2);
assert(families.filter(f=>!selected.includes(f)).every(f=>!two.slotSpawnsInSystem(30000001,f,'nullsec',0,()=>held)),'Cooldown reservations cannot be bypassed by another family');
console.log('PASS 5 Configure defaults, numeric validation, 2000-system density/cap determinism, existing-site preservation and cooldown reservations');
console.log(JSON.stringify({systems:2000,legacySites:oldTotal,halfChanceSites:halfTotal,halfChanceCappedSites:capTotal}));
