"use strict";

// Canonical quantities: W, A, %, boolean. Object ranges use object units.
const numeric = value => value !== null && value !== undefined && value !== "" && typeof value !== "boolean" && Number.isFinite(Number(value));
function factor(unit, quantity) {
    const u = String(unit || "").trim().toLowerCase();
    if (quantity === "power") return u === "kw" ? 1000 : u === "mw" ? 1000000 : 1;
    if (quantity === "current") return u === "ma" ? 0.001 : 1;
    return 1;
}
function encode(value, meta, quantity) {
    if (!meta.write) throw new Error("Stellwert ist nicht schreibbar");
    if (quantity === "boolean") {
        if (meta.type !== "boolean") throw new Error("Boolean-Stellwert benötigt common.type boolean");
        return !!value;
    }
    if (meta.type !== "number") throw new Error("Numerischer Stellwert benötigt common.type number");
    const scale = factor(meta.unit, quantity);
    let raw = value / scale;
    // Never raise a request to common.min or cross zero to satisfy an object range.
    if (numeric(meta.min) && raw < Number(meta.min)) {
        if (raw >= 0 || Number(meta.min) > 0) throw new Error("Sollwert unter common.min; keine sichere Nullvorgabe möglich");
        raw = Number(meta.min);
    }
    if (numeric(meta.max) && raw > Number(meta.max)) {
        if (raw <= 0 || Number(meta.max) < 0) throw new Error("Sollwert über common.max; keine sichere Nullvorgabe möglich");
        raw = Number(meta.max);
    }
    return raw === 0 ? 0 : raw;
}

