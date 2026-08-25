# Changelog

## 0.2.0 (2026-08-25)

- Admin-Oberfläche in allen Bereichen neu strukturiert und optisch entzerrt
- optionale Werte direkt als „Optional“ gekennzeichnet und mit Hilfetexten versehen
- abhängige Einstellungen werden nur bei aktivierter Funktion angezeigt
- Datenpunktfelder erhalten mehr Breite
- Klimaanlagen-Tabelle vollständig deutsch, deutlich breitere Spalten und horizontal scrollbar
- automatische Erkennung und Normalisierung von W/kW/MW sowie Wh/kWh/MWh
- erkannte Eingangseinheiten in der Diagnose
- PV-Prognose um morgen, aktuelle Leistungsprognose und installierte Leistung vorbereitet
- automatische Auswertung des 24-Stunden-Forecasts von ioBroker.daswetter über einen Basispfad
- Wetterkennzahlen um Minimum/Maximum, Bewölkung, Luftfeuchtigkeit und Wind erweitert
- Verbrauchsprognose berücksichtigt Wetterdaten zusätzlich


## 0.1.1 - 2026-08-24

- German is now the default language of the admin configuration.
- Complete German labels, help texts and option names for the current jsonConfig UI.
- English remains available through i18n translations.
- German default device names for battery, heat pump and heating rod.

## 0.1.0 - 2026-08-24

- Initial Energy Pilot adapter foundation.
- Manufacturer-independent mapping of PV/grid, battery storage, heat pump, heating rod and multiple HVAC units.
- Optional energy meters per device.
- PV/weather forecast inputs and weather-aware consumption forecast.
- Priority-based allocation of available PV surplus.
- Forecast-aware battery control abstraction.
- Hysteresis and delays for thermal consumers.
- Dry-run commissioning and diagnostic states.
