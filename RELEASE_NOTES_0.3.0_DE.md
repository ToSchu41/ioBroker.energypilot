# Energy Pilot v0.3.0 – Release Notes

## Schwerpunkt dieser Version

Version 0.3.0 verbessert insbesondere die Wetterprognose und die herstellerunabhängige externe Batteriesteuerung.

### dasWetter

- korrigierter Pfad für die aktuelle v4-Struktur
- Stundenprognose über `<Instanz>.<Standort>.ForecastHourly.Hour_x`
- Standard: `daswetter.0.location_1`
- Tagesprognose `Day_1` = heute
- Tagesprognose `Day_2` = morgen
- Tages-Minimum/-Maximum werden zusätzlich zur Stundenprognose ausgewertet
- erweiterte Wetterdiagnose mit tatsächlich verwendetem Pfad und Anzahl gefundener Forecast-Kanäle

### Externe Batteriesteuerung

- gemeinsamer bidirektionaler Sollwert oder getrennte Lade-/Entladesollwerte
- automatische Erkennung von W/kW, A, %, Boolean über `common.unit` / `common.type`
- manuelle Übersteuerung der erkannten Steuergröße möglich
- konfigurierbare Vorzeichenrichtung beim bidirektionalen Sollwert
- harte maximale Lade- und Entladegrenzen
- zusätzliche Berücksichtigung von `common.min` und `common.max`
- optionale dynamische Lade-/Entladegrenzen des Wechselrichters oder BMS
- Prozentsteuerung mit Referenzleistung
- Stromsteuerung mit gemessener oder fester Batteriespannung
- optionale Freigabe-/Statusdatenpunkte für externe Batteriesteuerung
- ausführliche Batteriesteuerungsdiagnose

## Wichtiger Hinweis beim Update

Die Batteriesteuerung wurde strukturell erweitert. Nach dem Update bitte die Einstellungen unter **PV & Batteriespeicher → Externe Batteriesteuerung** kontrollieren und den Adapter zunächst im **Testbetrieb (Dry Run)** betreiben.

Insbesondere prüfen:

- Art des Stellwerts: bidirektional oder getrennt
- erkannte/gewählte Steuergröße
- Vorzeichen Laden/Entladen
- maximale Ladegrenze
- maximale Entladegrenze
- Datenpunkte für Sollwerte

## GitHub-Kurzbeschreibung

Herstellerunabhängiges, vorausschauendes Energiemanagement für ioBroker mit PV, Batteriespeicher, Wärmepumpe, Heizstab, Klimaanlagen, Wetter-/PV-Prognosen, externer Batteriesteuerung und frei konfigurierbaren Prioritäten.
