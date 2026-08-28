# Energy Pilot – ioBroker Energiemanagement

**Energy Pilot** ist ein herstellerunabhängiger ioBroker-Adapter für ein lokales, vorausschauendes Energiemanagement. Er koordiniert PV-Erzeugung, Batteriespeicher, Wärmepumpe, Heizstab und Klimaanlagen anhand des aktuellen Energieflusses, frei einstellbarer Prioritäten sowie PV-, Wetter- und Verbrauchsprognosen.

> **Version 0.3.1:** Entwicklungs- und Testversion. Der Testbetrieb ist standardmäßig aktiv, sodass nach der Installation zunächst keine Stellwerte an Geräte geschrieben werden.

## Grundprinzip

Energy Pilot übernimmt die übergeordnete Energieoptimierung. Schutz-, Sicherheits- und geräteinterne Regelungsfunktionen verbleiben vollständig in Wechselrichter, Batteriesystem, Wärmepumpe, Klimaanlage und weiteren Geräten.

Die Geräteanbindung erfolgt über frei zuordenbare ioBroker-Datenpunkte. Dadurch bleibt der Regelkern herstellerunabhängig.

## Unterstützte Bereiche

### PV & Netz

- zentraler Energiemeter am Netzanschlusspunkt
- frei konfigurierbare Vorzeichenrichtung für Bezug/Einspeisung
- aktuelle PV-Leistung
- optionaler direkter Hausverbrauch
- automatische Normalisierung von W/kW/MW
- Ableitung des Hausverbrauchs aus PV, Netz und Batterie, wenn kein eigener Messwert vorhanden ist

### Batteriespeicher / Hybrid-Wechselrichter

- Batterie-SOC
- aktuelle Batterieleistung
- geräteeigene, externe, geschätzte oder keine Leistungsmessung
- optionaler externer Energiemeter
- Min-SOC, Reserve-SOC, Ziel-SOC und Max-SOC
- prognoseabhängige Ladeoptimierung

#### Externe Batteriesteuerung

Energy Pilot unterstützt zwei herstellerunabhängige Varianten:

1. **ein gemeinsamer bidirektionaler Sollwert** mit Vorzeichen
2. **getrennte Sollwerte** für Laden und Entladen

Die Steuergröße kann automatisch aus `common.unit` erkannt oder manuell gewählt werden:

- Leistung: W / kW
- Strom: A
- relativ: %
- Boolean: Ein/Aus

Bei einem bidirektionalen Sollwert kann eingestellt werden:

- negativ = Laden / positiv = Entladen
- positiv = Laden / negativ = Entladen

Damit lassen sich unter anderem Hybrid-Wechselrichter mit einem absoluten DC-Leistungssollwert abbilden, ohne KOSTAL- oder andere herstellerspezifische Logik in den Regelkern einzubauen.

#### Harte Lade- und Entladegrenzen

Vor jedem Schreibvorgang berücksichtigt Energy Pilot:

- manuell konfigurierte maximale Ladegrenze
- manuell konfigurierte maximale Entladegrenze
- `common.min` / `common.max` des schreibbaren ioBroker-Objekts, sofern vorhanden
- optionale dynamische Ladegrenze des Wechselrichters/BMS
- optionale dynamische Entladegrenze des Wechselrichters/BMS
- SOC-Grenzen und Reserve

Bei einer konfigurierten Maximalgrenze von `0` wird für die betreffende Richtung keine Leistungsanforderung ausgegeben.

Für Prozentsteuerungen können Referenz-Lade- und Entladeleistungen in W hinterlegt werden. Bei Stromsteuerung kann die aktuelle Batteriespannung aus einem Datenpunkt gelesen oder ein Ersatzwert verwendet werden.

Optional können außerdem Datenpunkte für die Freigabe und den Status der externen Batteriesteuerung zugeordnet werden.

### PV-Prognose

Energy Pilot verwendet vorhandene Prognosedaten aus beliebigen ioBroker-Adaptern. Vorgesehen sind:

- PV-Energie heute
- PV-Energie Rest des Tages
- PV-Energie morgen
- aktuelle prognostizierte PV-Leistung
- installierte PV-Leistung
- optional PV-Energie der nächsten drei Stunden

Energieeinheiten Wh/kWh/MWh und Leistungseinheiten W/kW/MW werden automatisch normalisiert.

### Wetterprognose – ioBroker `dasWetter`

Die automatische Anbindung ist auf die aktuelle v4-Struktur des Adapters ausgelegt.

Beispielkonfiguration:

```text
dasWetter-Instanz: daswetter.0
Standortkanal:     location_1
```

Energy Pilot liest automatisch:

```text
daswetter.0.location_1.ForecastHourly.Hour_1
daswetter.0.location_1.ForecastHourly.Hour_2
...
```

Aus den verfügbaren Stunden werden unter anderem ausgewertet:

