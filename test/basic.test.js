"use strict";
const test=require("node:test"); const assert=require("node:assert/strict"); const pkg=require("../package.json"); const io=require("../io-package.json");
test("metadata versions match",()=>assert.equal(pkg.version,io.common.version));
test("adapter name matches",()=>{assert.equal(io.common.name,"energypilot");assert.equal(pkg.name,"iobroker.energypilot");});