async function batteryControl(surplusW, gridW, b, f, decisions) {
    if (!b.enabled || !this.config.batteryChargeControlEnabled) return 0;
    const c = this.config;
    const status = { applied: null, warning: "", allocatedChargeW: 0 };
    try {
        const layout = c.batteryControlLayout || "single";
        const ids = layout === "single" ? [c.batteryBidirectionalSetState] : [c.batteryChargeSetState, c.batteryDischargeSetState];
        if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error("Eindeutige Lade-/Entladestellwerte fehlen");
        const metas = await Promise.all(ids.map(id => this.sourceMeta(id)));
        const quantities = metas.map(meta => c.batteryControlQuantity && c.batteryControlQuantity !== "auto" ? c.batteryControlQuantity : this.detectControlQuantity(meta.unit, meta.type));
        const quantity = quantities[0];
        if (!quantity || quantities.some(q => q !== quantity)) throw new Error("Steuergrößen unbekannt oder unterschiedlich");
        if (layout === "single" && quantity === "boolean") throw new Error("Boolean benötigt getrennte Freigaben für Laden und Entladen");
        metas.forEach(meta => {
            const detected = this.detectControlQuantity(meta.unit, meta.type);
            if (detected && detected !== quantity) throw new Error("Steuergröße widerspricht Objekteinheit");
            encode(quantity === "boolean" ? false : 0, meta, quantity);
        });
        const limits = [c.batteryMaxChargeValue, c.batteryMaxDischargeValue].map(v => {
            if (!numeric(v) || Number(v) < 0) throw new Error("Endliche harte Maximalgrenzen erforderlich");
            return Number(v);
        });
        const dynamicIds = [c.batteryDynamicMaxChargeState, c.batteryDynamicMaxDischargeState];
        for (let i = 0; i < 2; i++) {
            if (!dynamicIds[i]) continue;
            const x = await this.getNum(dynamicIds[i]);
            const meta = await this.sourceMeta(dynamicIds[i]);
            if (!x.valid || !numeric(x.value) || x.value < 0 || this.detectControlQuantity(meta.unit, meta.type) !== quantity) {
                limits[i] = 0;
                status.warning = "Dynamische Grenze ungültig/veraltet: betroffene Richtung gesperrt";
            } else limits[i] = Math.min(limits[i], x.value * factor(meta.unit, quantity));
        }
        const voltage = await this.getNum(c.batteryVoltageState);
        const volts = voltage.valid && voltage.value > 0 ? voltage.value : Number(c.batteryFixedVoltageV);
        if (quantity === "current" && (!Number.isFinite(volts) || volts <= 0)) throw new Error("Gültige Batteriespannung erforderlich");
        const refs = [Number(c.batteryReferenceChargePowerW), Number(c.batteryReferenceDischargePowerW)];
        if (quantity === "percent" && refs.some(v => !Number.isFinite(v) || v <= 0)) throw new Error("Referenzleistungen für Prozentsteuerung erforderlich");
        const socValid = b.socValid && Number.isFinite(b.soc) && b.soc >= 0 && b.soc <= 100;
        let chargeW = socValid && b.soc < Number(c.batteryMaxSoc ?? 100) ? Math.max(0, surplusW) : 0;
        const dischargeW = socValid && b.soc > Number(c.batteryReserveSoc ?? 20) && chargeW === 0 ? Math.max(0, gridW) : 0;
        if (c.batteryForecastControl && f.pvRemaining > 0 && b.soc >= Number(c.batteryMinSoc ?? 10)) {
            const gap = Math.max(0, Number(c.batteryTargetSoc ?? 80) - b.soc) / 100;
            if (Math.max(0, f.pvRemaining - Math.max(0, f.consumption * 0.5)) > gap * 10) chargeW *= 0.45;
        }
        const toControl = (w, i) => quantity === "boolean" ? w > Number(c.gridReserveW ?? 200) && limits[i] >= 1 : Math.min(limits[i], quantity === "power" ? w : quantity === "current" ? w / volts : Math.min(100, 100 * w / refs[i]));
        const requested = [toControl(chargeW, 0), toControl(dischargeW, 1)];
        const sign = c.batteryControlSign === "chargePositive" ? 1 : -1;
        const values = layout === "single" ? [encode(sign * (requested[0] || -requested[1]), metas[0], quantity)] : requested.map((v, i) => encode(v, metas[i], quantity));
        if (values.some(v => typeof v !== "boolean" && !Number.isFinite(v))) throw new Error("Ungültiger Sollwert");
        if (c.batteryExternalEnableState) {
            const enableMeta = await this.sourceMeta(c.batteryExternalEnableState);
            const enableValue = c.batteryExternalEnableValue ?? true;
            if (!enableMeta.write || typeof enableValue !== enableMeta.type || (typeof enableValue === "number" && (!Number.isFinite(enableValue) || encode(enableValue, enableMeta, "power") !== enableValue))) throw new Error("Externe Freigabe passt nicht zum schreibbaren Zielobjekt");
        }
        // In separate mode, clear the inactive direction before enabling the other.
        const order = layout === "single" ? [0] : requested[0] ? [1, 0] : [0, 1];
        for (const i of order) if (await this.write(ids[i], values[i], "Batterieoptimierung") === false) throw new Error("Schreiben des Batteriesollwerts fehlgeschlagen");
        if (c.batteryExternalEnableState && await this.write(c.batteryExternalEnableState, c.batteryExternalEnableValue ?? true, "Externe Batteriesteuerung") === false) throw new Error("Externe Freigabe fehlgeschlagen");
        const applied = layout === "single" ? Math.max(0, values[0] * sign) : values[0];
        const canonical = quantity === "boolean" ? applied : applied * factor(metas[0].unit, quantity);
        status.allocatedChargeW = Math.min(chargeW, quantity === "power" ? canonical : quantity === "current" ? canonical * volts : quantity === "percent" ? canonical * refs[0] / 100 : canonical ? chargeW : 0);
        Object.assign(status, { layout, quantity, effectiveLimits: limits, objects: metas, requestedChargeW: chargeW, requestedDischargeW: dischargeW, applied: ids.map((id, i) => ({ state: id, value: values[i], unit: metas[i].unit })), socValid, dryRun: !!c.dryRun, expectedDeviceTimeoutSec: c.batteryExternalTimeoutSec || 0 });
        if (c.batteryExternalStatusState) { const st = await this.getAny(c.batteryExternalStatusState); status.externalStatus = st.valid ? st.value : null; }
    } catch (e) { status.warning = e.message; }
    await this.setStateAsync("diagnostics.batteryControl", JSON.stringify(status), true);
    decisions.push(`Batterie: ${status.warning || "Sollwerte berechnet"}`);
    return status.allocatedChargeW;
}
module.exports = { batteryControl, encode, factor, numeric };
