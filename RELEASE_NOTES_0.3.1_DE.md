# Energy Pilot v0.3.1 – Release Notes

Version 0.3.1 korrigiert gezielt die automatische Wetteranbindung an `ioBroker.daswetter`.

## Korrigierte Stundenprognose

Energy Pilot liest die aktuelle Struktur automatisch unter folgendem Pfad aus:

```text
daswetter.0.location_1.ForecastHourly.Hour_1
...
daswetter.0.location_1.ForecastHourly.Hour_24
```

Die Uhrzeit wird aus dem jeweiligen `time`-State gelesen. Bei der aktuell verwendeten Struktur entspricht `Hour_1` 01:00 Uhr und `Hour_24` 00:00 Uhr.

Verarbeitet werden insbesondere `temperature`, `clouds`, `humidity`, `wind_speed`, `wind_gust`, `rain` und `rain_probability`.

## Korrigierte Tagesprognose

`ForecastDaily.Day_1` wird als heutiger Tag und `Day_2` als morgiger Tag verarbeitet. Energy Pilot liest unter anderem:

- `Temperature_Min`
- `Temperature_Max`
- `Humidity`
- `Rain`
- `Rain_Probability`
- `Wind_Speed`
- `Wind_Gust`
- `sunshineduration`
- `symbol` / `symbol_description`
- `date`

## Wichtigste Fehlerkorrektur

Forecastwerte werden nicht länger mit dem globalen Timeout für Echtzeitmesswerte geprüft. Wetterprognosen werden nicht sekündlich aktualisiert und wurden dadurch in v0.3.0 trotz korrekt gefundener States als ungültig verworfen.

## Diagnose

`diagnostics.weatherStatus` enthält jetzt zusätzlich Beispielwerte aus `Hour_1` und `Hour_24` sowie die erkannten Tageswerte für heute und morgen. Damit lässt sich die Wetteranbindung wesentlich einfacher prüfen.
