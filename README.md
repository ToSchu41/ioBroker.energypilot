# ioBroker.energyPilot

**Energy Pilot** is a manufacturer-independent, predictive energy-management adapter for ioBroker.

Version **0.1.0** is the first functional foundation discussed for systems with PV generation, a grid meter, hybrid inverter / battery storage, heat pump, heating rod and air-conditioning units.

## Design principles

- No vendor lock-in: all device functions are mapped to freely selectable ioBroker states.
- Device safety remains inside the devices. Energy Pilot only provides optimization setpoints/releases.
- Missing energy meters are allowed. Measurement sources can be `external meter`, `device reported`, `estimated` or `none`.
- PV/storage may be configured together in the Admin UI while remaining logically separated internally.
- Weather and PV forecast values are read from existing ioBroker states (for example `dasWetter` or a PV forecast adapter); Energy Pilot does not call those APIs directly.
- Lower numerical priority means higher priority.

## V0.1 functions

- Grid meter and PV power acquisition with configurable grid-sign convention.
- Derived or directly measured house consumption.
- Optional PV forecast: today, remaining today, next 3 hours.
- Optional weather input: current/average/max temperature and cloud cover.
- Weather-aware daily consumption forecast with configurable heating/cooling coefficients and learned historical baseline.
- Battery SOC/power acquisition and generic external charge/discharge control by power, current, percent or boolean setpoints.
- Forecast-aware battery charging moderation.
- Heat-pump PV boost by boolean/SG-Ready-like state or by heating/hot-water target temperatures.
- Separate heating-rod surplus control.
- Multiple air-conditioning devices with PV pre-cooling/pre-heating.
- Hysteresis and delays for thermal loads.
- Per-device priorities.
- Dry-run commissioning mode.
- Diagnostic states with current balance, forecast, measurement quality, active flexible loads and decision reasons.

## Installation from GitHub

Upload this repository to GitHub, then install it in ioBroker from the GitHub/custom adapter installation function using the repository URL.

After installation, create an instance and configure it in the clearly separated Admin tabs.

**Keep `Dry run` enabled during initial commissioning.** Verify grid sign, power values and all target states before enabling writes.

## Admin areas

1. Central settings
2. PV & storage
3. Weather & forecasts
4. Heat pump
5. Heating rod
6. Air conditioning
7. Priorities & regulation
8. Diagnostics

## Measurement model

Each controllable device can use one of these energy measurement qualities:

- `measured` – external dedicated energy meter
- `deviceReported` – power value from the device or its ioBroker adapter
- `estimated` – configured/derived value
- `unknown` – no usable measurement

The adapter continues to operate when optional meters are absent.

## Battery control abstraction

Internally Energy Pilot reasons in power. A mapped system may accept:

- W (power)
- A (current; battery voltage state can be supplied)
- %
- boolean enable/disable

This keeps the core independent of KOSTAL/BYD or any other vendor combination.

## Important commissioning note

Different vendor states may interpret charge/discharge limits differently. V0.1 intentionally does not embed vendor-specific register semantics. Confirm the meaning, unit, limits and fail-safe behavior of every writable state in the source adapter/device documentation before disabling dry-run mode.

## Changelog

### 0.1.0 (2026-08-24)

- Initial Energy Pilot release.
- Manufacturer-independent device mapping and capability-oriented control foundation.
- PV/grid, storage, forecast/weather, consumption forecast, heat pump, heating rod, HVAC, priorities and diagnostics.

## License

MIT
