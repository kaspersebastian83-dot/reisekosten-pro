# Reisekosten Pro

GitHub-Pages-Ausgabe · Die Release-Version kommt aus [package.json](package.json).

Datenschutzfreundliche, deutschsprachige PWA für deutsche Reisekosten- und
Spesenabrechnungen. Die App verarbeitet Vimcar- und andere Fahrtenbuch-Exporte
direkt im Browser, berechnet Verpflegungspauschalen, verwaltet Fahrzeuge,
Kosten und Belege und erzeugt PDF-, Excel-, CSV-, DATEV-CSV- und ZIP-Exporte.

## Datenschutzmodell

- Reisekosten, Belege und persönliche Einstellungen liegen ausschließlich in
  IndexedDB des verwendeten Browsers.
- GitHub Pages stellt nur den Programmcode bereit. Es gibt keinen Server, kein
  Benutzerkonto, keine Analytik und keine Übertragung Ihrer Abrechnungsdaten an
  GitHub.
- Persönliche Angaben sind nicht im Repository vorbelegt. Name, Adressen,
  Fahrzeug und Kennzeichen werden erst in der laufenden App eingetragen.
- Daten sind pro Browser und Gerät getrennt. Vor Browserwechsel, Gerätewechsel
  oder Löschen von Websitedaten immer eine JSON-Sicherung erzeugen.

## Auf GitHub Pages veröffentlichen

Die vollständige Anleitung steht in
[GITHUB-PAGES-ANLEITUNG.md](GITHUB-PAGES-ANLEITUNG.md).

Kurzfassung:

1. Neues GitHub-Repository anlegen.
2. Den vollständigen Inhalt dieses Ordners in den Branch `main` hochladen.
3. Unter **Settings → Pages → Build and deployment** als Quelle
   **GitHub Actions** auswählen.
4. Den Workflow **GitHub Pages bereitstellen** unter **Actions** abwarten.
5. Die veröffentlichte URL öffnen und die App im Browser installieren.

Jeder spätere Push nach `main` führt automatisch Tests aus, erstellt die
statische App und veröffentlicht die neue Version.

## Lokal starten

Erforderlich ist Node.js 22 oder neuer.

```bash
npm ci
npm run dev
```

Alternativ können unter Windows `START-WINDOWS.bat` und unter macOS
`START-MAC.command` verwendet werden.

## Qualitätsprüfung

```bash
npm test
```

Der Befehl führt die Berechnungs- und Importtests aus, prüft TypeScript, baut
die statische App und kontrolliert das Ergebnis auf GitHub-Pages-kompatible
relative Pfade.

## Enthaltene Kernfunktionen

- Vimcar-CSV-Erkennung mit sicherer Trennung von Betriebsfahrt, Arbeitsweg und
  Privatfahrt
- Tagesabwesenheit von erster bis letzter Betriebsfahrt
- gesetzliche 8-Stunden-Regel und mehrtägige Reisen
- Mahlzeitenkürzungen und versionierte Tarife
- Dienst- und Privatwagen mit fahrzeugbezogener Erstattungslogik
- Kamera-/Dateierfassung, Beleg-Eingang und lokale OCR-Vorschläge
- PDF-Abrechnung mit Belegverzeichnis und Bildanhängen
- PDF-, Excel-, CSV-, DATEV-CSV-, ZIP- und JSON-Export
- lokale IndexedDB-Speicherung und PWA-Offlinenutzung

## Fachlicher Hinweis

Die ausgelieferten Inlandswerte sind eine editierbare Anfangskonfiguration.
Die Anwendung ersetzt keine steuerliche Einzelfallberatung. Tarife,
Drei-Monats-Regel, erste Tätigkeitsstätte, Auslandsreisen und interne
Firmenregelungen sind bei Zweifeln fachlich zu prüfen.

## Start- und Deployment-Prüfung (Bugfix Oktober 2026)

Eine leere Pages-Seite kann entstehen, wenn beim Web-Upload der versteckte
Ordner `.github/` fehlt: GitHub veröffentlicht dann die ungebaute `index.html`,
deren `/src/main.tsx` nicht unter der Pages-Adresse geladen werden kann.
Veröffentlicht werden muss ausschließlich der von `npm test` erzeugte Ordner
`dist`, über `.github/workflows/deploy-pages.yml`.

Die App zeigt jetzt Lade-/Programmfehler und IndexedDB-Fehler verständlich an.
Fehlgeschlagene Lesezugriffe ersetzen keine vorhandenen Daten. Speicherfehler
bleiben mit JSON-Sicherung und Wiederholungsoption sichtbar. Datenbankname
`reisekosten-pro`, Version `1`, Store `state` und Schlüssel `main` bleiben
unverändert. Ältere gültige Sicherungen werden weiterhin ergänzt; fehlerhafte
Strukturen werden vor der Übernahme abgewiesen.

Bestätigte Korrekturen: Dezimalzahlen und Excel-Uhrzeiten im Import, leere
Uhrzeiten, ungültige deutsche Kalenderdaten, Ausgaben ohne Fahrt am selben
Tag, Reisen über einen ganzen Abrechnungsmonat, kalenderstabile Tagesgruppen,
explizite Null-Tarife bei Mahlzeitenkürzungen, Belegzuordnung „keine Reise“,
Fahrzeugart in Exporten und eingefrorene freigegebene Abrechnungen. Gesetzliche
Tarifsätze und Anspruchsschwellen wurden nicht geändert.

