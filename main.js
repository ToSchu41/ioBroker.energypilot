"use strict";
const utils = require("@iobroker/adapter-core");

class EnergyPilot extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: "energypilot" });
        this.on("ready", this.onReady.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.on("message", this.onMessage.bind(this));
        this.timer = null;
        this.lastValues = new Map();
        this.thermal = new Map();
        this.today = { date: this.dayKey(), energyWh: 0, tempSum: 0, tempSamples: 0, lastTs: Date.now() };
        this.history = [];
        this.unitCache = new Map();
        this.weatherObjectCache = { ts: 0, ids: [] };
    }

    dayKey(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

    async onReady() {
        await this.ensureObjects();
        await this.loadHistory();
        this.log.info(`Energy Pilot v${this.version} started${this.config.dryRun ? " in dry-run mode" : ""}`);
        const ms = Math.max(1000, Number(this.config.cycleSec || 5) * 1000);
        await this.runCycle();
        this.timer = this.setInterval(() => this.runCycle().catch(e => this.log.error(`Control cycle failed: ${e.stack || e}`)), ms);
    }

    async onUnload(callback) {
        try { if (this.timer) this.clearInterval(this.timer); callback(); } catch { callback(); }
    }

    async ensureObjects() {
        const defs = {
            "info.connection": ["boolean","indicator.connected","Connection",false],
            "control.mode": ["string","text","EMS mode","automatic"],
            "control.availableSurplusW": ["number","value.power","Available flexible surplus",0,"W"],
            "forecast.pvTodayKWh": ["number","value.energy","PV forecast today",0,"kWh"],
            "forecast.pvRemainingKWh": ["number","value.energy","PV forecast remaining",0,"kWh"],
            "forecast.pvTomorrowKWh": ["number","value.energy","PV forecast tomorrow",0,"kWh"],
            "forecast.consumptionTodayKWh": ["number","value.energy","Forecast consumption today",0,"kWh"],
            "forecast.expectedBalanceKWh": ["number","value.energy","Expected PV minus consumption",0,"kWh"],
            "diagnostics.gridPowerW": ["number","value.power","Grid power (+ import / - export)",0,"W"],
            "diagnostics.pvPowerW": ["number","value.power","PV power",0,"W"],
            "diagnostics.housePowerW": ["number","value.power","House consumption",0,"W"],
            "diagnostics.batteryPowerW": ["number","value.power","Battery power",0,"W"],
            "diagnostics.batterySoc": ["number","value.battery","Battery SOC",0,"%"],
            "diagnostics.weatherTempC": ["number","value.temperature","Forecast/current outdoor temperature",0,"°C"],
            "diagnostics.weatherMinTempC": ["number","value.temperature","Forecast minimum temperature",0,"°C"],
            "diagnostics.weatherMaxTempC": ["number","value.temperature","Forecast maximum temperature",0,"°C"],
            "diagnostics.weatherCloudsPct": ["number","value","Forecast average clouds",0,"%"],
            "diagnostics.weatherHumidityPct": ["number","value.humidity","Forecast average humidity",0,"%"],
            "diagnostics.weatherWind": ["number","value.speed","Forecast average wind speed",0,""] ,
            "diagnostics.inputUnits": ["string","json","Detected source units","{}",""] ,
            "diagnostics.dataValid": ["boolean","indicator","Input data valid",false],
            "diagnostics.lastDecision": ["string","text","Last decision",""],
            "diagnostics.lastCycle": ["string","date","Last control cycle",""],
            "diagnostics.measurementQuality": ["string","text","Measurement quality summary",""],
            "diagnostics.activeLoads": ["string","json","Active flexible loads","[]"],
            "diagnostics.deviceMeasurements": ["string","json","Device energy measurements","{}"],
            "diagnostics.history": ["string","json","Learned daily history","[]"]
        };
        for (const [id,[type,role,name,def,unit]] of Object.entries(defs)) {
            await this.setObjectNotExistsAsync(id,{type:"state",common:{name,type,role,read:true,write:false,def,...(unit?{unit}:{})},native:{}});
        }
        await this.setStateAsync("info.connection", true, true);
    }

    async sourceUnit(id) {
        if (!id) return "";
        if (this.unitCache.has(id)) return this.unitCache.get(id);
        try {
            const o = await this.getForeignObjectAsync(id);
            const unit = String(o?.common?.unit || "").trim();
            this.unitCache.set(id, unit);
            return unit;
        } catch { return ""; }
    }

    unitFactor(unit, quantity) {
        const u=String(unit||"").trim().replace(/\s/g,"").toLowerCase();
        if(quantity==="power") { if(u==="kw") return 1000; if(u==="mw") return 1000000; return 1; }
        if(quantity==="energyKWh") { if(u==="wh") return 0.001; if(u==="mwh") return 1000; return 1; }
        return 1;
    }

    async getNum(id, factor=1, quantity=null) {
        if (!id) return {valid:false,value:0,age:Infinity,unit:""};
        try {
            const s = await this.getForeignStateAsync(id);
            if (!s || s.val === null || s.val === undefined || Number.isNaN(Number(s.val))) return {valid:false,value:0,age:Infinity,unit:""};
            const age = Date.now() - (s.ts || 0);
            const valid = age <= Math.max(5000, Number(this.config.staleSec||30)*1000);
            const unit=await this.sourceUnit(id);
            const normalized=Number(s.val)*factor*(quantity?this.unitFactor(unit,quantity):1);
            return {valid,value:normalized,age,unit};
        } catch (e) { this.log.debug(`Cannot read ${id}: ${e.message}`); return {valid:false,value:0,age:Infinity,unit:""}; }
    }
    async getAny(id) { if (!id) return {valid:false,value:null}; try { const s=await this.getForeignStateAsync(id); return {valid:!!s && Date.now()-(s.ts||0)<=Number(this.config.staleSec||30)*1000,value:s?.val}; } catch { return {valid:false,value:null}; } }
    async write(id, value, reason) {
        if (!id) return;
        if (this.config.dryRun) { this.log.debug(`[DRY] ${id} <= ${value} (${reason})`); return; }
        try { await this.setForeignStateAsync(id, value, false); } catch(e) { this.log.warn(`Write failed ${id}: ${e.message}`); }
    }

    normalizeGrid(raw) { return this.config.gridSign === "exportPositive" ? -raw : raw; }

    async batterySnapshot() {
        if (!this.config.batteryEnabled) return {enabled:false,power:0,soc:null,quality:"disabled"};
        const soc=await this.getNum(this.config.batterySocState);
        let p={valid:false,value:0}; let quality="unknown";
        if (this.config.batteryMeasurementMode === "meter") { p=await this.getNum(this.config.batteryMeterPowerState,1,"power"); quality=p.valid?"measured":"unknown"; }
        else if (this.config.batteryMeasurementMode === "device") { p=await this.getNum(this.config.batteryPowerState,1,"power"); quality=p.valid?"deviceReported":"unknown"; }
        else if (this.config.batteryMeasurementMode === "estimated") quality="estimated";
        const rawPower=p.value||0; const power=this.config.batteryPowerSign==="dischargePositive" ? -rawPower : rawPower;
        return {enabled:true,power,soc:soc.valid?soc.value:null,socValid:soc.valid,quality};
    }

    async readDasWetterForecast() {
        const base=String(this.config.dasWetterBasePath||"daswetter.0").replace(/\.$/,"");
        const location=String(this.config.dasWetterLocation||"Location_1").replace(/^\.+|\.+$/g,"");
        const root=`${base}.ForecastHourly.${location}.`;
        try {
            let ids=this.weatherObjectCache.ids;
            if(!ids.length || Date.now()-this.weatherObjectCache.ts>10*60*1000){
                const objs=await this.getForeignObjectsAsync(`${root}*`,"state");
                ids=Object.keys(objs||{});
                this.weatherObjectCache={ts:Date.now(),ids};
            }
            const suffixes={temperature:".temperature_value",clouds:".clouds_value",humidity:".humidity_value",wind:".wind_speed_value",rainProbability:".rain_probability_value"};
            const out={temperature:[],clouds:[],humidity:[],wind:[],rainProbability:[]};
            for(const [key,suffix] of Object.entries(suffixes)){
                const matching=ids.filter(id=>id.endsWith(suffix));
                for(const id of matching){ const x=await this.getNum(id); if(x.valid && Number.isFinite(x.value)) out[key].push(x.value); }
            }
            const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
            return {valid:out.temperature.length>0,tempAvg:avg(out.temperature),tempMin:out.temperature.length?Math.min(...out.temperature):null,tempMax:out.temperature.length?Math.max(...out.temperature):null,clouds:avg(out.clouds),humidity:avg(out.humidity),wind:avg(out.wind),rainProbability:avg(out.rainProbability),samples:out.temperature.length};
        } catch(e){ this.log.debug(`dasWetter forecast read failed: ${e.message}`); return {valid:false}; }
    }

    async forecast() {
        const today=await this.getNum(this.config.pvForecastTodayState,1,"energyKWh");
        const rem=await this.getNum(this.config.pvForecastRemainingState,1,"energyKWh");
        const tomorrow=await this.getNum(this.config.pvForecastTomorrowState,1,"energyKWh");
        const next3=await this.getNum(this.config.pvForecastNext3hState,1,"energyKWh");
        let wx={valid:false,tempAvg:null,tempMin:null,tempMax:null,clouds:null,humidity:null,wind:null,rainProbability:null,samples:0};
        if(this.config.weatherSourceMode==="daswetter") wx=await this.readDasWetterForecast();
        else if(this.config.weatherSourceMode!=="none"){
            const tempNow=await this.getNum(this.config.weatherTempNowState), tempAvg=await this.getNum(this.config.weatherTempAvgState), tempMax=await this.getNum(this.config.weatherTempMaxState), clouds=await this.getNum(this.config.weatherCloudState);
            const t=tempAvg.valid?tempAvg.value:(tempNow.valid?tempNow.value:null);
            wx={valid:t!==null,tempAvg:t,tempMin:t,tempMax:tempMax.valid?tempMax.value:t,clouds:clouds.valid?clouds.value:null,humidity:null,wind:null,rainProbability:null,samples:t!==null?1:0};
        }
        const avgT=wx.tempAvg;
        let baseline=Number(this.config.baseDailyConsumptionKWh||0);
        let learnedForWeather=false;
        if (this.config.learningEnabled && this.history.length) {
            const recent=this.history.slice(-Math.max(7,Number(this.config.historyDays||30)));
            const comparable=avgT===null?[]:recent.filter(x=>Number.isFinite(Number(x.energyKWh)) && Number.isFinite(Number(x.avgTempC)) && Math.abs(Number(x.avgTempC)-avgT)<=3);
            const source=comparable.length>=3?comparable:recent.filter(x=>Number.isFinite(Number(x.energyKWh)));
            if (source.length) { baseline=source.reduce((a,b)=>a+Number(b.energyKWh),0)/source.length; learnedForWeather=comparable.length>=3; }
        }
        let consumption=baseline;
        if (avgT !== null && !learnedForWeather) {
            if (avgT < Number(this.config.heatingBalanceTempC||15)) consumption += (Number(this.config.heatingBalanceTempC||15)-avgT)*Number(this.config.heatingKWhPerK||0);
            const mx=wx.tempMax!==null?wx.tempMax:avgT;
            if (mx > Number(this.config.coolingBalanceTempC||24)) consumption += (mx-Number(this.config.coolingBalanceTempC||24))*Number(this.config.coolingKWhPerK||0);
            // Small weather correction: wind tends to raise heating demand; cloud cover lowers passive solar gains.
            if(avgT < Number(this.config.heatingBalanceTempC||15) && Number.isFinite(wx.wind)) consumption += Math.max(0,wx.wind-10)*0.03;
            if(avgT < Number(this.config.heatingBalanceTempC||15) && Number.isFinite(wx.clouds)) consumption += Math.max(0,wx.clouds-50)*0.005;
        }
        const pvToday=today.valid?today.value:0, pvRem=rem.valid?rem.value:0;
        return {pvToday,pvRemaining:pvRem,pvTomorrow:tomorrow.valid?tomorrow.value:0,pvNext3h:next3.valid?next3.value:0,temp:avgT,tempMin:wx.tempMin,tempMax:wx.tempMax,clouds:wx.clouds,humidity:wx.humidity,wind:wx.wind,rainProbability:wx.rainProbability,weatherSamples:wx.samples,consumption,balance:pvToday-consumption};
    }

    async updateLearning(housePowerW, tempC) {
        const now=Date.now(), dtH=Math.max(0,Math.min(0.05,(now-this.today.lastTs)/3600000));
        this.today.lastTs=now;
        if (Number.isFinite(housePowerW) && housePowerW>=0) this.today.energyWh += housePowerW*dtH;
        if (Number.isFinite(tempC)) { this.today.tempSum+=tempC; this.today.tempSamples++; }
        const key=this.dayKey();
        if (key!==this.today.date) {
            this.history.push({date:this.today.date,energyKWh:this.today.energyWh/1000,avgTempC:this.today.tempSamples?this.today.tempSum/this.today.tempSamples:null});
            this.history=this.history.slice(-365);
            await this.setStateAsync("diagnostics.history",JSON.stringify(this.history),true);
            this.today={date:key,energyWh:0,tempSum:0,tempSamples:0,lastTs:now};
        }
    }
    async loadHistory(){ const s=await this.getStateAsync("diagnostics.history"); try { this.history=JSON.parse(s?.val||"[]"); if(!Array.isArray(this.history))this.history=[]; } catch { this.history=[]; } }

    thermalDecision(key, shouldOn, shouldOff, onDelaySec, offDelaySec) {
        const now=Date.now(); let x=this.thermal.get(key)||{active:false,since:now,conditionSince:now,lastCondition:null};
        const cond=shouldOn?"on":(shouldOff?"off":"hold");
        if(cond!==x.lastCondition){x.conditionSince=now;x.lastCondition=cond;}
        if(!x.active && cond==="on" && now-x.conditionSince>=Number(onDelaySec||0)*1000){x.active=true;x.since=now;}
        if(x.active && cond==="off" && now-x.conditionSince>=Number(offDelaySec||0)*1000){x.active=false;x.since=now;}
        this.thermal.set(key,x); return x.active;
    }

    async batteryControl(surplusW, gridW, b, f, decisions) {
        if (!b.enabled || !this.config.batteryChargeControlEnabled || !b.socValid) return 0;
        const soc=b.soc; let chargeW=Math.max(0,surplusW), dischargeW=Math.max(0,gridW);
        if(soc>=Number(this.config.batteryMaxSoc||100)) chargeW=0;
        if(soc<=Number(this.config.batteryReserveSoc||20)) dischargeW=0;
        if(this.config.batteryForecastControl && f.pvRemaining>0 && soc>=Number(this.config.batteryMinSoc||10)) {
            const targetGap=Math.max(0,Number(this.config.batteryTargetSoc||80)-soc)/100;
            const expectedFlexible=Math.max(0,f.pvRemaining - Math.max(0,f.consumption*0.5));
            if(expectedFlexible>targetGap*10) chargeW*=0.45;
        }
        const type=this.config.batteryChargeControlType||"power";
        let cVal=0,dVal=0;
        if(type==="power"){cVal=Math.min(chargeW,Number(this.config.batteryMaxChargeValue||0)); dVal=Math.min(dischargeW,Number(this.config.batteryMaxDischargeValue||0));}
        else if(type==="percent"){cVal=Math.min(100,100*chargeW/Math.max(1,Number(this.config.batteryMaxChargeValue||1)));dVal=Math.min(100,100*dischargeW/Math.max(1,Number(this.config.batteryMaxDischargeValue||1)));}
        else if(type==="boolean"){cVal=chargeW>Number(this.config.gridReserveW||200);dVal=dischargeW>Number(this.config.gridReserveW||200);}
        else if(type==="current"){
            const v=await this.getNum(this.config.batteryVoltageState); const volts=v.valid&&v.value>20?v.value:400;
            cVal=Math.min(Number(this.config.batteryMaxChargeValue||0),chargeW/volts); dVal=Math.min(Number(this.config.batteryMaxDischargeValue||0),dischargeW/volts);
        }
        await this.write(this.config.batteryChargeSetState,Math.round(cVal*100)/100,"battery charge optimization");
        await this.write(this.config.batteryDischargeSetState,Math.round(dVal*100)/100,"battery discharge optimization");
        decisions.push(`Battery: charge=${Math.round(cVal*100)/100}, discharge=${Math.round(dVal*100)/100} (${type})`);
        return Math.max(0, Math.min(chargeW, surplusW));
    }

    async heatPumpControl(surplusW, decisions, activeLoads) {
        if(!this.config.heatPumpEnabled)return 0;
        const active=this.thermalDecision("heatpump",surplusW>=Number(this.config.heatPumpBoostSurplusW||1500),surplusW<=Number(this.config.heatPumpBoostOffW||500),this.config.heatPumpOnDelaySec,this.config.heatPumpOffDelaySec);
        if(this.config.heatPumpControlType==="temperature"){
            await this.write(this.config.heatPumpHeatingTargetSetState,active?Number(this.config.heatPumpBoostHeatingTarget):Number(this.config.heatPumpNormalHeatingTarget),"heat pump PV boost");
            await this.write(this.config.heatPumpHotWaterTargetSetState,active?Number(this.config.heatPumpBoostHotWaterTarget):Number(this.config.heatPumpNormalHotWaterTarget),"heat pump PV boost");
        } else await this.write(this.config.heatPumpBoostSetState,active,"heat pump PV boost");
        if(active)activeLoads.push({name:this.config.heatPumpName||"Heat pump",priority:Number(this.config.heatPumpPriority||20),type:"pvBoost"});
        decisions.push(`Heat pump PV boost: ${active?"ON":"OFF"}`);
        return active ? Math.min(surplusW, Number(this.config.heatPumpBoostPowerW||2000)) : 0;
    }

    async heaterControl(surplusW, decisions, activeLoads) {
        if(!this.config.heaterEnabled)return 0;
        let active=this.thermalDecision("heater",surplusW>=Number(this.config.heaterSurplusOnW||3500),surplusW<=Number(this.config.heaterSurplusOffW||1000),this.config.heaterOnDelaySec,this.config.heaterOffDelaySec);
        const st=this.thermal.get("heater"); if(active && st && Date.now()-st.since>Number(this.config.heaterMaxRunMin||60)*60000){active=false;st.active=false;}
        await this.write(this.config.heaterEnableSetState,active,"heating rod surplus control");
        if(active)activeLoads.push({name:this.config.heaterName||"Heating rod",priority:Number(this.config.heaterPriority||80),type:"surplus"});
        decisions.push(`Heating rod: ${active?"ON":"OFF"}`);
        return active ? Math.min(surplusW, Number(this.config.heaterPowerW||0)) : 0;
    }

    async climateControlOne(c, i, surplusW, f, decisions, activeLoads) {
        if(!c.enabled)return 0;
        const room=await this.getNum(c.roomTempState);
        const hot=(f.temp!==null?f.temp:0)>=Number(this.config.coolingBalanceTempC||24);
        const cold=(f.temp!==null?f.temp:99)<=Number(this.config.heatingBalanceTempC||15);
        const active=this.thermalDecision(`climate${i}`,surplusW>=Number(c.surplusOnW||1000),surplusW<=Number(c.surplusOffW||300),c.onDelaySec,c.offDelaySec);
        if(active && hot){await this.write(c.modeSetState,c.coolModeValue||"cool",`climate ${c.name} PV cooling`);await this.write(c.targetSetState,Number(c.pvCoolTarget||23.5),`climate ${c.name} PV cooling`);activeLoads.push({name:c.name||`Climate ${i+1}`,priority:Number(c.priority||40),type:"pvCooling"});}
        else if(active && cold){await this.write(c.modeSetState,c.heatModeValue||"heat",`climate ${c.name} PV heating`);await this.write(c.targetSetState,Number(c.pvHeatTarget||22),`climate ${c.name} PV heating`);activeLoads.push({name:c.name||`Climate ${i+1}`,priority:Number(c.priority||40),type:"pvHeating"});}
        else if(!active){ if(hot)await this.write(c.targetSetState,Number(c.normalCoolTarget||24.5),`climate ${c.name} normal target`); if(cold)await this.write(c.targetSetState,Number(c.normalHeatTarget||21),`climate ${c.name} normal target`); }
        decisions.push(`${c.name||`Climate ${i+1}`}: ${active?(hot?"PV cooling":cold?"PV heating":"hold"):"normal"}${room.valid?` room ${room.value}°C`:""}`);
        return active && (hot||cold) ? Math.min(surplusW, Number(c.expectedPowerW||800)) : 0;
    }

    async collectDeviceMeasurements(b) {
        const out={battery:{powerW:Math.round(b.power||0),soc:b.soc,quality:b.quality}};
        if(this.config.heatPumpEnabled){
            let x={valid:false,value:0},q="unknown";
            if(this.config.heatPumpMeasurementMode==="meter"){x=await this.getNum(this.config.heatPumpMeterPowerState,1,"power");q=x.valid?"measured":"unknown";}
            else if(this.config.heatPumpMeasurementMode==="device"){x=await this.getNum(this.config.heatPumpPowerState,1,"power");q=x.valid?"deviceReported":"unknown";}
            else if(this.config.heatPumpMeasurementMode==="estimated")q="estimated";
            out.heatPump={powerW:Math.round(x.value||0),quality:q};
        }
        if(this.config.heaterEnabled){
            let x={valid:false,value:0},q="unknown";
            if(this.config.heaterMeasurementMode==="meter"){x=await this.getNum(this.config.heaterMeterPowerState,1,"power");q=x.valid?"measured":"unknown";}
            else if(this.config.heaterMeasurementMode==="estimated"){const st=await this.getAny(this.config.heaterEnableSetState);x={valid:st.valid,value:st.value?Number(this.config.heaterPowerW||0):0};q="estimated";}
            out.heater={powerW:Math.round(x.value||0),quality:q};
        }
        out.climates=[];
        const rows=Array.isArray(this.config.climates)?this.config.climates:[];
        for(const c of rows){
            let x={valid:false,value:0},q="unknown";
            if(c.measurementMode==="meter"){x=await this.getNum(c.meterPowerState,1,"power");q=x.valid?"measured":"unknown";}
            else if(c.measurementMode==="device"){x=await this.getNum(c.powerState,1,"power");q=x.valid?"deviceReported":"unknown";}
            else if(c.measurementMode==="estimated")q="estimated";
            out.climates.push({name:c.name||"Climate",powerW:Math.round(x.value||0),quality:q});
        }
        return out;
    }

    async runCycle() {
        if(!this.config.emsEnabled){await this.setStateAsync("control.mode","disabled",true);return;}
        const gRaw=await this.getNum(this.config.gridPowerState,1,"power"), pv=await this.getNum(this.config.pvPowerState,1,"power"), houseCfg=await this.getNum(this.config.housePowerState,1,"power"), b=await this.batterySnapshot(), f=await this.forecast();
        const grid=gRaw.valid?this.normalizeGrid(gRaw.value):0;
        let house=houseCfg.valid?houseCfg.value:0;
        if(!houseCfg.valid && gRaw.valid && pv.valid) house=Math.max(0,pv.value+grid-(b.power||0));
        const dataValid=gRaw.valid && pv.valid;
        const reserve=Number(this.config.gridReserveW||200);
        const surplus=Math.max(0,-grid-reserve);
        const decisions=[], activeLoads=[];
        await this.updateLearning(house,f.temp);
        if(dataValid){
            const climateRows=Array.isArray(this.config.climates)?this.config.climates:[];
            const actions=[
              {p:Number(this.config.heatPumpPriority||20),name:"heatPump",fn:a=>this.heatPumpControl(a,decisions,activeLoads)},
              {p:Number(this.config.batteryPriority||30),name:"battery",fn:a=>this.batteryControl(a,grid,b,f,decisions)},
              ...climateRows.map((x,i)=>({p:Number(x.priority||40),name:`climate${i}`,fn:a=>this.climateControlOne(x,i,a,f,decisions,activeLoads)})),
              {p:Number(this.config.heaterPriority||80),name:"heater",fn:a=>this.heaterControl(a,decisions,activeLoads)}
            ].sort((a,b)=>a.p-b.p);
            let remaining=surplus;
            for(const a of actions){ const used=Number(await a.fn(remaining))||0; remaining=Math.max(0,remaining-used); decisions.push(`${a.name} allocation: ${Math.round(used)} W, remaining ${Math.round(remaining)} W`); }
            await this.setStateAsync("control.availableSurplusW",Math.round(remaining),true);
        } else decisions.push("No control: grid/PV input invalid or stale");
        const deviceMeasurements=await this.collectDeviceMeasurements(b);
        await this.setStateAsync("control.mode",dataValid?"automatic":"input-error",true);
        if(!dataValid) await this.setStateAsync("control.availableSurplusW",0,true);
        await this.setStateAsync("forecast.pvTodayKWh",f.pvToday,true); await this.setStateAsync("forecast.pvRemainingKWh",f.pvRemaining,true); await this.setStateAsync("forecast.pvTomorrowKWh",f.pvTomorrow||0,true); await this.setStateAsync("forecast.consumptionTodayKWh",Math.round(f.consumption*10)/10,true); await this.setStateAsync("forecast.expectedBalanceKWh",Math.round(f.balance*10)/10,true);
        await this.setStateAsync("diagnostics.gridPowerW",Math.round(grid),true); await this.setStateAsync("diagnostics.pvPowerW",Math.round(pv.value||0),true); await this.setStateAsync("diagnostics.housePowerW",Math.round(house),true); await this.setStateAsync("diagnostics.batteryPowerW",Math.round(b.power||0),true); if(b.soc!==null)await this.setStateAsync("diagnostics.batterySoc",b.soc,true); if(f.temp!==null)await this.setStateAsync("diagnostics.weatherTempC",f.temp,true); if(f.tempMin!==null)await this.setStateAsync("diagnostics.weatherMinTempC",f.tempMin,true); if(f.tempMax!==null)await this.setStateAsync("diagnostics.weatherMaxTempC",f.tempMax,true); if(f.clouds!==null)await this.setStateAsync("diagnostics.weatherCloudsPct",f.clouds,true); if(f.humidity!==null)await this.setStateAsync("diagnostics.weatherHumidityPct",f.humidity,true); if(f.wind!==null)await this.setStateAsync("diagnostics.weatherWind",f.wind,true);
        const inputUnits={grid:await this.sourceUnit(this.config.gridPowerState),pv:await this.sourceUnit(this.config.pvPowerState),house:await this.sourceUnit(this.config.housePowerState),battery:await this.sourceUnit(this.config.batteryMeasurementMode==="meter"?this.config.batteryMeterPowerState:this.config.batteryPowerState),pvForecastToday:await this.sourceUnit(this.config.pvForecastTodayState),pvForecastRemaining:await this.sourceUnit(this.config.pvForecastRemainingState)}; await this.setStateAsync("diagnostics.inputUnits",JSON.stringify(inputUnits),true); await this.setStateAsync("diagnostics.dataValid",dataValid,true); await this.setStateAsync("diagnostics.measurementQuality",JSON.stringify({grid:gRaw.valid?"measured":"unknown",pv:pv.valid?"deviceReported":"unknown",battery:b.quality,house:houseCfg.valid?"measured":"derived"}),true); await this.setStateAsync("diagnostics.deviceMeasurements",JSON.stringify(deviceMeasurements),true); await this.setStateAsync("diagnostics.activeLoads",JSON.stringify(activeLoads.sort((a,b)=>a.priority-b.priority)),true); await this.setStateAsync("diagnostics.lastDecision",decisions.join(" | ").slice(0,10000),true); await this.setStateAsync("diagnostics.lastCycle",new Date().toISOString(),true);
    }

    onMessage(obj){ if(obj?.command==="getStatus" && obj.callback) this.sendTo(obj.from,obj.command,{ok:true,dryRun:!!this.config.dryRun},obj.callback); }
}
if (require.main !== module) module.exports = options => new EnergyPilot(options); else new EnergyPilot();
