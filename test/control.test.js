"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const path = require("node:path");
const { batteryControl, encode } = require("../lib/battery-control");
const { minuteOfDay } = require("../lib/weather-time");
const native = require("../io-package.json").native;
function adapter() {
    const filename = path.resolve(__dirname, "../main.js");
    const realRequire = createRequire(filename);
    const module = { exports: {} };
    class Adapter { on() {} }
    const mockRequire = id => id === "@iobroker/adapter-core" ? { Adapter } : realRequire(id);
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), { require: mockRequire, module, Date, Map, console });
    const a = module.exports();
    a.config = { ...native }; a.log = { debug() {}, warn() {} };
    a.writes = []; a.states = {}; a.inputs = {}; a.objects = {};
    a.setStateAsync = async (id, value) => { a.states[id] = value; };
    a.setForeignStateAsync = async (id, value) => { a.writes.push([id, value]); };
    a.getForeignStateAsync = async id => a.inputs[id];
    a.getForeignObjectAsync = async id => a.objects[id];
    a.getForeignObjectsAsync = async pattern => Object.fromEntries(Object.keys(a.inputs).filter(id => id.startsWith(pattern.slice(0, -1))).map(id => [id, {}]));
    return a;
}
function battery(config = {}, objects = {}) {
    const a = adapter(); Object.assign(a.config, { batteryEnabled:true, batteryChargeControlEnabled:true, batteryForecastControl:false, dryRun:false, batteryBidirectionalSetState:"set", batteryMaxChargeValue:3000, batteryMaxDischargeValue:2000 }, config);
    a.objects = { set:{common:{type:"number",unit:"kW",write:true,min:-2,max:2}}, ...objects };
    a.run = () => batteryControl.call(a, 4000, 0, { enabled:true, socValid:true, soc:50 }, {}, []);
    return a;
}
test("kW bidirectional output respects object range and returns actual W allocation", async () => {
    const a=battery(); assert.equal(await a.run(),2000); assert.deepEqual(a.writes,[["set",-2]]);
});
test("separate outputs convert each unit independently and clear discharge first",async()=>{
    const a=battery({batteryControlLayout:"separate",batteryChargeSetState:"charge",batteryDischargeSetState:"discharge"},{charge:{common:{type:"number",unit:"kW",write:true,min:0,max:10}},discharge:{common:{type:"number",unit:"W",write:true,min:0,max:4000}}});
    assert.equal(await a.run(),3000);assert.deepEqual(a.writes,[["discharge",0],["charge",3]]);
});
test("stale configured BMS limit blocks charge",async()=>{
    const a=battery({batteryDynamicMaxChargeState:"limit"},{limit:{common:{type:"number",unit:"W"}}});
    a.inputs.limit={val:1000,ts:Date.now()-120000};assert.equal(await a.run(),0);assert.deepEqual(a.writes,[["set",0]]);
});
test("mA dynamic limits normalize to A",async()=>{
    const a=battery({batteryControlQuantity:"auto",batteryMaxChargeValue:10,batteryFixedVoltageV:400,batteryDynamicMaxChargeState:"limit"},{set:{common:{type:"number",unit:"mA",write:true,min:-20000,max:20000}},limit:{common:{type:"number",unit:"mA"}}});
    a.inputs.limit={val:2000,ts:Date.now()};assert.equal(await a.run(),800);assert.deepEqual(a.writes,[["set",-2000]]);
});
test("read-only or unsafe minimum prevents all battery writes",async()=>{
    for(const common of [{type:"number",unit:"W",write:false},{type:"number",unit:"W",write:true,min:100}]){const a=battery({}, {set:{common}});assert.equal(await a.run(),0);assert.equal(a.writes.length,0);}
});
test("single boolean is rejected; separate boolean remains boolean",async()=>{
    const common={type:"boolean",write:true}; const a=battery({}, {set:{common}});await a.run();assert.equal(a.writes.length,0);
    const b=battery({batteryControlLayout:"separate",batteryChargeSetState:"c",batteryDischargeSetState:"d",batteryMaxChargeValue:1,batteryMaxDischargeValue:0},{c:{common},d:{common}});await b.run();assert.deepEqual(b.writes,[["d",false],["c",true]]);
});
test("no successful allocation after write failure",async()=>{const a=battery();a.setForeignStateAsync=async()=>{throw Error("offline");};assert.equal(await a.run(),0);});
test("range clipping never increases magnitude",()=>{assert.equal(encode(-4000,{write:true,type:"number",unit:"W",min:-1000},"power"),-1000);assert.throws(()=>encode(0,{write:true,type:"number",min:1},"power"));});
test("forecast values survive realtime timeout and missing values stay missing",async()=>{
    const a=adapter(),root="daswetter.0.location_1.ForecastHourly.";
    for(const [id,val] of Object.entries({"Hour_1.temperature":null,"Hour_1.time":"09:00","Hour_24.temperature":10,"Hour_24.time":"00:00","Hour_24.temperature_feels_like":8,"Hour_24.night":"false"}))a.inputs[root+id]={val,ts:Date.now()-3600000};
    const f=await a.readDasWetterForecast();assert.equal(f.samples,1);assert.equal(f.tempAvg,10);assert.equal(f.hourly[0].channel,24);assert.equal(f.hourly[0].night,false);assert.equal(f.hourly[0].feelsLike,8);assert.equal(f.hourly[1].minuteOfDay,540);
    a.inputs.pv={val:12,ts:Date.now()-3600000};assert.equal((await a.getNum("pv",1,"energyKWh",true)).valid,true);assert.equal((await a.getNum("pv")).valid,false);
});
test("clock time overrides channel and Hour_24 falls back to midnight",()=>{assert.equal(minuteOfDay("17:30",1),1050);assert.equal(minuteOfDay(null,24),0);assert.equal(minuteOfDay(null,1),60);});
test("overlapping cycles are skipped and lock releases on failure",async()=>{
    const a=adapter();let release;let calls=0;a.runCycleOnce=async()=>{calls++;await new Promise(r=>{release=r;});};const first=a.runCycle();await a.runCycle();assert.equal(calls,1);release();await first;
    a.runCycleOnce=async()=>{throw Error("test");};await assert.rejects(a.runCycle());assert.equal(a.cycleRunning,false);
});
test("climate restores normal cooling target after weather changes",async()=>{
    const a=adapter();a.config.dryRun=false;const c={enabled:true,name:"Klima",surplusOnW:1000,surplusOffW:300,onDelaySec:0,offDelaySec:0,targetSetState:"target",modeSetState:"mode",normalCoolTarget:24.5};
    await a.climateControlOne(c,0,2000,{temp:30},[],[]);a.writes=[];
    await a.climateControlOne(c,0,0,{temp:18},[],[]);assert.deepEqual(a.writes,[["target",24.5]]);
});
test("percentage reference and hard maximum are both enforced",async()=>{
    const a=battery({batteryMaxChargeValue:30,batteryReferenceChargePowerW:10000,batteryReferenceDischargePowerW:8000},{set:{common:{type:"number",unit:"%",write:true,min:-100,max:100}}});
    assert.equal(await a.run(),3000);assert.deepEqual(a.writes,[["set",-30]]);
});
test("discharge sign follows configuration and reserve prevents discharge",async()=>{
    for(const sign of ["chargePositive","chargeNegative"]){const a=battery({batteryControlSign:sign});await batteryControl.call(a,0,1500,{enabled:true,socValid:true,soc:50},{},[]);assert.deepEqual(a.writes,[["set",sign==="chargePositive"?-1.5:1.5]]);a.writes=[];await batteryControl.call(a,0,1500,{enabled:true,socValid:true,soc:10},{},[]);assert.deepEqual(a.writes,[["set",0]]);}
});
test("missing SOC clears a valid prior command; dry run sends no commands",async()=>{
    const a=battery();await batteryControl.call(a,4000,0,{enabled:true,socValid:false,soc:null},{},[]);assert.deepEqual(a.writes,[["set",0]]);
    const b=battery({dryRun:true});assert.equal(await b.run(),2000);assert.deepEqual(b.writes,[]);
});
test("daily forecast fields and expiry are independent of realtime timeout",async()=>{
    const a=adapter();for(const [name,val] of Object.entries({Temperature_Min:5,Temperature_Max:15,Humidity:80,Rain:2,Rain_Probability:60,Wind_Speed:12,Wind_Gust:20,sunshineduration:4,symbol:3,symbol_description:"Wolkig",date:"2026-11-01"}))a.inputs[`daswetter.0.location_1.ForecastDaily.Day_1.${name}`]={val,ts:Date.now()-3600000};
    let f=await a.readDasWetterForecast();assert.equal(f.today.min,5);assert.equal(f.today.max,15);assert.equal(f.today.sunshineDuration,4);assert.equal(f.today.symbolDescription,"Wolkig");
    for(const s of Object.values(a.inputs))s.ts=Date.now()-49*3600000;f=await a.readDasWetterForecast();assert.equal(f.valid,false);
});
test("priority allocation is ordered and consumes only remaining budget",async()=>{
    const a=adapter();Object.assign(a.config,{gridPowerState:"grid",pvPowerState:"pv",gridReserveW:0,targetGridW:0,heatPumpPriority:20,batteryPriority:30,heaterPriority:80,climates:[{priority:40}]});
    a.inputs.grid={val:-4000,ts:Date.now()};a.inputs.pv={val:6000,ts:Date.now()};a.forecast=async()=>({temp:null,pvToday:0,pvRemaining:0,consumption:0,balance:0});a.collectDeviceMeasurements=async()=>({});a.updateLearning=async()=>{};
    const seen=[];for(const [method,label] of [["heatPumpControl","wp"],["batteryControl","battery"],["heaterControl","heater"]])a[method]=async w=>{seen.push([label,w]);return 1000;};a.climateControlOne=async(c,i,w)=>{seen.push(["climate",w]);return 1000;};
    await a.runCycle();assert.deepEqual(seen,[["wp",4000],["battery",3000],["climate",2000],["heater",1000]]);
});
