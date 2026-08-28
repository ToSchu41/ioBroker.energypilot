# Changelog

## 0.3.1 (2026-08-28)

- `dasWetter`-Forecastwerte werden nicht mehr mit dem globalen Echtzeit-Timeout (`staleSec`) verworfen
- Stundenwerte werden korrekt aus `ForecastHourly.Hour_1` bis `Hour_24` ausgelesen
- `time` wird als maßgebliche Uhrzeit der Stundenprognose ausgewertet (`Hour_1` = 01:00, `Hour_24` = 00:00)
- tatsächliche State-Namen `temperature`, `clouds`, `humidity`, `wind_speed`, `wind_gust`, `rain`, `rain_probability` werden verarbeitet
- Tageswerte aus `ForecastDaily.Day_1` (heute) und `Day_2` (morgen) werden anhand der realen Namen verarbeitet
- berücksichtigt werden `Temperature_Min`, `Temperature_Max`, `Humidity`, `Rain`, `Rain_Probability`, `Wind_Speed`, `Wind_Gust`, `sunshineduration`, `symbol`, `symbol_description` und `date`
- Wetterdiagnose um Beispielwerte für `Hour_1`/`Hour_24` sowie vollständige Tageskennwerte für heute und morgen erweitert
- Wetterwerte werden weiterhin als echte numerische ioBroker-States verarbeitet; die Anzeigeeinheit aus `common.unit` verändert den State-Wert nicht

## 0.3.0 (2026-08-28)

- automatische `dasWetter`-Anbindung auf die reale v4-Struktur `daswetter.0.location_1.ForecastHourly.Hour_x` korrigiert
- Standard-Standortkanal auf `location_1` geändert
- automatische Auswertung der Tagesprognosen `ForecastDaily.Day_1` (heute) und `Day_2` (morgen) ergänzt
- Tages-Minimum/-Maximum der Temperatur werden für Prognose und Diagnose berücksichtigt
- Wetterdiagnose um verwendete Pfade, gefundene Stundenkanäle und Tagesdaten erweitert
- externe Batteriesteuerung grundlegend erweitert und herstellerneutral abstrahiert
- ein gemeinsamer bidirektionaler Batteriestellwert oder getrennte Lade-/Entladestellwerte auswählbar
- Steuergröße kann automatisch aus `common.unit` erkannt werden (W/kW, A, %, Boolean) oder manuell vorgegeben werden
- Vorzeichenkonvention für bidirektionale Batteriestellwerte konfigurierbar
- maximale Lade- und Entladewerte werden als harte Grenzen vor jedem Schreibvorgang berücksichtigt
- `common.min` und `common.max` des Stellwert-Datenpunkts werden zusätzlich berücksichtigt
- optionale dynamische Lade-/Entladegrenzen aus Wechselrichter/BMS können eingebunden werden
- Prozentsteuerung um optionale Referenz-Lade-/Entladeleistung erweitert
- Stromsteuerung nutzt Batteriespannung oder einen konfigurierbaren Ersatzwert
- optionale Freigabe und Statusüberwachung der externen Batteriesteuerung vorbereitet
- neue Diagnose `diagnostics.batteryControl` zeigt erkannte Einheit, Steuergröße, Grenzen und ausgegebenen Sollwert
- deutsche README und GitHub-Kurzbeschreibung auf v0.3.0 aktualisiert

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
