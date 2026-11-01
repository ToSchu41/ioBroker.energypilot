"use strict";

// Declarative contract only: no wallbox is instantiated or controlled in 0.3.2.
const wallboxCapabilities = Object.freeze([
    "canEnableCharging", "canSetCurrent", "canSetPower", "canSwitchPhases",
    "hasVehicleConnected", "hasActualPower", "hasActualCurrent", "hasEnergyMeter", "hasVehicleSoc"
]);
const wallboxPlanningFields = Object.freeze([
    "priority", "departureTime", "targetSoc", "batteryCapacityKWh", "pvSurplusOnly",
    "minCurrentA", "maxCurrentA", "phases", "onDelaySec", "offDelaySec",
    "allowHomeBatteryDischarge", "allowedGridImportW"
]);
module.exports = { wallboxCapabilities, wallboxPlanningFields };
