"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const pkg=require("../package.json");
const io=require("../io-package.json");
const cfg=require("../admin/jsonConfig.json");

test("metadata versions match",()=>assert.equal(pkg.version,io.common.version));
test("adapter name matches",()=>{assert.equal(io.common.name,"energypilot");assert.equal(pkg.name,"iobroker.energypilot");});
test("dasWetter v4 defaults are correct",()=>{assert.equal(io.native.dasWetterBasePath,"daswetter.0");assert.equal(io.native.dasWetterLocation,"location_1");});
test("battery external control has hard limits",()=>{assert.ok(Object.hasOwn(io.native,"batteryMaxChargeValue"));assert.ok(Object.hasOwn(io.native,"batteryMaxDischargeValue"));assert.ok(cfg.items.pvStorage.items.batteryMaxChargeValue);assert.ok(cfg.items.pvStorage.items.batteryMaxDischargeValue);});
test("bidirectional battery control is configurable",()=>{assert.ok(cfg.items.pvStorage.items.batteryBidirectionalSetState);assert.ok(cfg.items.pvStorage.items.batteryControlSign);});
