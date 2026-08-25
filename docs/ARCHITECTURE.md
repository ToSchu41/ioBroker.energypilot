# Energy Pilot – Architektur v0.2.0

Energy Pilot trennt die gerätespezifische Datenpunktzuordnung konsequent von der zentralen Energiemanagement-Logik.

## Ebenen

1. **ioBroker-/Geräteadapter** stellen Mess- und Stellwerte bereit.
2. **Energy Pilot Eingangsschicht** liest Datenpunkte, prüft Alter und Einheit und normalisiert Leistungs-/Energiewerte.
3. **Prognoseschicht** kombiniert PV-Prognose, Wetterprognose und gelernte Verbrauchswerte.
4. **Prioritätslogik** verteilt verfügbare flexible Leistung nach konfigurierbaren Prioritäten.
5. **Gerätesteuerung** setzt nur die jeweils unterstützten Sollwerte/Freigaben.

## Herstellerneutralität

Es gibt keine fest verdrahtete KOSTAL-, BYD-, Wärmepumpen- oder Klimageräte-Logik. Geräte werden über frei wählbare ioBroker-Datenpunkte angebunden. Fehlende Messwerte oder Steuerfähigkeiten sind zulässig.

## Einheiten

Quellobjekte werden über `common.unit` ausgewertet. Leistung wird intern auf W und Energie auf kWh normalisiert. Die erkannten Einheiten werden in der Diagnose ausgegeben.

## Wetter

Für `ioBroker.daswetter` kann der 24-Stunden-Forecast automatisch aus `ForecastHourly.<Location>` gelesen werden. Dadurch müssen einzelne Stundenwerte nicht manuell verknüpft werden.

## Sicherheit

Energy Pilot ersetzt keine Schutz- oder Sicherheitsfunktion der angeschlossenen Geräte. Wechselrichter, Batterie-BMS, Wärmepumpe, Heizstabsteuerung und Klimageräte bleiben für ihre internen Grenzwerte und Schutzfunktionen verantwortlich.
