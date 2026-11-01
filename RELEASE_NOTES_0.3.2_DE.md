# Energy Pilot 0.3.2

Diese Version korrigiert die herstellerneutrale Batterieansteuerung und ergänzt Verhaltenstests. Wärmepumpe, Heizstab, optionale Gerätemeter und Prioritätsverteilung bleiben Bestandteil des Adapters.

- Batterie: interne W/A/% werden vor jedem Sollwert in die jeweilige Objekteinheit zurückgerechnet, einschließlich kW und mA. Getrennte Stellwerte dürfen unterschiedliche Einheiten derselben Steuergröße haben.
- Schreibbarkeit, numerischer/Boolean-Typ und beide Objektbereiche werden vor den Stellwertschreibvorgängen geprüft. Eine positive Untergrenze darf keine unbeabsichtigte Mindestladung erzwingen. Die inaktive Richtung wird zuerst zurückgesetzt.
- Harte manuelle Grenzen bleiben in W, A oder %. 0 sperrt eine Richtung. Bei Boolean gelten 0/1 als Freigabegrenzen; eine physische Leistungsbegrenzung ist damit nicht möglich und muss im Gerät eingestellt sein. Boolean benötigt zwei getrennte Freigaben.
- Konfigurierte dynamische BMS-/WR-Grenzen begrenzen zusätzlich; fehlende, negative, widersprüchliche oder veraltete Werte sperren die betreffende Richtung. Ohne konfigurierten dynamischen Eingang gilt die manuelle Grenze.
- Prognosen haben ein eigenes Alterslimit `forecastMaxAgeHours` (Standard 48 h). Echtzeitwerte behalten `staleSec`. Null, leere Werte, Boolean und Infinity gelten nicht als numerische Messwerte.
- dasWetter: `time` bestimmt die Sortierung; ohne gültige Uhrzeit gilt Hour_1 = 01:00 und Hour_24 = 00:00. Es handelt sich um Uhrzeiten, nicht um relative Stunden ab jetzt. `temperature_feels_like` und explizite Boolean-Auswertung von `night` ergänzt.
- Klima: Der letzte PV-Heiz-/Kühlmodus wird im Arbeitsspeicher gemerkt, damit nach der Ausschaltverzögerung auch bei geänderter Wetterlage der passende normale Sollwert wiederhergestellt wird. Manuelle Overrides bleiben vorgemerkt.
- Keine überlappenden Regelzyklen. Ungültige Echtzeitdaten werden nicht als Nullverbrauch angelernt. `targetGridW` und eine Reserve von 0 W werden berücksichtigt.
- Deklarativer Wallbox-Vertrag in `lib/device-capabilities.js`; keine aktive go-e- oder Wallbox-Ansteuerung.
- Verhaltenstests und GitHub Actions für Node 20/22/24. Die Admin-Auswahl bietet ausschließlich die tatsächlich implementierte Prioritätsstrategie an.

## Aktualisierung und Prüfung

Vorhandene Datenpunktzuordnungen bleiben erhalten. Harte Grenzen auf W/A/% prüfen, auch wenn das Zielobjekt kW/mA verwendet. Für Boolean bisherige Konfiguration auf getrennte Freigaben und explizite 0/1-Grenzen umstellen. Bei Prozentsteuerung sind beide Referenzleistungen erforderlich. Zunächst `dryRun` und `diagnostics.batteryControl` prüfen.

Die automatisierten Tests verwenden eine simulierte ioBroker-Schnittstelle. Ein Test mit echtem js-controller, Admin-Oberfläche und Hardware steht aus. Bei ungültigen Netz-/PV-Daten werden wie bisher keine neuen Gerätebefehle geschrieben; bestehende Gerätesollwerte können fortbestehen. Ein geräteseitiger Timeout bleibt deshalb im Gerät einzurichten; `batteryExternalTimeoutSec` dokumentiert ihn nur. Mehrere Schreibvorgänge sind nicht atomar; nach einem Schreibfehler wird die Sequenz abgebrochen und eine Warnung ausgegeben.