Neue Abrechnungsversionen speichern zusätzlich einen kompatiblen Profil- und
Beleg-Snapshot. Ältere Abschlüsse haben diese Snapshots nicht; dafür weist die
App auf die Verwendung aktueller Profil-/Belegdaten hin. Diese historischen
Daten können nicht nachträglich rekonstruiert werden.

`npm test` enthält gezielte Regressionen einschließlich Cache-Isolation.
Zusätzlich kann ein vorhandenes Playwright für Produktions-Browserprüfungen
verwendet werden, ohne es als Projektabhängigkeit hinzuzufügen:

```bash
npm test
PLAYWRIGHT_MODULE=/absoluter/pfad/zu/playwright \
CHROMIUM_EXECUTABLE=/absoluter/pfad/zu/chromium \
node tests/browser-check.mjs
```

Der Browsercheck stellt `dist` unter `/reisekosten-pro/` bereit und verwendet
nur synthetische Daten in isolierten Browserprofilen. Downloads und Screenshots
werden im temporären Betriebssystemverzeichnis abgelegt. Er prüft Import,
Belege, Export, Sicherung, Speicherfehler, mobile Breite und Offline-Start.
Echte Kamera-Hardware, Safari/iOS und die Qualität realer OCR-Belege müssen
zusätzlich auf den jeweiligen Geräten geprüft werden.


## Import prüfen, Berechnung verstehen, sicher aktualisieren

Unter **Fahrten importieren** wählen Sie CSV/XLSX und kontrollieren die
Spaltenzuordnung. Die nächste Seite zeigt alle Datenzeilen mit Quellzeile,
normalisierten Werten und Gründen. Filtern Sie nach Status und wählen Sie die
bereiten Fahrten aus. Erst **N Fahrten importieren** speichert; **Import
abbrechen** verwirft nur die Vorschau. Ungültige Daten müssen in der Quelle
korrigiert werden. Leere optionale Uhrzeiten bleiben als Prüfhinweis zulässig.
Vimcar-Privatfahrten und Arbeitswege bleiben ausgeschlossen. Auch ausdrücklich
zugeordnete private/Arbeitsweg-Fahrten allgemeiner Exporte werden vor der
Übernahme ausgeschlossen, entsprechend ihrem bisherigen Nicht-Erstattungsstatus.
Bereits vorhandene solche Fahrten werden nicht verändert.

Duplikate in Datei und Datenbank werden angezeigt und beim Bestätigen erneut
gegen den aktuellen Speicher geprüft. Die ausgewählten Fahrten und das Profil
werden in einer IndexedDB-Transaktion gespeichert. Bei einem Fehler bleibt die
Prüfung offen und es wird keine Teilmenge übernommen. Wurde dieselbe Fahrt
zwischenzeitlich in einem anderen Tab gespeichert, kann die Ergebniszahl kleiner
als die ursprünglich ausgewählte Zahl sein.

Unter **Reisen**, **Übersicht** und **Monatsabrechnungen** öffnet **Berechnung
anzeigen** die verwendeten Tages-/Monatsbeträge. Kilometer und Ausgaben werden
in den Fahrt-/Abrechnungsdetails erklärt. Tagespauschalen gelten gemeinsam für
alle Fahrten eines Tages. Freigegebene Abrechnungen zeigen ausschließlich ihren
gespeicherten Berechnungsstand. Bei älteren Abrechnungen fehlen eventuell
historische Details; die App kennzeichnet dies und rekonstruiert keine Werte
mit heutigen Einstellungen. Tarife, Schwellen und Erstattungsbeträge bleiben
unverändert.

**Einstellungen → Über diese App** zeigt die laufende Release-Version und den
Build-Commit. Ein wartendes Update zeigt **Neue Version verfügbar**. **Später**
behält die aktuelle Version, **Jetzt aktualisieren** lädt nach ausdrücklicher
Zustimmung neu. Offene Importe und Eingaben müssen vorher abgeschlossen oder
über die angebotene Aktion ausdrücklich verworfen werden. Andere offene
App-Tabs müssen ebenfalls bereit sein; bei Speicherfehlern zuerst JSON sichern
und erneut speichern. Offline-Updateprüfungen bleiben still.

Es gibt weiterhin keinen separaten CSV/XLSX-Ausgabenimport. Belege werden über
die vorhandene lokale OCR-/manuelle Prüfung im Belegeingang übernommen; JSON
bleibt die vollständige Datensicherung, kein zeilenweiser Import.

Keine neuen Abhängigkeiten oder Datenbankmigration: Datenbank `reisekosten-pro`,
Version 1, Store `state`, Schlüssel `main` bleiben unverändert. Neue Abrechnungen
enthalten zusätzliche optionale Erklärungsfelder; alte JSON-Sicherungen bleiben
lesbar. Screenshots und Testdownloads liegen im ignorierten Ordner `outputs/`.

Die optionalen Browserprüfungen verwenden eine vorhandene externe Playwright-
Installation (keine Projektabhängigkeit):

```bash
PLAYWRIGHT_MODULE=/pfad/zu/playwright CHROMIUM_EXECUTABLE=/pfad/zu/chromium node tests/browser-check.mjs
PLAYWRIGHT_MODULE=/pfad/zu/playwright CHROMIUM_EXECUTABLE=/pfad/zu/chromium node tests/feature-browser-check.mjs
```

Feature-PRs führen in GitHub Actions Tests und Build aus, ohne Pages-Artefakt oder
Deployment. Eine Veröffentlichung erfolgt erst durch die spätere Freigabe und
Übernahme nach `main`.
