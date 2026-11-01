# Energy Pilot – Architektur v0.3.2

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

Für `ioBroker.daswetter` kann der 24-Stunden-Forecast automatisch aus `<Basis>.<Standort>.ForecastHourly.Hour_1..Hour_24` gelesen werden. Dadurch müssen einzelne Stundenwerte nicht manuell verknüpft werden.

## Sicherheit

Energy Pilot ersetzt keine Schutz- oder Sicherheitsfunktion der angeschlossenen Geräte. Wechselrichter, Batterie-BMS, Wärmepumpe, Heizstabsteuerung und Klimageräte bleiben für ihre internen Grenzwerte und Schutzfunktionen verantwortlich.


## Steuerverträge und Grenzen

`lib/battery-control.js` kapselt die Batterieplanung und Stellwertkonvertierung. Intern gelten W/A/%, an der Schreibgrenze die Objekteinheiten. Vorabprüfung verhindert richtungsfalsche Werte, unzulässige Nullvorgaben und Schreibzugriffe auf Read-only-Objekte. Getrennte Ausgänge werden vorab beide geprüft und dann sequenziell geschrieben; ein Schreibfehler bricht die Sequenz ab. Dynamische Grenzen werden je Zyklus gelesen. Objektmetadaten werden pro Adapterlauf zwischengespeichert; nach Änderungen an Einheit, Schreibbarkeit oder common.min/max den Adapter neu starten.

`lib/weather-time.js` interpretiert Uhrzeiten und Kanal-Fallbacks. Hour_24 bezeichnet 00:00, nicht pauschal die nächste Stunde oder den nächsten Tag. Wetteraggregate verwenden die vorhandenen gültigen Stunden, keine daraus abgeleitete mehrtägige Zeitachse. Tagesdaten liefern heute/morgen. Prognosen verwenden ein eigenes Alterslimit; Live-Messwerte bleiben zeitkritisch.

`lib/device-capabilities.js` enthält einen deklarativen Wallbox-Vertrag: Ladefreigabe, Strom-/Leistungsvorgabe, optionale Phasenumschaltung, Fahrzeugverbindung, Messwerte/Energiemeter und SOC. Planungsfelder reservieren Priorität, Abfahrt, Ziel-SOC, PV-Modus, Stromgrenzen, Verzögerungen, Netzbezug und Batterie-Verhalten. Es existiert noch kein Wallbox-Treiber und kein aktiver Ladeplaner. Bestehende WP-/Klima-/Heizstabfunktionen bleiben über frei zugeordnete States herstellerneutral.

Der Klima-Zustand speichert den zuletzt geboosteten Heiz-/Kühlmodus flüchtig. Ein späterer Override kann darauf Besitz und Rückgabe der Sollwerte aufbauen; aktuell gewinnt die Automatik. Messmodi Gerät, externer Meter und Schätzung bleiben explizit konfigurierbar.

Die Verteilung arbeitet ausschließlich mit strikter Priorität (kleinere Zahl zuerst). Der historische Wert `allocationStrategy=minimum` ist kompatibel lesbar, hat aber keine eigene Mindestbedarfslogik. `batteryExternalTimeoutSec` ist ein Diagnosehinweis, kein Software-Watchdog. Bei ungültigen Netz-/PV-Daten werden keine neuen Stellwerte geschrieben. Geräteseitige Fallbacks bleiben erforderlich.
