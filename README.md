# Energy Pilot – ioBroker Energiemanagement

**Energy Pilot** ist ein herstellerunabhängiger ioBroker-Adapter für ein lokales, vorausschauendes Energiemanagement. Er koordiniert PV-Erzeugung, Batteriespeicher und flexible elektrische Verbraucher anhand des aktuellen Energieflusses, frei einstellbarer Prioritäten sowie PV-, Wetter- und Verbrauchsprognosen.

> **Version 0.2.0:** frühe Entwicklungs- und Testversion. Der Testbetrieb ist standardmäßig aktiv, sodass zunächst keine Stellwerte an Geräte geschrieben werden.

## Ziele

- lokale, herstellerunabhängige Steuerung über vorhandene ioBroker-Datenpunkte
- Geräte behalten ihre eigenen Schutz- und Sicherheitsfunktionen
- frei veränderbare Prioritäten für flexible Verbraucher
- tatsächliche Verbrauchsmessung über optionale Energiemeter
- vorausschauende Batterie-, Wärme- und Klimasteuerung
- übersichtliche, deutschsprachige Admin-Oberfläche

## Unterstützte Bereiche

### PV & Batteriespeicher
- Netzleistung am zentralen Energiemeter
- aktuelle PV-Leistung
- Hybrid-Wechselrichter oder getrennte PV-/Speichersysteme über freie Datenpunktzuordnung
- Batterie-SOC und Batterieleistung
- externe Lade- und Entladevorgaben als Leistung, Strom, Prozent oder Boolean
- Min-, Reserve-, Ziel- und Max-SOC
- prognoseabhängige Ladeoptimierung
- optionale externe Energiemeter

### Wetter & Prognosen
- vorhandene PV-Prognosedaten aus beliebigen ioBroker-Adaptern
- heute, Rest des Tages, morgen, aktuelle Leistungsprognose und optional 3-Stunden-Prognose
- automatische Einheitenumrechnung von Wh/kWh/MWh
- automatische 24-Stunden-Auswertung von **ioBroker.daswetter** über einen einzigen Basispfad
- Temperatur, Bewölkung, Luftfeuchtigkeit, Wind und Niederschlagswahrscheinlichkeit
- wetterabhängige Verbrauchsprognose
- lernbarer historischer Grundverbrauch

### Wärmepumpe
- PV-Boost / SG-Ready oder Temperatur-Sollwerte
- eigener Prioritätswert
- Ein-/Ausschalthysterese und Verzögerungen
- optionale Messwerte und optionaler externer Energiemeter

### Heizstab
- separater flexibler Verbraucher mit eigener Priorität
- Überschussschwellen und Zeitbedingungen
- optionaler Energiemeter

### Klimaanlagen
- beliebig viele Geräte
- PV-Vorkühlen und PV-Vorheizen
- Solltemperaturen und Betriebsmodi
- individuelle Prioritäten und Schaltschwellen
- geräteeigene, externe, geschätzte oder keine Leistungsmessung

## Einheiten

Energy Pilot liest bei verknüpften ioBroker-Objekten `common.unit` aus und normalisiert wichtige Größen intern:

- Leistung: W, kW, MW → **W**
- Energie: Wh, kWh, MWh → **kWh**
- SOC: **%**
- Temperatur: **°C**
- Strom: **A**
- Spannung: **V**

Die erkannte Quelleinheit wird zusätzlich in den Diagnose-Datenpunkten ausgegeben.

## Admin-Oberfläche

Die Konfiguration ist in eigene Bereiche gegliedert:

1. Zentrale Einstellungen
2. PV & Batteriespeicher
3. Wetter & Prognosen
4. Wärmepumpe
5. Heizstab
6. Klimaanlagen
7. Prioritäten & Regelung
8. Diagnose

Optionale Werte sind direkt als **Optional** gekennzeichnet. Abhängige Felder werden nur angezeigt, wenn die zugehörige Funktion aktiviert bzw. ausgewählt ist. Datenpunktfelder verwenden die volle Seitenbreite; große Gerätetabellen sind bewusst breit und horizontal scrollbar statt Spalten zusammenzuquetschen.

## dasWetter

Bei Auswahl von `Automatisch aus ioBroker dasWetter` genügt beispielsweise:

```text
daswetter.0
```

Energy Pilot sucht darunter die Stundenwerte aus `ForecastHourly` und bildet automatisch Tageskennzahlen. Es ist keine manuelle Zuordnung von 24 einzelnen Stundenwerten notwendig.

## Prioritäten

Kleinere Prioritätswerte bedeuten eine höhere Priorität. Energy Pilot verteilt die verfügbare Überschussleistung in dieser Reihenfolge an flexible Funktionen. Die normale interne Regelung von Wärmepumpe, Batterie, Klimaanlage und Wechselrichter bleibt unangetastet.

## Installation über GitHub

Repository:

```text
ioBroker.energypilot
```

Nach der Installation sollte die erste Inbetriebnahme im **Testbetrieb** erfolgen. Erst nach Prüfung von Vorzeichen, Einheiten und Diagnosewerten sollte das Schreiben von Sollwerten freigegeben werden.

## Entwicklungsstand

Energy Pilot befindet sich in aktiver Entwicklung. Für produktive Installationen sollten Schreibzugriffe zunächst sorgfältig mit den jeweiligen Geräteschnittstellen getestet werden.

## Lizenz

MIT
