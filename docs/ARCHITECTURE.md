# Energy Pilot architecture

Energy Pilot deliberately separates **device mapping** from **energy strategy**.

```text
Existing ioBroker adapters / Modbus / MQTT / KNX
                    |
                    v
             Device mappings
                    |
                    v
         Normalized Energy Pilot model
                    |
        +-----------+-----------+
        |                       |
        v                       v
 Forecast / learning      Priority allocator
        |                       |
        +-----------+-----------+
                    |
                    v
            Generic setpoints
                    |
                    v
             Device adapters
```

## Rule

Safety, equipment protection and primary device control remain in the individual devices. Energy Pilot only optimizes flexible power demand and battery limits.

## Measurement quality

Each device may independently use an external energy meter, a device-reported power value, an estimate, or no measurement. Missing meters do not prevent operation.

## Priorities

Lower numerical values mean higher priority. The allocator walks flexible functions in priority order and removes the expected allocated power from the currently available PV surplus before the next function is evaluated.
