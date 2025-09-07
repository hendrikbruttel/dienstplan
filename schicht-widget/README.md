# Dienstplan Widget

Kleines, eigenständiges Widget für die Darstellung von Schicht‑Infos, Checks und einer Übersichtstabelle. Es kann direkt im Browser geöffnet werden und integriert sich in Grist über die Plugin‑API.

## Struktur

```
dienstplan/
├─ index.html      # Einstieg, lädt CSS/JS und Grist API
├─ style.css       # Styles (Badge/Dot‑Varianten, Layout, A11y‑Hilfsklassen)
└─ script.js       # Rendering‑Logik (escapeHTML, Debounce, dynamische Spalten)
```

## Schnellstart

- Direkt im Browser öffnen: `dienstplan/index.html`
  - Ohne Grist zeigt die Seite leere Container an (keine Datenquelle).
  - Mit Grist (als Custom Widget eingebunden) werden Daten dynamisch gerendert.

### Lokale Testseite (ohne Grist)

- Öffne `dienstplan/test.html` im Browser.
- Die Seite nutzt eine lokale Fake‑`grist`‑API und speist Beispiel‑Daten ein.
- Passe Mock‑Daten in `dienstplan/test.html:23` (Info/Checks) und `:28` (TableJSON‑Zeilen) an.

## Einbindung in Grist

1. Das Verzeichnis hosten (z. B. über einen lokalen Webserver) und die URL in Grist als Custom Widget hinterlegen.
2. Benötigte Spalten/Typen werden via `grist.ready` angefragt:
   - `InfoJSON` (Any, Objekt)
   - `TableJSON` (Any, Array)
   - `Checks` (Any, Objekt)
   - `Person` (Int, Zielspalte zum Speichern der Person‑ID)

## Erwartete Datenformen (vereinfacht)

- `InfoJSON`: Objekt mit Key/Value-Paaren, z. B. `{ "Schicht": "Früh", "Datum": "2025-09-03" }`
- `Checks`: Objekt, Keys beliebig, Werte z. B. `{ applicable: true, active: true, display: "Plan vollständig" }`
- `TableJSON`: Array von Zeilenobjekten. Jede Zelle ist ein Objekt:
  - `{ display: string, status: number|boolean|"0"|"1", highlight?: boolean|"blue" }`
  - Spaltenreihenfolge wird dynamisch aus den Keys der ersten Zeile erzeugt.

## Wichtige Implementierungsdetails

- Sicherheit: Alle aus Datenquellen kommenden Texte werden mit `escapeHTML` bereinigt.
- Performance: `onRecord` ist per Debounce (16 ms) entlastet.
- Styling ohne Inline: Badges/Dots nutzen Klassen (`.badge--{green|yellow|red|gray}`, `.dot--...`).
- A11y: `lang="de"`, `viewport`, `aria-live` auf dynamischen Bereichen, `<caption class="sr-only">`, `scope="col"` für Tabellenköpfe.
- Spalten: vollständig dynamisch aus dem JSON, keine feste Reihenfolge im Code.
- Auswahl: In der „Person“-Spalte sind Einträge mit grünem Status (>= 1) klickbar. Per Klick wird deren `id` in die gemappte Spalte `Person` geschrieben und die Auswahl visuell markiert (Hover + Selected‑Stil).

## Anpassen

- Farben/Varianten: In `style.css` unter `.badge--*` und `.dot--*` bzw. CSS‑Variablen in `:root`.
- Labels/Übersetzungen: In `script.js` bei `translations` im Tabellen‑Renderer.
- Debounce: Wartezeit in `script.js` (Standard 16 ms) ändern.

## Entwicklung

- Es gibt keinen Build‑Schritt; reine HTML/CSS/JS‑Dateien.
- Für lokale Vorschau reicht ein statischer Server (z. B. `python3 -m http.server` o. Ä.).

## Changelog (aktuell)

- HTML‑Escaping ergänzt und überall angewandt.
- Inline‑Styles durch CSS‑Klassen ersetzt (Badges/Dots/Textausrichtung).
- Debounce für `grist.onRecord` hinzugefügt.
- A11y‑Verbesserungen (ARIA‑Live, Caption, `scope="col"`, `lang`, `viewport`).
- Doppeltes Root‑Setup bereinigt; maßgebliche Dateien liegen unter `dienstplan/`.
- Lokale Testseite `test.html` ergänzt (Fake‑Grist, Mock‑Daten).
- Person‑Auswahl: Klick auf grüne Personen setzt deren ID in Spalte `Person` (Mapping erforderlich), Hover/Selected‑Stile.
