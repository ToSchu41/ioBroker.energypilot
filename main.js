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
        this.metaCache = new Map();
        this.weatherObjectCache = { ts: 0, hourlyIds: [], dailyIds: [] };
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
            "forecast.consumptionTomorrowKWh": ["number","value.energy","Forecast consumption tomorrow",0,"kWh"],
            "forecast.expectedBalanceKWh": ["number","value.energy","Expected PV minus consumption",0,"kWh"],
            "forecast.expectedBalanceTomorrowKWh": ["number","value.energy","Expected PV minus consumption tomorrow",0,"kWh"],
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
            "diagnostics.weatherTomorrowMinTempC": ["number","value.temperature","Tomorrow minimum temperature",0,"°C"],
            "diagnostics.weatherTomorrowMaxTempC": ["number","value.temperature","Tomorrow maximum temperature",0,"°C"],
            "diagnostics.weatherStatus": ["string","json","Weather source diagnostics","{}",""],
            "diagnostics.batteryControl": ["string","json","Battery external control diagnostics","{}",""],
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

    async sourceMeta(id) {
        if (!id) return {unit:"",min:null,max:null,write:false,type:null};
        if (this.metaCache.has(id)) return this.metaCache.get(id);
        try {
            const o=await this.getForeignObjectAsync(id);
            const meta={
                unit:String(o?.common?.unit||"").trim(),
                min:Number.isFinite(Number(o?.common?.min))?Number(o.common.min):null,
                max:Number.isFinite(Number(o?.common?.max))?Number(o.common.max):null,
                write:!!o?.common?.write,
                type:o?.common?.type||null
            };
            this.metaCache.set(id,meta);
            if(meta.unit) this.unitCache.set(id,meta.unit);
            return meta;
        } catch { return {unit:"",min:null,max:null,write:false,type:null}; }
    }

    detectControlQuantity(unit, type) {
        const u=String(unit||"").trim().replace(/\s/g,"").toLowerCase();
        if(type==="boolean") return "boolean";
        if(u==="w" || u==="kw" || u==="mw") return "power";
        if(u==="a" || u==="ma") return "current";
        if(u==="%" || u==="percent") return "percent";
        return null;
    }

    async batteryControlMeta() {
        const layout=this.config.batteryControlLayout||"single";
        const primary=layout==="single"?this.config.batteryBidirectionalSetState:this.config.batteryChargeSetState;
        const meta=await this.sourceMeta(primary);
        let quantity=this.config.batteryControlQuantity||"auto";
        if(quantity==="auto") quantity=this.detectControlQuantity(meta.unit,meta.type)||"unknown";
        return {layout,primary,meta,quantity};
    }

    async readLimitState(id, quantity) {
        if(!id) return null;
        const x=await this.getNum(id,1,quantity==="power"?"power":null);
        return x.valid?Math.max(0,Math.abs(x.value)):null;
    }

    clampByObjectRange(value, meta) {
        let v=Number(value);
        if(Number.isFinite(meta?.min)) v=Math.max(v,meta.min);
        if(Number.isFinite(meta?.max)) v=Math.min(v,meta.max);
        return v;
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
        const location=String(this.config.dasWetterLocation||"location_1").replace(/^\.+|\.+$/g,"");
        const hourlyRoot=`${base}.${location}.ForecastHourly`;
        const dailyRoot=`${base}.${location}.ForecastDaily`;
        try {
            let hourlyIds=this.weatherObjectCache.hourlyIds||[], dailyIds=this.weatherObjectCache.dailyIds||[];
            if((!hourlyIds.length && !dailyIds.length) || Date.now()-this.weatherObjectCache.ts>10*60*1000){
                const [hourlyObjs,dailyObjs]=await Promise.all([
                    this.getForeignObjectsAsync(`${hourlyRoot}.*`,"state"),
                    this.getForeignObjectsAsync(`${dailyRoot}.*`,"state")
                ]);
                hourlyIds=Object.keys(hourlyObjs||{}); dailyIds=Object.keys(dailyObjs||{});
                this.weatherObjectCache={ts:Date.now(),hourlyIds,dailyIds};
            }
            const byHour={};
            for(const id of hourlyIds){
                const m=id.match(/\.Hour_(\d+)\.([^.]*)$/);
                if(!m) continue;
                const hour=Number(m[1]), key=m[2];
                if(!byHour[hour]) byHour[hour]={};
                byHour[hour][key]=id;
            }
            const out={temperature:[],clouds:[],humidity:[],wind:[],rainProbability:[]};
            const map={temperature:"temperature",clouds:"clouds",humidity:"humidity",wind:"wind_speed",rainProbability:"rain_probability"};
            for(const row of Object.values(byHour)){
                for(const [dest,key] of Object.entries(map)){
                    if(!row[key]) continue;
                    const x=await this.getNum(row[key]);
                    if(x.valid && Number.isFinite(x.value)) out[dest].push(x.value);
                }
            }
            const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;

            const readDaily=async day=>{
                const prefix=`${dailyRoot}.Day_${day}.`;
                const ids=dailyIds.filter(id=>id.startsWith(prefix));
                const vals=[];
                for(const id of ids){
                    const key=id.slice(prefix.length).toLowerCase();
                    if(!/(temp|temperature)/.test(key)) continue;
                    const x=await this.getNum(id);
                    if(x.valid && Number.isFinite(x.value)) vals.push({key,value:x.value});
                }
                const pick=kind=>{
                    const patterns=kind==="min"?[/min.*temp/,/temp.*min/,/minimum/]:[/max.*temp/,/temp.*max/,/maximum/];
                    const hit=vals.find(v=>patterns.some(r=>r.test(v.key)));
                    return hit?hit.value:null;
                };
                return {min:pick("min"),max:pick("max"),temperatureValues:vals.length};
            };
            const [today,tomorrow]=await Promise.all([readDaily(1),readDaily(2)]);
            const hourlyMin=out.temperature.length?Math.min(...out.temperature):null;
            const hourlyMax=out.temperature.length?Math.max(...out.temperature):null;
            return {
                valid:out.temperature.length>0 || today.min!==null || today.max!==null,
                tempAvg:avg(out.temperature),
                tempMin:today.min!==null?today.min:hourlyMin,
                tempMax:today.max!==null?today.max:hourlyMax,
                tomorrowMin:tomorrow.min,
                tomorrowMax:tomorrow.max,
                clouds:avg(out.clouds),humidity:avg(out.humidity),wind:avg(out.wind),rainProbability:avg(out.rainProbability),
                samples:out.temperature.length,
                hourlyRoot,dailyRoot,
                hourChannels:Object.keys(byHour).length,
                hourlyStates:hourlyIds.length,dailyStates:dailyIds.length,
                todayDailyTemperatureValues:today.temperatureValues,tomorrowDailyTemperatureValues:tomorrow.temperatureValues
            };
        } catch(e){ this.log.debug(`dasWetter forecast read failed: ${e.message}`); return {valid:false,hourlyRoot,dailyRoot,error:e.message,samples:0,hourChannels:0}; }
    }

    async forecast() {
        const today=await this.getNum(this.config.pvForecastTodayState,1,"energyKWh");
        const rem=await this.getNum(this.config.pvForecastRemainingState,1,"energyKWh");
        const tomorrow=await this.getNum(this.config.pvForecastTomorrowState,1,"energyKWh");
        const next3=await this.getNum(this.config.pvForecastNext3hState,1,"energyKWh");
        let wx={valid:false,tempAvg:null,tempMin:null,tempMax:null,tomorrowMin:null,tomorrowMax:null,clouds:null,humidity:null,wind:null,rainProbability:null,samples:0,hourChannels:0};
        if(this.config.weatherSourceMode==="daswetter") wx=await this.readDasWetterForecast();
        else if(this.config.weatherSourceMode!=="none"){
            const tempNow=await this.getNum(this.config.weatherTempNowState), tempAvg=await this.getNum(this.config.weatherTempAvgState), tempMax=await this.getNum(this.config.weatherTempMaxState), clouds=await this.getNum(this.config.weatherCloudState);
            const t=tempAvg.valid?tempAvg.value:(tempNow.valid?tempNow.value:null);
            wx={valid:t!==null,tempAvg:t,tempMin:t,tempMax:tempMax.valid?tempMax.value:t,tomorrowMin:null,tomorrowMax:null,clouds:clouds.valid?clouds.value:null,humidity:null,wind:null,rainProbability:null,samples:t!==null?1:0,hourChannels:0};
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
            const heatingTemp=wx.tempMin!==null?(0.7*avgT+0.3*wx.tempMin):avgT;
            if (heatingTemp < Number(this.config.heatingBalanceTempC||15)) consumption += (Number(this.config.heatingBalanceTempC||15)-heatingTemp)*Number(this.config.heatingKWhPerK||0);
            const mx=wx.tempMax!==null?wx.tempMax:avgT;
            if (mx > Number(this.config.coolingBalanceTempC||24)) consumption += (mx-Number(this.config.coolingBalanceTempC||24))*Number(this.config.coolingKWhPerK||0);
            // Small weather correction: wind tends to raise heating demand; cloud cover lowers passive solar gains.
            if(avgT < Number(this.config.heatingBalanceTempC||15) && Number.isFinite(wx.wind)) consumption += Math.max(0,wx.wind-10)*0.03;
            if(avgT < Number(this.config.heatingBalanceTempC||15) && Number.isFinite(wx.clouds)) consumption += Math.max(0,wx.clouds-50)*0.005;
        }
        const pvToday=today.valid?today.value:0, pvRem=rem.valid?rem.value:0, pvTomorrow=tomorrow.valid?tomorrow.value:0;
        let consumptionTomorrow=baseline;
        if(wx.tomorrowMin!==null || wx.tomorrowMax!==null){
            const tMin=wx.tomorrowMin!==null?wx.tomorrowMin:wx.tomorrowMax;
            const tMax=wx.tomorrowMax!==null?wx.tomorrowMax:wx.tomorrowMin;
            const tAvg=(tMin+tMax)/2;
            const heatingTemp=0.7*tAvg+0.3*tMin;
            if(heatingTemp<Number(this.config.heatingBalanceTempC||15)) consumptionTomorrow+=(Number(this.config.heatingBalanceTempC||15)-heatingTemp)*Number(this.config.heatingKWhPerK||0);
            if(tMax>Number(this.config.coolingBalanceTempC||24)) consumptionTomorrow+=(tMax-Number(this.config.coolingBalanceTempC||24))*Number(this.config.coolingKWhPerK||0);
        }
        return {pvToday,pvRemaining:pvRem,pvTomorrow,pvNext3h:next3.valid?next3.value:0,temp:avgT,tempMin:wx.tempMin,tempMax:wx.tempMax,tomorrowMin:wx.tomorrowMin,tomorrowMax:wx.tomorrowMax,clouds:wx.clouds,humidity:wx.humidity,wind:wx.wind,rainProbability:wx.rainProbability,weatherSamples:wx.samples,weather:wx,consumption,consumptionTomorrow,balance:pvToday-consumption,balanceTomorrow:pvTomorrow-consumptionTomorrow};
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

        const cm=await this.batteryControlMeta();
        const quantity=cm.quantity;
        const manualCharge=Math.max(0,Number(this.config.batteryMaxChargeValue||0));
        const manualDischarge=Math.max(0,Number(this.config.batteryMaxDischargeValue||0));
        let dynamicCharge=await this.readLimitState(this.config.batteryDynamicMaxChargeState,quantity);
        let dynamicDischarge=await this.readLimitState(this.config.batteryDynamicMaxDischargeState,quantity);
        let effectiveCharge=manualCharge; let effectiveDischarge=manualDischarge;
        if(dynamicCharge!==null) effectiveCharge=Math.min(effectiveCharge,dynamicCharge);
        if(dynamicDischarge!==null) effectiveDischarge=Math.min(effectiveDischarge,dynamicDischarge);

        const status={layout:cm.layout,quantity,unit:cm.meta.unit||"",objectMin:cm.meta.min,objectMax:cm.meta.max,objectWritable:cm.meta.write,manualMaxCharge:manualCharge,manualMaxDischarge:manualDischarge,dynamicMaxCharge:dynamicCharge,dynamicMaxDischarge:dynamicDischarge,effectiveMaxCharge:effectiveCharge,effectiveMaxDischarge:effectiveDischarge,requestedChargeW:Math.round(chargeW),requestedDischargeW:Math.round(dischargeW),applied:null,warning:""};
        if(quantity==="unknown") { status.warning="Steuergröße konnte nicht erkannt werden"; decisions.push(`Batterie: ${status.warning}`); await this.setStateAsync("diagnostics.batteryControl",JSON.stringify(status),true); return 0; }
        if(quantity!=="boolean" && effectiveCharge<=0 && effectiveDischarge<=0) { status.warning="Maximale Lade-/Entladewerte sind 0"; decisions.push(`Batterie: ${status.warning}`); await this.setStateAsync("diagnostics.batteryControl",JSON.stringify(status),true); return 0; }

        if(this.config.batteryExternalEnableState) await this.write(this.config.batteryExternalEnableState,true,"external battery control enable");

        const voltsState=await this.getNum(this.config.batteryVoltageState);
        const volts=voltsState.valid&&voltsState.value>1?voltsState.value:Math.max(1,Number(this.config.batteryFixedVoltageV||400));
        const toControl=(powerW,direction)=>{
            const limit=direction==="charge"?effectiveCharge:effectiveDischarge;
            if(quantity==="power") return Math.min(limit,powerW);
            if(quantity==="current") return Math.min(limit,powerW/volts);
            if(quantity==="percent") {
                const ref=Number(direction==="charge"?this.config.batteryReferenceChargePowerW:this.config.batteryReferenceDischargePowerW)||0;
                if(ref<=0){status.warning=`Referenz-${direction==="charge"?"Lade":"Entlade"}leistung für Prozentsteuerung fehlt`;return 0;}
                return Math.min(limit,100*powerW/ref);
            }
            if(quantity==="boolean") return powerW>Number(this.config.gridReserveW||200);
            return 0;
        };
        let chargeVal=toControl(chargeW,"charge"), dischargeVal=toControl(dischargeW,"discharge");
        chargeVal=Math.round(Number(chargeVal)*100)/100; dischargeVal=Math.round(Number(dischargeVal)*100)/100;

        let appliedChargeControl=chargeVal;
        if(cm.layout==="single") {
            if(!cm.primary){status.warning="Bidirektionaler Sollwert fehlt"; appliedChargeControl=0;}
            else {
                let setpoint=0;
                if(chargeVal>0) setpoint=this.config.batteryControlSign==="chargePositive"?chargeVal:-chargeVal;
                else if(dischargeVal>0) setpoint=this.config.batteryControlSign==="chargePositive"?-dischargeVal:dischargeVal;
                setpoint=this.clampByObjectRange(setpoint,cm.meta);
                if(chargeVal>0) appliedChargeControl=Math.abs(setpoint); else appliedChargeControl=0;
                await this.write(cm.primary,setpoint,"battery bidirectional optimization");
                status.applied={state:cm.primary,value:setpoint};
            }
        } else {
            if(this.config.batteryChargeSetState){
                const meta=await this.sourceMeta(this.config.batteryChargeSetState);
                chargeVal=this.clampByObjectRange(chargeVal,meta);
                await this.write(this.config.batteryChargeSetState,chargeVal,"battery charge optimization");
            }
            if(this.config.batteryDischargeSetState){
                const meta=await this.sourceMeta(this.config.batteryDischargeSetState);
                dischargeVal=this.clampByObjectRange(dischargeVal,meta);
                await this.write(this.config.batteryDischargeSetState,dischargeVal,"battery discharge optimization");
            }
            appliedChargeControl=chargeVal;
            status.applied={chargeState:this.config.batteryChargeSetState||"",chargeValue:chargeVal,dischargeState:this.config.batteryDischargeSetState||"",dischargeValue:dischargeVal};
        }
        if(this.config.batteryExternalStatusState){ const st=await this.getAny(this.config.batteryExternalStatusState); status.externalStatus=st.valid?st.value:null; }
        status.voltageV=quantity==="current"?volts:null;
        const controlToPower=(value,direction)=>{
            if(quantity==="power") return Math.max(0,value);
            if(quantity==="current") return Math.max(0,value*volts);
            if(quantity==="percent") { const ref=Number(direction==="charge"?this.config.batteryReferenceChargePowerW:this.config.batteryReferenceDischargePowerW)||0; return Math.max(0,ref*value/100); }
            if(quantity==="boolean") return value?Math.max(0,Math.min(chargeW,surplusW)):0;
            return 0;
        };
        const allocatedChargeW=Math.min(surplusW,controlToPower(appliedChargeControl,"charge"));
        status.allocatedChargeW=Math.round(allocatedChargeW);
        await this.setStateAsync("diagnostics.batteryControl",JSON.stringify(status),true);
        decisions.push(`Batterie: ${quantity}, Laden ${chargeVal}, Entladen ${dischargeVal}${status.warning?` – ${status.warning}`:""}`);
        return Math.max(0,allocatedChargeW);
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
        await this.setStateAsync("forecast.pvTodayKWh",f.pvToday,true); await this.setStateAsync("forecast.pvRemainingKWh",f.pvRemaining,true); await this.setStateAsync("forecast.pvTomorrowKWh",f.pvTomorrow||0,true); await this.setStateAsync("forecast.consumptionTodayKWh",Math.round(f.consumption*10)/10,true); await this.setStateAsync("forecast.consumptionTomorrowKWh",Math.round((f.consumptionTomorrow||0)*10)/10,true); await this.setStateAsync("forecast.expectedBalanceKWh",Math.round(f.balance*10)/10,true); await this.setStateAsync("forecast.expectedBalanceTomorrowKWh",Math.round((f.balanceTomorrow||0)*10)/10,true);
        await this.setStateAsync("diagnostics.gridPowerW",Math.round(grid),true); await this.setStateAsync("diagnostics.pvPowerW",Math.round(pv.value||0),true); await this.setStateAsync("diagnostics.housePowerW",Math.round(house),true); await this.setStateAsync("diagnostics.batteryPowerW",Math.round(b.power||0),true); if(b.soc!==null)await this.setStateAsync("diagnostics.batterySoc",b.soc,true); if(f.temp!==null)await this.setStateAsync("diagnostics.weatherTempC",f.temp,true); if(f.tempMin!==null)await this.setStateAsync("diagnostics.weatherMinTempC",f.tempMin,true); if(f.tempMax!==null)await this.setStateAsync("diagnostics.weatherMaxTempC",f.tempMax,true); if(f.clouds!==null)await this.setStateAsync("diagnostics.weatherCloudsPct",f.clouds,true); if(f.humidity!==null)await this.setStateAsync("diagnostics.weatherHumidityPct",f.humidity,true); if(f.wind!==null)await this.setStateAsync("diagnostics.weatherWind",f.wind,true); if(f.tomorrowMin!==null)await this.setStateAsync("diagnostics.weatherTomorrowMinTempC",f.tomorrowMin,true); if(f.tomorrowMax!==null)await this.setStateAsync("diagnostics.weatherTomorrowMaxTempC",f.tomorrowMax,true); await this.setStateAsync("diagnostics.weatherStatus",JSON.stringify({source:this.config.weatherSourceMode||"none",base:this.config.dasWetterBasePath||"",location:this.config.dasWetterLocation||"",hourlyRoot:f.weather?.hourlyRoot||"",dailyRoot:f.weather?.dailyRoot||"",hourChannels:f.weather?.hourChannels||0,hourlyStates:f.weather?.hourlyStates||0,dailyStates:f.weather?.dailyStates||0,hourlyTemperatureSamples:f.weatherSamples||0,todayDailyTemperatureValues:f.weather?.todayDailyTemperatureValues||0,tomorrowDailyTemperatureValues:f.weather?.tomorrowDailyTemperatureValues||0,valid:!!f.weather?.valid,error:f.weather?.error||""}),true);
        const inputUnits={grid:await this.sourceUnit(this.config.gridPowerState),pv:await this.sourceUnit(this.config.pvPowerState),house:await this.sourceUnit(this.config.housePowerState),battery:await this.sourceUnit(this.config.batteryMeasurementMode==="meter"?this.config.batteryMeterPowerState:this.config.batteryPowerState),pvForecastToday:await this.sourceUnit(this.config.pvForecastTodayState),pvForecastRemaining:await this.sourceUnit(this.config.pvForecastRemainingState)}; await this.setStateAsync("diagnostics.inputUnits",JSON.stringify(inputUnits),true); await this.setStateAsync("diagnostics.dataValid",dataValid,true); await this.setStateAsync("diagnostics.measurementQuality",JSON.stringify({grid:gRaw.valid?"measured":"unknown",pv:pv.valid?"deviceReported":"unknown",battery:b.quality,house:houseCfg.valid?"measured":"derived"}),true); await this.setStateAsync("diagnostics.deviceMeasurements",JSON.stringify(deviceMeasurements),true); await this.setStateAsync("diagnostics.activeLoads",JSON.stringify(activeLoads.sort((a,b)=>a.priority-b.priority)),true); await this.setStateAsync("diagnostics.lastDecision",decisions.join(" | ").slice(0,10000),true); await this.setStateAsync("diagnostics.lastCycle",new Date().toISOString(),true);
    }

    onMessage(obj){ if(obj?.command==="getStatus" && obj.callback) this.sendTo(obj.from,obj.command,{ok:true,dryRun:!!this.config.dryRun},obj.callback); }
}
if (require.main !== module) module.exports = options => new EnergyPilot(options); else new EnergyPilot();
