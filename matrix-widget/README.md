# Grist Custom Widget: Dienstplan-Matrix

## Zweck des Widgets

Dieses Widget visualisiert eine Dienstplanung in einer interaktiven Matrix-Ansicht. Es zeigt Personen und Planungstage an und stellt die Verfügbarkeit, Wünsche und finalen Zuweisungen farblich dar. Mitarbeiter können per Klick auf eine Zelle für einen Dienst eingeteilt werden.

---

## Einrichtung in Grist

Damit das Widget funktioniert, müssen in deinem Grist-Dokument die folgenden Tabellen und Spalten existieren. Die Spaltennamen müssen exakt übereinstimmen.

**1. Widget Verknüpfung:**
* Füge das Widget zu deiner Seite hinzu.
* Verknüpfe das Widget im "Creator Panel" unter "Widget" > "Select Table" mit der Tabelle **`Dienstgruppen`**.

**2. Benötigte Tabellen & Spalten:**

* **Tabelle: `Planungsperiode`**
    * `Datum` (Date)
    * `Kurzel` (Text)
    * `Kurzel_Tag` (Text)
    * `Prufe_Teambesetzung` (Checkbox/Boolean)

* **Tabelle: `Dienstplan`**
    * `Datum` (Reference -> `Planungsperiode`)
    * `Dienst` (Reference -> `Dienstgruppen`)
    * `Person` (Reference -> `Personen`)
    * `Verfugbar` (Reference List -> `Dienstwunsche`)
    * `Wunsch` (Reference List -> `Dienstwunsche`)
    * `Kurzel` (Text)

* **Tabelle: `Personen`**
    * `Kurzel` (Text)
    * `Kurzel_Team` (Text)
    * `Dienstgruppen` (Reference List -> `Dienstgruppen`)
    * `N_Dienste` (Numeric)
    * `Maximale_Dienste` (Numeric)
    * `N_WE` (Numeric)
    * `Maximale_WE` (Numeric)

* **Tabelle: `Dienstwunsche`**
    * `Datum` (Reference -> `Planungsperiode`)
    * `Person` (Reference -> `Personen`)
    * `DF` (Checkbox/Boolean)
    * `NV` (Checkbox/Boolean)
    * `Anwesend` (Checkbox/Boolean)
    * `Unerwunscht` (Checkbox/Boolean)
    * `Display` (Text)

* **Tabelle: `Dienstgruppen`**
    * `Kurzel` (Text)
    * `Bezeichnung` (Text)

---

## Konfiguration im Code

Alle Tabellen- und Spaltennamen sind zentral in der `CONFIG`-Konstante am Anfang der `script.js`-Datei definiert. Wenn deine Spalten anders heißen, kannst du sie dort anpassen.