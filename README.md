# SpesenKit

Dienstreisen · Spesen · Abrechnungen

GitHub-Pages-Ausgabe · Die Release-Version kommt aus [package.json](package.json).

Datenschutzfreundliche, deutschsprachige PWA für deutsche Reisekosten- und
Spesenabrechnungen. Dienstreisen werden manuell erfasst und mit Kosten und
Belegen zur Monatsabrechnung ergänzt. Optional verarbeitet die App weiterhin
Vimcar- und andere Fahrtenbuch-Exporte direkt im Browser. Sie berechnet
Verpflegungspauschalen, verwaltet Fahrzeuge,
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

Unter **Reisen → Fahrten importieren** wählen Sie CSV/XLSX und kontrollieren die
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

Ändert ein anderer Tab zwischenzeitlich den Speicherstand, darf ein älterer
Tab diesen nicht durch automatisches Speichern ersetzen. Die App zeigt den
Konflikt an und bietet die lokale JSON-Sicherung der eigenen Änderungen an.
Danach neu laden und die gewünschten Änderungen auf dem aktuellen Stand
übernehmen; eine automatische Zusammenführung findet nicht statt.

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
und erneut speichern. Während der Bereitschaftsprüfung sind bereits zustimmende Tabs kurz gesperrt,
bis alle Tabs zugestimmt haben oder das Update abgebrochen wird. Ein neu
geöffneter Tab führt zum Abbruch und erfordert einen erneuten Versuch. Auch
Dateilesen und laufende JSON-Wiederherstellung gelten als offene Arbeit.
Offline-Updateprüfungen bleiben still.

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
PLAYWRIGHT_MODULE=/pfad/zu/playwright CHROMIUM_EXECUTABLE=/pfad/zu/chromium node tests/review-browser-check.mjs
```

Feature-PRs führen in GitHub Actions Tests und Build aus, ohne Pages-Artefakt oder
Deployment. Eine Veröffentlichung erfolgt erst durch die spätere Freigabe und
Übernahme nach `main`.


## Dienstreisen als Hauptworkflow

Die App startet unter **Reisen**. **Reise erfassen** öffnet die vorhandene
manuelle Erfassung für Datum, Enddatum, Beginn und Ende der Abwesenheit,
Reiseziel und Reisezweck. Bestätigen Sie die tatsächliche berufliche
Abwesenheit und tragen Sie gestellte Mahlzeiten ein. Die bestehenden
Verpflegungs- und Fahrtkostenberechnungen bleiben unverändert.

Unter **Kosten & Belege** oder über die Schnellerfassung lassen sich Ausgaben
und Belege einer Reise zuordnen. In der **Übersicht** öffnen **Reise erfassen**,
**Ausgabe erfassen** und **Beleg hinzufügen** direkt die jeweilige Erfassung.
**Monatsabrechnungen** erstellt anschließend die Abrechnung und Exporte.
Ein Fahrtenbuchimport ist für diesen Ablauf nicht erforderlich.

Der vollständige Importassistent bleibt über den sekundären Button
**Fahrten importieren** unter **Reisen** erreichbar; **Zurück zu Reisen** führt
zurück. Der Import hat keinen eigenen Hauptnavigationspunkt mehr.
Die blaue Akzentpalette und hellen Karten orientieren sich an LabelKit;
es werden keine neuen UI-Bibliotheken oder Schriftendienste geladen.

### Regressionstest des manuellen Workflows

Nach `npm test` mit einer bereits installierten Playwright-Umgebung:

```sh
PLAYWRIGHT_MODULE=/pfad/zu/playwright BROWSER_EXECUTABLE=/pfad/zu/chromium node tests/workflow-browser-check.mjs
BROWSER_ENGINE=webkit PLAYWRIGHT_MODULE=/pfad/zu/playwright BROWSER_EXECUTABLE=/pfad/zu/pw_run.sh node tests/workflow-browser-check.mjs
```

Der Test startet einen lokalen Produktionsserver mit Repository-Unterpfad und
prüft isoliert mit synthetischen Daten Navigation, manuelle Reise,
Verpflegungspauschale, Reisezuordnung einer Ausgabe mit Bildbeleg,
Monatsabrechnung, PDF/Excel, nachträglichen Import und Offline-Neuladen bei
1440, 820 und 390 Pixel Breite. Physische iPhone-/iPad-Geräte und reale
Kamera-/OCR-Qualität sind damit nicht abgedeckt.


## Produktname und Projektzentrale

Die sichtbare Anwendung heißt **SpesenKit** (bisher Reisekosten Pro), mit dem
Untertitel **Dienstreisen · Spesen · Abrechnungen**. Die Projektzentrale kann
diesen Namen, Untertitel und die vorhandenen Icons verwenden. Andere
Anwendungen und Repositories werden durch diese Umbenennung nicht geändert.

- Repository bleibt **kaspersebastian83-dot/reisekosten-pro**:
  https://github.com/kaspersebastian83-dot/reisekosten-pro
- GitHub-Pages-URL bleibt **https://kaspersebastian83-dot.github.io/reisekosten-pro/**.
- Vorhandene Benutzerdaten bleiben erhalten: IndexedDB `reisekosten-pro`,
  Version `1`, Store `state`, Schlüssel `main` und alle Datenformate bleiben bestehen.
- Bestehende Installationen werden nicht absichtlich zurückgesetzt. Manifest-
  `id`, `start_url` und `scope` bleiben jeweils `.`; Service Worker und Offline-
  Cache-Bezeichner werden nicht umbenannt. Für die Umbenennung keine
  Websitedaten löschen und die PWA nicht neu installieren.
- Je nach Betriebssystem kann der neue PWA-Name oder das Icon erst nach einer
  Aktualisierung der Installationsmetadaten durch Browser oder Betriebssystem erscheinen.
- Fachliche Begriffe, Dokumenttitel, Exportdateinamen, Abrechnungsnummern und
  gespeicherte Abrechnungen bleiben unverändert. Neu erzeugte Excel-Dateien
  nennen SpesenKit als Software-Ersteller.

Das SK-Symbol liegt als Vektor in `public/favicon.svg`. Die PNG-Ableitungen
`icon-192.png` und `icon-512.png` behalten ihre Pfade und Größen; das 192er-Icon
bleibt zugleich das Apple-Touch-Icon. Der Schriftzug liegt im sicheren inneren
Bereich des vollflächigen Symbols, damit maskierbare PWA-Icons lesbar bleiben.


Der zusätzliche Update-Test `tests/branding-browser-check.mjs` erwartet über
`LEGACY_DIST` einen unveränderten Produktionsbuild vor der Umbenennung
(z. B. aus Commit `be44696`, der PR #3 enthält). Er lädt ausschließlich
synthetische Daten in einem isolierten Browserprofil und prüft das reguläre
Service-Worker-Update auf SpesenKit einschließlich identischem Datenbestand,
freigegebener Abrechnung mit Beleg-Snapshot, alten JSON-Backups, PDF/Excel und
Offline-Neuladen. Aufruf nach dem aktuellen Build:

```sh
LEGACY_DIST=/pfad/zum/alten/dist PLAYWRIGHT_MODULE=/pfad/zu/playwright BROWSER_EXECUTABLE=/pfad/zu/chromium node tests/branding-browser-check.mjs
```

Mit `BROWSER_ENGINE=webkit` und passendem `BROWSER_EXECUTABLE` läuft derselbe
Update-Test in WebKit. Die vorhandenen Datenbank- und Cache-Namen bleiben
bewusst `reisekosten-pro`; kein Lauf darf echte Browserprofile verwenden.

### Vereinfachte manuelle Dienstreise (Schritt 1)

Unter **Reisen → Neue Dienstreise** werden Projekt (`26.0123 Musterstadt`), Reisegrund,
Reiseziel und vollständige Abfahrts-/Rückkehrzeiten erfasst. Projektvorschläge stammen
aus bisherigen Auftragsangaben; neue Projekte können frei eingegeben werden. Der
Projektort wird als Reiseziel vorgeschlagen und lässt sich überschreiben. Die
Projektangabe nutzt das vorhandene Feld `Trip.order`, ohne Datenmigration.
Bestehende/importierte Auftragsangaben bleiben auch ohne neues Projektformat bearbeitbar.

Die Maske prüft positive Zeitintervalle mit explizitem Rückkehrdatum. Sie zeigt
**Abwesenheitsdauer, keine Arbeitszeit**, sowie die bestehende Tagesberechnung mit
Mahlzeitenkürzungen und Nullbegrenzung. Die Vorschau gilt für diese einzelne Reise;
weitere Reisen am selben Tag können das Monatsergebnis beeinflussen. Gespeicherte
Tarife, interne Schwellen und vorhandene manuelle Zeitkorrekturen bleiben wirksam.
Fahrzeug, Kilometer, Kunde, Startort und Korrekturen stehen unter „Weitere Angaben“.
Ein Dienstwagen erhält dadurch keine neue Kilometererstattung.

Datumswechsel sind zunächst mögliche Nächte. Tatsächliche auswärtige Übernachtungen
werden für alle angezeigten Nächte gemeinsam im vorhandenen `overnight`-Feld bestätigt.
Abweichende/teilweise Übernachtungen werden in vorhandenen Notizen dokumentiert und
müssen manuell geprüft werden. Es wird keine Übernachtungspauschale berechnet und
keine Hotelrechnung angelegt oder automatisch einer Reise zugeordnet (Schritt 2).

**Fachliche Grenze der bestehenden Berechnung:** Sie verwendet bei mehrtägigen
Zeitintervallen An-/Abreisetage auch ohne bestätigte auswärtige Übernachtung. Dieser
PR ändert diese Regel nicht; die Maske und gespeicherte Prüfhinweise kennzeichnen den
Fall ausdrücklich. Für einen Tagwechsel ohne Übernachtung ist die Vorschau daher
kein bestätigter Anspruch. Ebenso werden Ausland, erste Tätigkeitsstätte und die
Dreimonatsfrist bei Wiederholungseinsätzen nicht automatisch geprüft. Grundlage für
diese Prüfgrenzen: [§ 9 Abs. 4a EStG](https://www.gesetze-im-internet.de/estg/__9.html)
und [amtliche Übersicht 2026](https://amtliche-handbuecher.bundesfinanzministerium.de/lsth/2026/tabellarische-Uebersicht/inhalt.html).
Manuelles Speichern setzt den Status „ungeprüft“; die Bestätigung der Abwesenheitszeit
ist keine steuerliche Freigabe. Gespeicherte Hinweise bleiben bei einer späteren
Tagesbestätigung erhalten.

Prüfung: `npm test` umfasst auch `tests/manual-trip.test.ts`. Der optionale
`tests/workflow-browser-check.mjs` prüft die Maske, Projektvorschläge, Zeitfehler,
Tagwechsel, Mahlzeiten, mehrtägige Speicherung/Neuladen, eingefrorene Berichte,
Exporte, Import und Offline-Verhalten bei 390, 820 und 1440 px in Chromium/WebKit.
Die Browserprogramme werden extern bereitgestellt; keine neue Projektabhängigkeit.

### Belege mit Dienstreisen verbinden (Schritt 2)

**Kosten & Belege**, Belegfoto/OCR, Schnellerfassung und der vorhandene Kosteneditor
verwenden dieselben Zuordnungsvorschläge. Eine Projektnummer identifiziert das
Projekt; der Ort kommt weiterhin aus der Reise (`Trip.order`). Bei Hotels wird
zusätzlich der eingegebene tatsächliche Übernachtungsbeginn/-ende mit der Reise
abgeglichen. Der gesamte Aufenthalt muss innerhalb der Reisedaten liegen. Das
Rechnungsdatum bleibt separat und bestimmt weiterhin den Abrechnungsmonat.
Hotelvorschläge ohne Aufenthaltszeitraum werden ausdrücklich als zeitlich ungeprüft
gekennzeichnet. Bei sonstigen Belegen wird das Ausgabedatum innerhalb der Reise
geprüft. Ohne Projekt kann nur ein zeitlicher Vorschlag erfolgen.

**Kein Vorschlag wird still gespeichert:** Mit „Zuordnung bestätigen“ oder der
manuellen Reiseauswahl bestätigt man die konkrete Reise-ID. Mehrere Treffer werden
alle angeboten. Ohne Bestätigung bleibt die Ausgabe „Noch keiner Dienstreise
zugeordnet“ und kann trotzdem gespeichert werden. Die Auswahl ist nicht auf den
aktuellen Abrechnungsmonat beschränkt. Bereits bestätigte IDs bleiben beim Laden,
bei OCR und bei späteren Datums-/Projektänderungen stabil; abweichende Angaben
führen zu einem sichtbaren Prüfhinweis. Im Kosteneditor kann die Zuordnung geändert
oder gelöst werden. Verknüpfte Einträge im Belegeingang werden dabei synchronisiert;
der Änderungsverlauf enthält den vorherigen und neuen Ausgabestand.

Unter jeder Reise stehen die **zugeordneten Kosten & Belege**, über alle
Rechnungsmonate hinweg. Private und vom Unternehmen bezahlte Ausgaben sowie die
persönliche Erstattung werden getrennt gezeigt. Bilder lassen sich lokal ansehen,
andere Originaldateien herunterladen; fehlende Belege werden gekennzeichnet. Die
Bearbeitung verwendet den vorhandenen Kosteneditor.

Hotelname wird als vorhandener Händler gespeichert. Frühstück ist eine manuell
bestätigte Information mit den Zuständen Ja/Nein/Unbekannt. „Ja“ zeigt einen
Prüfhinweis; **keine automatische Mahlzeitenkürzung** oder Veränderung der Reise.
Es gibt keine neue automatische Übernachtungspauschale. Die Voraussetzungen einer
Arbeitgeberpauschale, mögliche Überschneidungen mit bestehenden manuell erfassten
Übernachtungskosten sowie die tatsächliche Behandlung von Frühstück bleiben vor
der Abrechnung fachlich zu prüfen.

Die bestehende Zahlungs-/Abrechnungslogik bleibt maßgeblich: Nur `privat vorgestreckt`
mit Erstattungsstatus `offen` erhöht den persönlichen Auszahlungsbetrag. Firmenkarte,
Unternehmen, bereits erstattete und ungeklärte Zahlungen erhöhen ihn nicht.
Händlerregeln stellen die Zahlungsart nicht mehr automatisch um. Private Zahlung ist
bei neuen Ausgaben sichtbar vorbelegt und vor dem Speichern zu prüfen. Bei alten
Ausgaben ohne Zahlungsart und alten Belegeingängen ohne Zahlungsinformation gilt
„unbekannt“, ohne einen Zahler oder eine private Auslage zu unterstellen. Explizit
vorhandene Zahlungsarten und Erstattungszustände werden nicht umgedeutet.

**Kompatible Datenfelder:** `Expense` und die bestehenden OCR-/Eingangsvorschläge
können optional `projectNumber` (nur Nummer), `stayStart`, `stayEnd` und
`breakfastIncluded` (`yes`/`no`/`unknown`) enthalten. `ReceiptInboxItem.paymentType`
bewahrt die manuell gewählte Zahlungsart bis zur späteren Übernahme. Die vorhandene
`tripId` ist die bestätigte Referenz; es gibt keine zusätzliche Projekt-Datenbank.
IndexedDB `reisekosten-pro`, Version 1, Store `state`, Schlüssel `main`,
App-Datenversion und PWA-/Pages-Pfade bleiben erhalten. Neue Felder werden beim
Laden/Backup geprüft; alte Sicherungen bleiben kompatibel. Keine Löschmigration,
keine Neuberechnung abgeschlossener Berichte. PDF-/Excel-/CSV-/ZIP-Formate bleiben
erhalten; die neuen Kontextfelder stehen in UI und JSON-Backup, ohne neue Spalten
in den bisherigen Exportformaten.

Exakt gleiche Dateihashes oder gleiche Rechnungsnummer und Händler blockieren eine
zweite Ausgabe; vorhandene Datensätze werden weiter bearbeitet. Gleicher Händler,
Tag und Betrag ohne eindeutige Rechnungsnummer ergeben einen zusätzlichen
Duplikat-Prüfhinweis. Neu fotografierte/anders beschnittene Rechnungen ohne verlässliche
Rechnungsnummer können nicht sicher dedupliziert werden und bleiben manuell zu prüfen.
Die Erkennung extrahiert eine Projektnummer nur bei eindeutigem Textvorkommen.
Aufenthaltszeitraum und Frühstück werden nicht aus unsicheren OCR-Textstellen abgeleitet.
Die bestehende lokale OCR lädt ggf. Laufzeit-/Sprachdateien herunter; Beleginhalte
werden nicht an einen OCR-Dienst übertragen. Langsame Erkennung überschreibt keine
inzwischen manuell korrigierten Felder; überholte Dateilesungen/Erkennung werden verworfen.

Gezielte Prüfungen: `tests/receipt-linking.test.ts` (Zuordnung, Duplikate, Zahlungen,
Backup-Kompatibilität, unveränderte Reisen/Berichte) und optional
`tests/receipt-linking-browser-check.mjs` mit synthetischen Belegen bei 390/820/1440 px
in Chromium und WebKit. Physische Kamera, tatsächliche OCR-Qualität und die konkrete
fachliche Frühstücks-/Übernachtungsbehandlung bitte vor praktischer Nutzung prüfen.

### Jahresübersicht und Monatsnavigation (Schritt 3.1)

**Monatsabrechnungen** zeigt links eine Jahresübersicht mit allen zwölf Monaten;
auf iPad/iPhone steht eine kompakte Übersicht oberhalb der bisherigen Abrechnung.
Monate sind direkt auswählbar, die aktive Auswahl ist hervorgehoben. Farben werden
durch Symbole und Texte ergänzt; auf dem iPhone erklären eine sichtbare Legende
und vollständige zugängliche Beschriftungen die kompakten Monatsschaltflächen.
Jahrespfeile blättern nur in der Übersicht. Die ausgewählte Abrechnung bleibt
bestehen, bis tatsächlich ein Monat angeklickt wird; „Ausgewählt“ zeigt sie weiterhin an.

Beim Start wird der **vorherige lokale Kalendermonat** vorgeschlagen, einschließlich
Januar → Dezember des Vorjahres. Die Auswahl liegt ausschließlich im bereits
bestehenden gemeinsamen React-Zustand von `Home`, ohne neue dauerhafte Einstellung.
Sie bleibt beim Wechsel zwischen Reisen, Kosten & Belege, Monatsabrechnungen,
Übersicht und den weiteren bestehenden Bereichen erhalten. Ein vollständiges
Neuladen/erneutes Öffnen startet wieder mit dem dann gültigen lokalen Vormonat;
innerhalb der geöffneten Anwendung setzt kein Automatismus eine bewusste Auswahl
zurück. Der bestehende globale Monatswähler bleibt nutzbar; leere/ungültige
Monatswerte ersetzen die Auswahl nicht.

**Status ist eine reine Anzeige vorhandener Daten:**

- **Grün / ✓ Abgeschlossen:** Die jüngste gespeicherte Version ist `locked: true`
  und hat den vorhandenen Status `freigegeben` oder `ausgezahlt`. Eine gespeicherte
  Berechnung, ein Entwurf oder PDF-/Excel-Export genügt nicht.
- **Orange / ◐ In Bearbeitung:** Relevante Reisen oder Ausgaben sind vorhanden,
  ohne ausdrücklichen Abschluss der jüngsten Version und ohne unten genannte
  bereits gespeicherte konkrete Prüfhinweise.
- **Grau / ○ Offen:** Kein solcher Abschluss und keine relevanten Einträge. Ein
  leerer Abrechnungsentwurf allein erzeugt keinen Rückstand.
- **Rot / ! Prüfung erforderlich:** Konkrete bereits gespeicherte Hinweise wie
  fehlender Reisegrund/Reiseziel, bestätigungsbedürftige Abwesenheit, negative/
  unplausible Kilometer, fehlender Beleg, Tankbeleg ohne Fahrzeug, Duplikatverdacht
  oder vorhandener Kilometerkostenkonflikt. Auch eine stornierte jüngste Version
  oder widersprüchliche Freigabe-/Sperrmerkmale werden so angezeigt. Allgemeine
  Steuer-/Geltungsbereichshinweise und der Status `ungeprüft` allein reichen nicht.
  Die konkrete Ursache steht bei der ausgewählten Abrechnung und im Tooltip.

Die Darstellung verwendet dieselbe Versionsreihenfolge wie die bestehende
Abrechnungsansicht. Bei einer neuen offenen Korrekturversion ist diese maßgeblich,
auch wenn eine ältere Version gesperrt bleibt. Abgeschlossene Versionen werden
nicht neu berechnet oder auf spätere Änderungen untersucht. Grün bestätigt den
vorhandenen gespeicherten Abschluss, keine neue Vollständigkeits-/Steuerprüfung.
Für abgeschlossene Monate stammen die eindeutigen Reise-IDs aus den eingefrorenen
Tageszeilen; aktuelle Änderungen verfälschen damit nicht die historische Reiseanzahl.

Relevante Aktivität folgt den vorhandenen Monatszuordnungen: nicht stornierte
Dienstreisen mit Überlappung zum Monat und nicht stornierte Ausgaben nach deren
Rechnungsdatum. Mehrtägige Reisen zählen je betroffenem Monat einmal, nicht je
Tageszeile. Private Fahrten, Arbeitswege und stornierte Einträge zählen nicht als
Reiseaktivität. Eine spätere Hotelrechnung wird durch die Navigation nicht in den
Reisemonat verschoben.

**„Ältesten offenen Monat bearbeiten“** berücksichtigt jahresübergreifend nur
Monate vor dem aktuellen lokalen Monat mit solchen Reisen oder Ausgaben und ohne
Abschluss der maßgeblichen Version. Leere, aktuelle und zukünftige Monate sind
keine Rückstände. Die älteste Monatskennung bestimmt „Mit … beginnen“; die Anzahl
zeigt betroffene Monate, nicht Reisen. Nach einem regulären Abschluss wird der
nächste offene Monat angeboten, ohne die bewusste Auswahl automatisch weiterzusetzen.
Ohne Rückstände erscheint ein freundlicher Hinweis.

Es werden weder Abschlusszustände gespeichert noch bestehende Snapshots,
Reise-/Belegzuordnungen, Datenmodelle, IndexedDB-Schlüssel, Tarife, Berechnungen,
Import, Exportformate oder Service Worker verändert. Keine Migration, neue
Abhängigkeit, zusätzliche Speicherung oder externe Verbindung. Die bestehende
Abrechnung bleibt innerhalb der Navigation unverändert nutzbar.

Gezielte Tests: `tests/month-navigation.test.ts` sowie optional
`tests/month-navigation-browser-check.mjs`. Der Browsertest verwendet ausschließlich
synthetische Daten, lokale Produktionsbuilds unter `/reisekosten-pro/` und simulierte
Kalenderdaten in Europe/Berlin sowie Pacific/Kiritimati zum UTC-/Jahreswechsel.
Er prüft zusätzlich Navigation ohne Speicheränderung, historischen Snapshot-Erhalt,
PDF/Excel ohne Abschluss, ausdrückliche Freigabe, offene Monate, gemeinsame Auswahl,
Touch-Flächen, Layout und Offline-Neuladen in 390/820/1440 px.

**Für Schritt 3.2 offen:** Verlässliche Vollständigkeitskriterien, Erkennung und
Bewertung nachträglicher Änderungen und Umgang mit korrigierten Abschlüssen.
Diese Navigation erfindet dafür keine neuen Prüfregeln, Sperren oder Freigaben.
Vorhandene leere/ältere Hinweisfelder können noch keine vollständige Problemprüfung
liefern; ungeprüfte Monate erscheinen daher gegebenenfalls orange. Keine Prüfung
auf physischen iPhone-/iPad-Geräten; WebKit-Nachweise stammen von macOS.