- Temperatur
- Bewölkung
- Luftfeuchtigkeit
- Windgeschwindigkeit
- Niederschlagswahrscheinlichkeit

Zusätzlich werden die Tagesübersichten verarbeitet:

```text
daswetter.0.location_1.ForecastDaily.Day_1   = heute
daswetter.0.location_1.ForecastDaily.Day_2   = morgen
```

Die Tageswerte ergänzen die Stundenprognose insbesondere um Tages-Minimum und Tages-Maximum der Temperatur, sofern diese Werte vom Adapter bereitgestellt werden. Falls ein Tages-Min/Max nicht erkannt wird, verwendet Energy Pilot die Min-/Max-Werte aus den Stundenprognosen des aktuellen Tages.

Im Diagnosebereich werden der tatsächlich verwendete Stunden- und Tagespfad sowie die Anzahl gefundener Forecast-Kanäle ausgegeben.

### Verbrauchsprognose

Die Verbrauchsprognose kann berücksichtigen:

- Grundverbrauch
- gelernte historische Tagesverbräuche
- mittlere Außentemperatur
- Tagesminimum und Tagesmaximum
- Heizgrenztemperatur
- Kühlgrenztemperatur
- Bewölkung
- Wind

Damit wird nicht nur die erwartete PV-Erzeugung, sondern auch der voraussichtliche Energiebedarf betrachtet.

### Wärmepumpe

- PV-Boost / Freigabe oder Solltemperatursteuerung
- separate Priorität
- Heiz- und Warmwasser-Sollwerte
- Hysterese sowie Ein-/Ausschaltverzögerungen
- geräteeigene oder externe Leistungsmessung
- optionaler Energiemeter

Der normale Heiz- und Schutzbetrieb verbleibt in der Wärmepumpe.

### Heizstab

- eigener flexibler Verbraucher
- eigene Priorität
- Mindestüberschuss
- Ein-/Ausschaltverzögerungen
- maximale Laufzeit
- optionaler Energiemeter

### Klimaanlagen

- mehrere Klimaanlagen konfigurierbar
- individuelle Prioritäten
- PV-Vorkühlen und PV-Vorheizen
- Normal- und PV-Solltemperaturen
- Betriebsmodussteuerung
- optionale geräteeigene oder externe Energiemessung
- breite, horizontal scrollbare Konfigurationstabelle

## Prioritäten

Kleinere Zahlen bedeuten eine höhere Priorität. Energy Pilot verteilt die aktuell verfügbare flexible Überschussleistung in dieser Reihenfolge.

Die Prioritäten können unabhängig für Wärmepumpe, Batteriespeicher, Klimaanlagen und Heizstab eingestellt werden.

## Admin-Oberfläche

Die Konfiguration ist vollständig deutsch vorbereitet und in eigene Bereiche gegliedert:

1. Zentrale Einstellungen
2. PV & Batteriespeicher
3. Wetter & Prognosen
4. Wärmepumpe
5. Heizstab
6. Klimaanlagen
7. Prioritäten & Regelung
8. Diagnose

Optionale Werte sind direkt in Bezeichnung oder Beschreibung als **Optional** gekennzeichnet. Abhängige Felder werden soweit möglich nur angezeigt, wenn die entsprechende Funktion verwendet wird. Große Datenpunktfelder erhalten die volle Breite.

## Diagnose

Energy Pilot stellt unter anderem folgende Informationen bereit:

- Netz-, PV-, Haus- und Batterieleistung
- erkannte Quelleinheiten
- Messqualität
- aktuelle flexible Lasten
- Wetterpfade und Anzahl gefundener Forecast-Kanäle
- Tages-Min/Max heute und morgen
- Status der externen Batteriesteuerung
- erkannte Steuergröße und Einheit
- `common.min` / `common.max` des Stellwertobjekts
- manuelle und dynamische Lade-/Entladegrenzen
- tatsächlich ausgegebener Batteriestellwert
- letzte Regelentscheidung

## Installation über GitHub

Repository-Name:

```text
ioBroker.energypilot
```

Nach der Installation sollte Energy Pilot zunächst im **Testbetrieb (Dry Run)** betrieben werden. Prüfe insbesondere:

- Vorzeichen der Netzleistung
- Vorzeichen der Batterieleistung
- Vorzeichen eines bidirektionalen Batteriestellwertes
- Einheiten
- maximale Lade-/Entladegrenzen
- Wetterpfad und gefundene Forecast-Daten

Erst danach sollte das Schreiben von Stellwerten freigegeben werden.

## Entwicklungsstand

Energy Pilot befindet sich in aktiver Entwicklung. Schreibzugriffe auf Wechselrichter, Speicher, Wärmepumpen und Klimageräte müssen vor dem produktiven Betrieb mit den jeweiligen Geräteschnittstellen geprüft werden.

## Lizenz

MIT
