# SpesenKit

Dienstreisen · Spesen · Abrechnungen

**App öffnen:** https://kaspersebastian83-dot.github.io/reisekosten-pro/ · Version
1.8.7 (Release-Version aus [package.json](package.json), Änderungen in
[CHANGELOG.md](CHANGELOG.md)) · **Bedienung:** [STARTANLEITUNG.md](STARTANLEITUNG.md)

Teil der Büro-App-Suite **Spektron** (Projektzentrale, LabelKit, FotoKit,
PlanKit, BelegKit, SpesenKit; Übersicht im
[README der Projektzentrale](https://github.com/kaspersebastian83-dot/Projektzentrale#readme)).
SpesenKit hat keinen Projektbezug: Die Projektzentrale öffnet es unten rechts
unter „Weitere Apps“. Früherer Name „Reisekosten Pro“; Repository, Webadresse,
Datenbank und Speicherformat behalten den alten Namen.

Datenschutzfreundliche, deutschsprachige PWA für deutsche Reisekosten- und
Spesenabrechnungen. Dienstreisen werden manuell erfasst und mit Kosten und
Belegen zur Monatsabrechnung ergänzt. Optional verarbeitet die App weiterhin
Vimcar- und andere Fahrtenbuch-Exporte direkt im Browser. Sie berechnet
Verpflegungspauschalen, verwaltet Fahrzeuge,
Kosten und Belege und erzeugt PDF-, Excel-, CSV-, DATEV-CSV- und ZIP-Exporte.

## Aktueller Stand in Kürze (1.8.7)

- **Navigation:** Monatsübersicht, Auswertungen, Einstellungen, Datensicherung.
  In der Seitenleiste darunter: Projektzentrale, Handbuch (AidKit) und Rückmeldung
  (`../rueckmeldung/?app=spesenkit&version=…`).
  Erfassen, Bearbeiten, Löschen, Import, Beleg-Eingang, Prüfen und Abschluss
  laufen über die Monatsübersicht (Monatsleiste, Werkzeugleiste, Zeitleiste
  „Monat im Überblick“, rechte Spalte mit Erstattung und Weg zum Abschluss).
- **Speicher:** IndexedDB `reisekosten-pro` (v1, Store `state`, Schlüssel
  `main`) und – nach „Ordner einrichten“ – die maßgebliche Datei
  `SpesenKit/Daten/spesenkit.json` im persönlichen Ordner, dazu Ablage
  `SpesenKit/Spesen/<Jahr>/<Monat>/` und Sicherungen `SpesenKit/Sicherungen/`.
- **Formulare:** Reise- und Kostenfenster zweispaltig ohne Scrollen ab etwa
  1366 × 660 px, Stapelerfassung mit „Speichern & nächste“ (Strg+Enter).
- Die Abschnitte ab „Entwicklungsverlauf“ beschreiben die einzelnen Schritte
  technisch und zum Zeitpunkt ihrer Einführung; spätere Abschnitte gehen vor.

## Datenschutzmodell

- Reisekosten, Belege und persönliche Einstellungen liegen in IndexedDB des
  verwendeten Browsers und – sobald eingerichtet – im persönlichen
  SpesenKit-Ordner (Datei-Zugriff des Browsers, keine Übertragung).
- GitHub Pages stellt nur den Programmcode bereit. Es gibt keinen Server, kein
  Benutzerkonto, keine Analytik und keine Übertragung Ihrer Abrechnungsdaten an
  GitHub.
- Persönliche Angaben sind nicht im Repository vorbelegt. Name, Adressen,
  Fahrzeug und Kennzeichen werden erst in der laufenden App eingetragen.
- Ohne SpesenKit-Ordner sind die Daten pro Browser und Windows-Profil getrennt.
  Den Ordner deshalb einrichten; zusätzlich ist eine JSON-Sicherung möglich.

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

- Monatsübersicht als Arbeitsplatz: Monatsleiste, Werkzeugleiste, Zeitleiste
  mit Rechenweg je Tag, Prüffilter, Weg zum Abschluss
- verbindlicher Monatsabschluss mit eingefrorenem Stand, Korrekturversionen
- persönlicher SpesenKit-Ordner mit Ablage und automatischen Sicherungen
- Stapelerfassung, Beleg-Eingang der Reihe nach, Löschen mit Protokoll
- Vimcar-CSV-Erkennung mit sicherer Trennung von Betriebsfahrt, Arbeitsweg und
  Privatfahrt
- Tagesabwesenheit von erster bis letzter Betriebsfahrt
- gesetzliche 8-Stunden-Regel und mehrtägige Reisen
- Mahlzeitenkürzungen und versionierte Tarife
- Dienst- und Privatwagen mit fahrzeugbezogener Erstattungslogik
- Kamera-/Dateierfassung, Beleg-Eingang und lokale OCR-Vorschläge
- PDF-Abrechnung mit nummerierten Belegen, Bildanhängen und mehrseitigen Original-PDFs
- PDF-, Excel-, CSV-, DATEV-CSV-, ZIP- und JSON-Export
- lokale IndexedDB-Speicherung und PWA-Offlinenutzung

## PDF für die Buchhaltung

Die PDF verwendet die blaue Spektron-Palette und das Firmenlogo von Dr. Schiffers & Partner
als dezentes Wasserzeichen auf jeder Seite, einschließlich der Beleganlagen. Firmenname und
„Spektron · SpesenKit“ stehen in der Fußzeile. Das Logo wird mitgeliefert; der Export lädt
keine externe Grafik nach. Name, Monat und persönlicher Erstattungsbetrag stehen auf der Übersicht.
Danach folgen Reisen mit Referenzen, gespeicherte Tagespauschalen und Kilometer,
Ausgaben und ein Belegverzeichnis mit anklickbaren Anlagenseiten. Firmenzahlungen
und bereits erstattete Ausgaben werden ausdrücklich bezeichnet.

Jede Kostenposition erhält eine Belegnummer wie `B-202609-001`. Anlagen folgen
in derselben Reihenfolge: PNG/JPEG als lesbare Bildseiten, lange Bons überlappend
auf mehreren Seiten, lesbare PDFs mit sämtlichen Originalseiten. Tabellenköpfe
wiederholen sich bei Seitenumbrüchen; alle Seiten sind fortlaufend nummeriert.
Fehlende Belege und nicht einbettbare Dateien werden sichtbar gekennzeichnet.
Geschützte, defekte oder mit Anmerkungen bzw. Formularfeldern versehene PDFs
sowie andere Bildformate müssen separat beigefügt werden. Der ZIP-Export enthält
die Originaldateien und `Belegverzeichnis.csv` mit derselben Nummerierung.
Es sind keine zusätzlichen Einstellungen nötig. Abgeschlossene Versionen nutzen
ausschließlich ihren gespeicherten Rechenstand und Beleg-Snapshot.

Eine vollständig erfundene September-Abrechnung lässt sich reproduzieren:

```sh
PDF_SAMPLE_DIR=outputs/accounting-pdf npm run test:unit -- tests/pdf-accounting.test.ts
```

Das erzeugt eine 13-seitige Muster-PDF, ZIP und Prüfdaten: 89,60 EUR Verpflegung,
236,40 EUR Kilometer und 87,20 EUR persönliche Auslagen ergeben 413,20 EUR.
Die sechs nummerierten Belege enthalten PNG, JPEG, einen langen Bon und zwei
Original-PDFs. Die Tests prüfen zusätzlich fehlende/defekte Dateien, geschützte
Darstellungen, historische Stände, Drehung/Zuschnitt und lange Tabellen.

## Fachlicher Hinweis

Die ausgelieferten Inlandswerte sind eine editierbare Anfangskonfiguration.
Die Anwendung ersetzt keine steuerliche Einzelfallberatung. Tarife,
Drei-Monats-Regel, erste Tätigkeitsstätte, Auslandsreisen und interne
Firmenregelungen sind bei Zweifeln fachlich zu prüfen.

## Gleichzeitiges Speichern in einem persönlichen Ordner

Vor jedem Schreibversuch sichert die App den eigenen Datenstand als
`Sicherungen/spesenkit_speicherkandidat_<Datum>_<Zeit>_<UUID>.json`. Vor dem Ersetzen wird auch der gelesene
Vorgänger als `spesenkit_vor_speichern_….json` gesichert. Jede Kopie wird geschlossen und vollständig
zurückgelesen, bevor die Hauptdatei ersetzt werden darf. Diese Kopien sind normale JSON-Sicherungen mit
Reisen, Belegen und eingefrorenen Abrechnungen. Seit 1.8.3 löscht die App die beiden Kopien eines Speicherns beim
nächsten eigenen Speichern, aber nur wenn die ersetzte Datei noch genau den eigenen Stand enthielt (Fingerabdruck
gleich). Hat eine andere Sitzung dazwischen gespeichert, bleiben sie. Liegengebliebene Kopien (Sitzungsende, Konflikt)
werden bei der Tagessicherung nach 7 Tagen entfernt.

Revision und erwarteter Inhaltsfingerabdruck werden geprüft. Vor dem Ersetzen wird die Datei erneut mit
dem gelesenen Ausgangstext verglichen. Ein erkannter Konflikt verlangt die vorhandene Entscheidung
„Ordnerstand übernehmen“ oder „Browserstand behalten“. Auch ein später bemerkter anderer Inhalt mit
derselben oder einer älteren Revision verlangt eine Entscheidung.

**Wiederherstellen:** Unter *Datensicherung → SpesenKit-Ordner → Sicherungen* die Auswahl
„Speicherkandidaten und Vorgänger anzeigen“ aktivieren. Eine Kopie auswählen und den Inhalt in der
Bestätigung prüfen. „Wiederherstellen“ sichert den aktuellen Stand und ersetzt ihn nach ausdrücklicher
Bestätigung. Ein Kandidat kann aus einem fehlgeschlagenen oder konkurrierenden Versuch stammen; er ist
keine Bestätigung eines erfolgreichen Schreibens und wird nicht automatisch mit dem aktuellen Stand zusammengeführt.
Alte Sicherungsnamen ohne UUID bzw. mit Zähler bleiben lesbar.

**Garantie und Grenze:** Mit dieser Speicherlogik bleiben beide konkurrierenden Speicherkandidaten
mindestens 7 Tage erhalten, sobald ihre Kopien erfolgreich geschrieben und zurückgelesen wurden. Schlägt eine notwendige
Sicherung oder Prüfung fehl, wird der eigene Schreibvorgang nicht als erfolgreich bestätigt. Die File System
Access API bietet keine atomare serverübergreifende Operation „nur ersetzen, falls unverändert“.
`navigator.locks` ordnet lediglich Tabs innerhalb desselben Browserprofils. Deshalb können im letzten
Rennfenster weiterhin beide Sitzungen ihre jeweilige Hauptdatei erfolgreich zurücklesen; eine später
überschriebene Fassung bleibt in ihren Kopien wiederherstellbar. Das ist Verlustschutz, keine globale
Exklusivität oder automatische Zusammenführung. Spätere Änderungen werden beim nächsten Abgleich/Schreibversuch
erkannt, nicht durch eine permanente Überwachung anderer Server.

Alle beteiligten Sitzungen müssen die aktualisierte Speicherlogik verwenden. Unbeobachtete Änderungen alter
App-Versionen oder externer Programme im letzten Rennfenster können nicht vollständig abgesichert werden.
Ebenso ersetzt Rücklesen keine Sicherung gegen Hardwareausfall oder spätere Löschung. Jede Kopie enthält
den vollständigen Datenbestand einschließlich Base64-Belegen: der Platzbedarf wächst mit den Schreibversuchen.
Bei Platzmangel bleibt eine Fehlermeldung statt eines bestätigten Speichervorgangs. Eine automatische
Bereinigung dieser Wiederherstellungskopien ist bewusst nicht eingerichtet.

Regressionen: `tests/folder-concurrency.test.ts` pausiert unabhängige Schreiber ohne gemeinsame Browsersperre
an festen Barrieren (unter anderem direkt vor Dateianlage/Schließen). Die Tests prüfen beide Kandidaten,
Fehler bei Sicherung/Schreiben/Schließen/Rücklesen und die Wiederherstellbarkeit von Belegen und Abschlüssen.
`tests/folder-storage-browser-check.mjs` prüft Konfliktdialog, Neustart, Kandidatenwiederherstellung und
fehlgeschlagene Sicherungen im privaten Browserdateisystem. Ein echter SMB-/RDP-Betrieb ist damit nicht getestet.

## Entwicklungsverlauf

Die folgenden Abschnitte sind in der Reihenfolge der Einführung geschrieben.
Erwähnte Reiter „Reisen“ und „Kosten & Belege“, die Schnellerfassung
„Ausgabe“ und schwebende Knöpfe gibt es seit 1.8.0 nicht mehr (siehe
„Navigation ohne …“ am Ende).

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

Unter **Reisen** und in der Abrechnungsansicht der **Monatsübersicht** öffnet **Berechnung
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

Die App startet unter **Monatsübersicht**. **Dienstreise erfassen** öffnet die vorhandene
manuelle Erfassung für Datum, Enddatum, Beginn und Ende der Abwesenheit,
Reiseziel und Reisezweck. Bestätigen Sie die tatsächliche berufliche
Abwesenheit und tragen Sie gestellte Mahlzeiten ein. Die bestehenden
Verpflegungs- und Fahrtkostenberechnungen bleiben unverändert.

Unter **Kosten & Belege** oder über die Schnellerfassung lassen sich Ausgaben
und Belege einer Reise zuordnen. In der **Monatsübersicht** öffnen die
Erfassungsaktionen die vorhandenen Masken. Die globale Aktion **Ausgabe** bietet
weiterhin die Schnellerfassung. Im Abrechnungsbereich der Monatsübersicht werden
Entwurf und Exporte anschließend ausdrücklich erstellt.
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

**Monatsübersicht** zeigt links eine Jahresübersicht mit allen zwölf Monaten;
auf iPad/iPhone steht eine kompakte Übersicht oberhalb der bisherigen Abrechnung.
Monate sind direkt auswählbar, die aktive Auswahl ist hervorgehoben. Farben werden
durch Symbole und Texte ergänzt; auf dem iPhone erklären eine sichtbare Legende
und vollständige zugängliche Beschriftungen die kompakten Monatsschaltflächen.
Jahrespfeile blättern nur in der Übersicht. Die ausgewählte Abrechnung bleibt
bestehen, bis tatsächlich ein Monat angeklickt wird; „Ausgewählt“ zeigt sie weiterhin an.

Beim Start wird der **vorherige lokale Kalendermonat** vorgeschlagen, einschließlich
Januar → Dezember des Vorjahres. Die Auswahl liegt ausschließlich im bereits
bestehenden gemeinsamen React-Zustand von `Home`, ohne neue dauerhafte Einstellung.
Sie bleibt beim Wechsel zwischen Reisen, Kosten & Belege, Monatsübersicht
und den weiteren bestehenden Bereichen erhalten. Ein vollständiges
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

## Schritt 3.1b: Abrechnungsmonat als Arbeitsbereich

Unter **Monatsübersicht** öffnet jeder ausgewählte Monat zunächst einen
Arbeitsbereich. „Bisher erfasst“ zeigt die aktuellen, aus `buildStatement`
abgeleiteten Daten: eindeutige Dienstreisen, Verpflegungsvorschau, erfasste
Hotel-/weitere Kosten, Unternehmenszahlungen und die offene persönliche
Erstattung. Diese Anzeige speichert keine Summen und erzeugt keinen Snapshot.
Bei einem abgeschlossenen Monat zeigt der Arbeitsbereich weiterhin die aktuellen
Eingaben; „Abrechnung ansehen“ öffnet den bestehenden eingefrorenen Bericht.

Die Aktionen **Dienstreise erfassen**, **Hotelrechnung erfassen** und
**Sonstige Kosten erfassen** öffnen die vorhandene Reise- beziehungsweise
Kostenmaske. Vergangene/zukünftige Arbeitsmonate verwenden den Monatsersten als
Datums-Vorschlag, der aktuelle Monat den lokalen heutigen Tag. Hotel ist bereits
vorausgewählt. Das Rechnungsdatum bleibt editierbar und entscheidet weiterhin
über die Zuordnung der Ausgabe zu einem Monat. Bei einer Abweichung erscheint
ein Hinweis vor und nach dem Speichern. Übernachtungszeitraum, Projekt,
bestätigte Reisezuordnung, Zahlungsart und lokale Belegdateien nutzen dieselben
Felder und Speicherwege wie bisher. Die vorhandene Kamera-/OCR-Erfassung ist
auch vom Arbeitsbereich erreichbar.

Gespeicherte Reisen/Kosten können über **Reisen bearbeiten** und **Kosten &
Belege bearbeiten** ergänzt werden. Nach dem Speichern im Monatsablauf öffnet
sich wieder der Arbeitsbereich. Die gemeinsame React-Monatsauswahl bleibt dabei
erhalten. Es gibt keine neue dauerhafte Auswahl- oder Entwurfsspeicherung;
Neuladen startet wie bisher im lokalen Vormonat, gespeicherte Eingaben bleiben
erhalten und der gewünschte Arbeitsmonat kann erneut ausgewählt werden.

**Spesenabrechnung erstellen** nutzt die vorhandene Snapshot-Erstellung für den
gewählten Monat und öffnet die vorhandene Prüf-/Exportansicht. Der bestehende
Status `vollständig` mit `locked: false` bedeutet weiterhin einen bearbeitbaren
Entwurf. Freigabe/Auszahlung erfolgt gesondert über die bestehende Statusauswahl.
**Abrechnung fortsetzen** und **Abrechnung ansehen** öffnen die jüngste vorhandene
Version ohne einen weiteren Snapshot. „Neue Version erstellen“ behält den
vorhandenen expliziten Korrekturweg bei. Schritt 3.2 (zusätzliche Abschluss- oder
Änderungsprüfungen) ist nicht Bestandteil dieser Änderung.

Zusätzliche synthetische Browserprüfung, mit derselben optionalen externen
Playwright-Installation wie die anderen Browserchecks (keine neue Abhängigkeit):

```sh
PLAYWRIGHT_MODULE=/pfad/zu/playwright BROWSER_EXECUTABLE=/pfad/zum/browser node tests/month-workspace-browser-check.mjs
```

Sie prüft den Juni-Arbeitsablauf bei 390/820/1440 px, die Juli-Rechnung zu einer
Juni-Reise, Unternehmenszahlungen, lokale Belege/Zuordnungen, aktualisierte
Kennzahlen, explizite Entwurfserstellung, Wiederaufnahme ohne Duplikat,
unveränderte abgeschlossene Snapshots, PDF/Excel und Offline-Neuladen.

## Schritt 3.1c: Gemeinsame Monatsübersicht

**Monatsübersicht → Reisen → Kosten & Belege → Auswertungen → Einstellungen →
Datensicherung** ist die gemeinsame Reihenfolge auf allen Bildschirmgrößen.
Die App startet in der Monatsübersicht mit dem vorherigen **lokalen**
Kalendermonat. Die gemeinsame React-Monatsauswahl bleibt bei Bereichswechseln
erhalten; es gibt weiterhin keine neue dauerhafte Speicherung dieser Auswahl.
Der Monatsarbeitsbereich aus Schritt 3.1b bleibt die einzige Eingangsfläche.
Erfassung erzeugt keinen Snapshot; Erstellung, Freigabe und Korrekturversionen
nutzen weiterhin ausschließlich die vorhandene Abrechnungsansicht.

### Bestandsaufnahme: Ziele der bisherigen Dashboard-Funktionen

| Bisherige Funktion | Ziel nach der Zusammenführung |
| --- | --- |
| Dienstreise erfassen (Workflow und Hero-Aktion) | Monatsübersicht → Dienstreise erfassen; vorhandene `TripForm` |
| Ausgabe schnell erfassen | Globale Aktion „Ausgabe“ / schwebende „Ausgabe schnell erfassen“, vorhandene `QuickExpense` |
| Beleg hinzufügen / fotografieren | Monatsübersicht → Beleg fotografieren / OCR, vorhandene `ReceiptCapture`; globale Kamera bleibt erhalten |
| Hotel und sonstige Kosten, bestehende Einträge bearbeiten | Bestehende Aktionen im Monatsarbeitsbereich, `Expenses` und `Trips` |
| Laufende erfasste Kosten, Spesen, offene persönliche Erstattung | Einmalige Kennzahlen des vorhandenen `MonthWorkspace` |
| Dienstliche Kilometer, Tage mit Spesen, Gesamtkosten inkl. Firmenkosten, offene Auszahlung | Auswertungen → „Bisherige Monatskennzahlen und Kostenaufteilung“, bisherige `Metric`-Karten |
| Fünf Kostenbalken (Verpflegung/Kilometer/Tanken/Übernachtung/Sonstiges) | Derselbe aufklappbare Bereich unter Auswertungen, unveränderte Werte und Balkenformeln |
| Ungeprüfte Datensätze | Monatsübersicht → Prüfen, getrennte Links zu Reisen und Kosten; bisherige Warnungs-/Statusprädikate |
| Fehlende Belege | Prüfen → Fehlende Belege → bestehende Kostenansicht |
| Mögliche Duplikate | Prüfen → Mögliche Duplikate → bestehende Reisenansicht |
| Eindeutige Zeiten gemeinsam bestätigen | Prüfen → Eindeutige Zeiten bestätigen, ursprünglicher Filter und ursprünglicher Bestätigungshandler |
| Anzahl wartender Belege | Prüfen → Belege im Eingang insgesamt; vorhandene Kostenansicht mit ihrem Monatsfilter |
| Abrechnung vorhanden / Workflow „Abschließen“ | Einziger Abrechnungsbereich mit Erstellen/Fortsetzen/Ansehen; keine automatische Freigabe oder Exporte |
| Berechnungsdetails und Exporte | Vorhandene Reise- und Abrechnungsdetails, unveränderte Exportaktionen |
| Tarifhinweis / Regeln ansehen | Prüfen → Tarife und Regeln ansehen → vorhandene Einstellungen mit tatsächlichem Tarifstand |
| Globale Anzahl offener Hinweise | Bestehende Kopfzeile, ausdrücklich „insgesamt“; Prüfbereich betrachtet den ausgewählten Monat |
| Zweite Einführung, doppelte Eingabeleiste und dieselben Geldbeträge auf zwei Startseiten | Redundante Darstellung entfällt; alle Funktionen sind oben zugeordnet |
| „Bereit zum Abschluss“, „Alles plausibel“, pauschaler Standardtarif-Text | Irreführende Allgemeinaussagen entfallen; bekannte Hinweise bzw. tatsächliche Einstellungen bleiben erreichbar |

`MonthChecks` verwendet die bisherigen Dashboard-Prädikate für Reisen mit
Abfahrt im Arbeitsmonat, Ausgaben nach Rechnungsmonat und die bisherigen
Sammelbestätigungen. Die schon vorhandenen konkreten Monatsstatus-Hinweise
(`monthOverview`) stehen in derselben Prüfliste, statt in einer zweiten Karte.
Die Statusermittlung selbst bleibt unverändert. Keine bekannten Hinweise sind
keine steuerliche oder fachliche Vollständigkeitsprüfung (Schritt 3.2).

Die bisherige Meldung offener Formulare (`PendingWork`) schützt nun auch
Bereichswechsel, Monatswechsel und die Rückkehr aus dem Monatsablauf. Offene
Eingaben werden zuerst gespeichert oder im vorhandenen Formular ausdrücklich
abgebrochen. Erfolgreiche Speicheraktionen kehren weiter zum Arbeitsmonat
zurück. Innerhalb der Monatsübersicht erscheint kein Rückkehrhinweis.
Die bestehende Update-Abstimmung zwischen App-Tabs bleibt erhalten.

Die Auswertungen selbst, Datenmodelle, Rechenregeln, Speicheridentität,
Abrechnungsstände und der Safari-/Service-Worker-Fix aus PR #10 sind unverändert.
Schritt 3.1d kann die bereits verfügbaren Auswertungen später ordnen/erweitern;
in diesem Schritt entstehen keine neuen Jahres-, Projekt- oder Steuerstatistiken.

Zusätzliche synthetische Browserprüfung mit der bestehenden optionalen
Playwright-Installation, ohne neue Projektabhängigkeit:

```sh
PLAYWRIGHT_MODULE=/pfad/zu/playwright BROWSER_EXECUTABLE=/pfad/zum/browser node tests/unified-overview-browser-check.mjs
```

Sie prüft Start/Navigation, zwölf Monate, gemeinsame Auswahl, den unveränderten
lokalen Speicherstand bei Navigation, die übernommenen Prüf-/Sammelaktionen,
Jahresanalyse und Monatskennzahlen, Tastaturbedienung der Prüfliste,
ungespeicherte Kosten-/Einstellungsformulare und Offline-Neuladen bei
390/820/1440 px in Chromium und WebKit. Die bestehenden Monatsablaufprüfungen
prüfen weiter Reisen/Hotel/Kosten, bewusste Entwürfe, unveränderte gesperrte
Snapshots, PDF/Excel und Belegzuordnungen.

## Schritt 3.1d: Jahresauswertungen

Der Bereich **Auswertungen** zeigt die aktuelle Erfassung des gewählten
Analysejahres. Der Jahreswähler ist flüchtiger React-Zustand und verändert den
Abrechnungsmonat nicht. Die fünf Jahreskennzahlen, alle zwölf Monatsbalken,
Kostenarten und offenen Auszahlungen beruhen auf genau einer vorhandenen
`buildStatement`-Berechnung pro Monat. Gespeicherte Snapshotwerte werden nicht
mit aktuellen Erfassungsdaten vermischt; gesperrte Abschlüsse werden lediglich
über den bestehenden Monatsstatus gezählt.

Die Projektsicht ist eine interne Kostenanalyse. Reisekosten werden nur dann
einem Projekt zugeordnet, wenn die bestehende Projektnummer in `Trip.order`
oder `Expense.projectNumber` eindeutig ist. Ein verknüpfter Beleg mit
widersprüchlichen Projektangaben bleibt ohne Projekt. Tagespauschalen werden
nur zugeordnet, wenn alle Reisen des Tages dasselbe bekannte Projekt tragen;
sonst erscheinen sie unter **Nicht eindeutig zugeordnet**. Kundenfelder werden
nicht als Projekt interpretiert. Die Ansicht ist keine verbindliche steuerliche
oder buchhalterische Projektkostenrechnung.

Die Beträge für „Privat vorgestreckt“, „Vom Unternehmen bezahlt“, „Bereits
erstattet“ und „Zahlungsart unbekannt“ folgen den vorhandenen Zahlungs- und
Erstattungsfeldern. Sie sind getrennte Merkmale und können sich überschneiden.
Offene persönliche Auszahlungen stammen ausschließlich aus den vorhandenen
Monatsberechnungen. Eine private Vorauslage gilt dadurch nicht automatisch als
offen; unbekannte Zahlungsarten erhöhen die persönliche Auszahlung nicht.

Der Auswertungsbereich bietet keine Beleg- oder Spesenerfassung und erstellt
keine Abrechnungsentwürfe. IndexedDB, Schema, Snapshots, Exporte, Import,
Offlineverhalten, GitHub-Pages-Konfiguration und der Safari-/Service-Worker-Fix
bleiben unberührt. Die Jahresauswertung speichert keine Daten.

## Schritt 3.3a: Persönlicher SpesenKit-Ordner

Für den Einsatz am Terminalserver (RDP, je Mitarbeiter ein eigenes Windows-Profil, Edge oder Chrome) kann jeder
Mitarbeiter einmal seinen persönlichen Ordner wählen („Ordner einrichten“ im Hinweis oder unter *Datensicherung*).
SpesenKit legt darin an:

```text
<gewählter Ordner>\SpesenKit\
  Daten\spesenkit.json          aktueller Datenbestand (maßgeblich)
  Daten\spesenkit.vorher.json   Stand vor dem letzten Speichern
  Sicherungen\*.json            Kopien bei Konflikten / beiseitegelegte unlesbare Datei
```

- **Speichern:** Jede Änderung wird wie bisher zuerst lokal (IndexedDB) und direkt danach in `spesenkit.json`
  gespeichert – der Reihe nach, mit Revisionsnummer und Rücklesekontrolle. Die Seitenleiste zeigt den Stand.
  Schließen des Browsers mit noch nicht gespeicherter Ordnerdatei löst eine Rückfrage aus.
- **Maßgeblicher Stand:** Beim Start vergleicht SpesenKit Browser und Datei (Revision und Inhalts-Fingerabdruck).
  Automatisch nur in eindeutigen Fällen: Browser unverändert → Datei laden (z. B. anderer Terminalserver);
  Datei unverändert → Browserstand schreiben (Ordner war nicht erreichbar); neuer Ordner mit leerem Browser →
  Datei laden. Sonst fragt ein Dialog, welcher Stand gilt; der andere wird als wiederherstellbare Kopie in
  `Sicherungen` abgelegt. Ein plötzlich leerer Browser leert die Datei nie automatisch.
- **Abschluss und Korrektur:** Bei verbundenem Ordner wird Erfolg erst gemeldet, wenn auch die Datei geschrieben
  ist. Ist der Ordner nicht beschreibbar (Zugriff nicht bestätigt, Konflikt, Datei fehlt/unlesbar), wird vor dem
  Abschluss zuerst um Klärung gebeten. Scheitert nur das Schreiben in den Ordner, bleibt der Abschluss lokal
  bestehen; die App sagt das ausdrücklich und bietet „Erneut speichern“ an.
- **Unlesbare Datei:** wird nie überschrieben. Neu anlegen nur auf ausdrücklichen Wunsch; die alte Datei bleibt
  als Kopie erhalten.
- **Berechtigung:** Der Browser fragt nach einem Neustart erneut; die App zeigt dann „Zugriff bestätigen“.
- **Ohne Ordner** (oder in Browsern ohne Ordnerzugriff) arbeitet SpesenKit wie bisher nur im Browser und weist
  darauf hin.

Unverändert: IndexedDB `reisekosten-pro` (Version 1, Store `state`, Schlüssel `main`), Datenformat und
JSON-Sicherung, Berechnung, Abschluss-/Korrekturlogik, Exporte, Service Worker. Der Ordner-Verweis liegt wie bei
den anderen Apps in der gemeinsamen Datenbank `mosaik-suite` (Version 1, Store `kv`), Schlüssel `spesenkit-ordner`.

Organisatorisch nötig: Ordnerrechte nur für den jeweiligen Mitarbeiter (die Datei enthält Reisen und Belege
unverschlüsselt) und eine Sicherung des Laufwerks außerhalb des Servers.

Bekannte Grenze: Belege liegen als Base64 in der Datei; bei vielen Fotos wird sie groß und bei jeder Änderung
vollständig neu geschrieben (Sicherungsstände siehe 3.3c).

## Schritt 3.3b: Ablage abgeschlossener Abrechnungen

Nach einem erfolgreichen Monatsabschluss (Datenstand im Ordner gesichert) legt SpesenKit die Dateien der Version ab:

```text
<gewählter Ordner>\SpesenKit\Spesen\2026\09\
  Reisekosten_2026-09_V01.pdf    Standard
  Reisekosten_2026-09_V01.zip    Standard (PDF, Abrechnungs-JSON, Belege – wie „ZIP + Belege“)
  Reisekosten_2026-09_V01.xlsx   optional
  Reisekosten_2026-09_V02.pdf    Korrektur: neue Version daneben
```

- Inhalt und Dateinamen entstehen über dieselben Funktionen wie die Export-Knöpfe, aus dem gespeicherten Stand der
  Version (historische Belege/Profilangaben, Korrekturhinweis bei V02+).
- Vorhandene Dateien werden nie überschrieben; abgelegt werden nur fehlende Formate. Nur abgeschlossene Versionen.
- Formatwahl unter *Datensicherung → SpesenKit-Ordner* (pro Browserprofil, wie der Ordner selbst).
- Scheitert die Ablage, bleibt der Abschluss gültig; ein Hinweis „Erneut ablegen“ bleibt sichtbar. War der Ordner
  schon beim Abschluss nicht beschreibbar, erscheint der Hinweis, sobald er wieder bereit ist.
- In der Abrechnungsansicht einer abgeschlossenen Version: Ablagestand je Datei, „Im SpesenKit-Ordner ablegen“ und
  „Abrechnung drucken“ (PDF mit Druckdialog).

```sh
npm run build
PLAYWRIGHT_MODULE=/pfad/zu/playwright BROWSER_EXECUTABLE=/pfad/zu/chromium node tests/folder-storage-browser-check.mjs
```

## Schritt 3.3c: Sicherungsstände im SpesenKit-Ordner

`SpesenKit\Sicherungen\` enthält vollständige Stände im Format der JSON-Sicherung:

| Datei | Wann | Aufbewahrung |
|---|---|---|
| `spesenkit_auto_<Datum>_<Zeit>.json` | erste Änderung eines Tages – gesichert wird der Stand **davor** | letzte 14 + je Monat eine für 12 Monate |
| `spesenkit_abschluss_<Monat>_V<n>_….json` | nach jedem Monatsabschluss | dauerhaft |
| `spesenkit_manuell_….json` | „Jetzt sichern“ | dauerhaft |
| `spesenkit_vor_wiederherstellung_….json` | vor jeder Wiederherstellung | dauerhaft |
| `spesenkit_browserstand_/ordnerstand_/ungueltig_….json` | Konflikte bzw. unlesbare Datei (3.3a) | dauerhaft |

- Automatisch gelöscht werden ausschließlich Tagessicherungen mit genau diesem Namensmuster.
- Eine fehlgeschlagene zusätzliche Tages- oder Abschluss-Sicherung wird als Hinweis angezeigt. Die notwendigen
  Kandidaten- und Vorgängerkopien müssen dagegen erfolgreich geschrieben und geprüft sein, bevor ersetzt wird.
- *Datensicherung → SpesenKit-Ordner* listet die Sicherungen (Zeitpunkt, Art, Größe). **Wiederherstellen** prüft die
  Datei wie „JSON auswählen“, fragt ausdrücklich nach, nennt abgeschlossene Abrechnungen, die danach nicht mehr im
  aktuellen Stand wären, und sichert vorher den aktuellen Stand. Danach wird wie bei jeder Änderung lokal und im
  Ordner gespeichert. Bereits abgelegte PDFs in `Spesen` bleiben unberührt.
- „JSON auswählen“ fragt jetzt ebenfalls vor dem Ersetzen nach (mit derselben Abschluss-Warnung) und sichert bei
  verbundenem Ordner vorher den aktuellen Stand.
- Platzbedarf: Jede Sicherung enthält die Belege (Base64). Bei vielen Fotos entsprechend Laufwerksplatz einplanen.

## Fluss 1: Erfassen direkt in der Monatsübersicht

Die Monatsübersicht ist der Arbeitsplatz: „Dienstreise erfassen“, „Hotelrechnung erfassen“ und „Sonstige Kosten
erfassen“ öffnen das jeweilige Formular über dem Monat, ohne Tabwechsel. Auch Hinweise der Abschlussprüfung werden
dort bearbeitet. Die Tabs „Reisen“ und „Kosten & Belege“ bleiben für Suche und Bearbeitung über Monate. Ungespeicherte
Eingaben sperren weiterhin Bereichs- und Monatswechsel. Berechnung, Abschluss und Datenformat sind unverändert.

## Fluss 2: Monats-Zeitleiste

„Monat im Überblick“ zeigt den gewählten Monat kompakt: je Kalendertag eine Kopfzeile mit der Verpflegungspauschale
aus `buildStatement` (mehrere Reisen eines Tages teilen sich eine Pauschale), darunter je Dienstreise und Kostenposition
eine Zeile (Zeit, Ziel, Zweck, Projekt, km bzw. Kategorie, Zahlungsart, Reisezuordnung, Betrag, „Beleg fehlt“,
Hinweise). Mehrtägige Reisen erscheinen an Folgetagen als Fortsetzung; Kosten zählen nach Rechnungsdatum. Ein Klick
öffnet den Eintrag in der Monatsübersicht. Die Zeitleiste rechnet nichts selbst (`lib/month-timeline.ts`).

## Fluss 3: Prüfen und Abschließen

- `groupClosingIssues` fasst Prüfprobleme mit gleichem Hinweistext zusammen (reine Darstellung, keine Regeländerung).
- `closingPreview` führt die Abschlussprüfung ohne Entwurf aus und blendet nur entwurfsbezogene Fehler aus; daraus
  zeigt die Monatsabrechnung „1 Erfassen · 2 Prüfen · 3 Abschließen“. Abschluss bleibt eine bewusste, bestätigte Aktion.
- Der Status oben entspricht `monthOverview` des gewählten Monats.

## Stapelerfassung

Reise- und Kostenformular haben „Speichern & nächste“ (auch Strg+Enter) und „Speichern & fertig“; die Schnellerfassung
behält „Speichern“. „Nächste“ speichert mit denselben Prüfungen wie bisher und öffnet sofort einen neuen Entwurf
(`lib/batch-entry.ts`):

- Reise: Datum = Tag nach dem Ende der vorigen Reise; Fahrzeug, Startort und Uhrzeiten bleiben, Projekt, Zweck, Ziel,
  Kilometer und Übernachtung sind leer.
- Kosten: Rechnungsdatum, Zahlungsart, bezahlt von, Reise- und Projektzuordnung bleiben; Betrag, Beschreibung, Händler,
  Rechnungsnummer und Beleg sind leer.

Ein Zähler zeigt, wie viele Einträge in dieser Runde gespeichert wurden; Abbrechen verwirft nur den offenen Entwurf.
Browsercheck: `tests/batch-entry-browser-check.mjs`.

## Layout der Monatsübersicht

- Monatsleiste oben statt Spalte links: Jahr mit Pfeilen, alle zwölf Monate in einer Zeile (Handy: 2 × 6), Stand als
  Symbol, Reiseanzahl darunter. Darunter in einer Zeile die offenen Monate („Mit … beginnen“) und „Status verstehen“.
- Monatsarbeitsbereich: Kopfzeile mit Monat, Status und Werkzeugleiste (ein Hauptknopf „Dienstreise erfassen“,
  daneben Hotel, Sonstige Kosten, Beleg). Darunter zweispaltig: links Zeitleiste, Links „Alle Reisen/Kosten
  bearbeiten“ und Prüfen; rechts mitlaufend Erstattung, Beträge und der Weg zum Abschluss mit dem Abrechnungsknopf.
  Unter 1100 px rutscht die rechte Spalte über die Zeitleiste.
- Leerer Monat: „Erste Dienstreise erfassen“ direkt in der Zeitleiste.
- Reine Darstellung – keine Änderung an Berechnung, Status, Daten oder Abläufen.

## Reiseformular kompakt

Das Fenster „Neue Dienstreise“ ist breiter und zweispaltig: links Projekt, Reisegrund/-ziel, Abfahrt und Rückkehr in
einer Zeile, Übernachtung, Mahlzeiten und „Weitere Angaben“; rechts Abwesenheitsdauer mit Bestätigung und die
Verpflegungsvorschau (je Tag eine Zeile, Summe, zustandsabhängige Hinweise sichtbar, Grundhinweise aufklappbar).
Eine Tagesreise passt ab etwa 1366 × 660 px Fensterfläche ohne Scrollen; die Speichern-Knöpfe bleiben in jedem Fall
unten sichtbar. Unter 900 px Breite einspaltig. Keine Änderung an Pflichtfeldern, Prüfungen oder Berechnung.

## Kostenformular kompakt

„Kosten & Beleg“ nutzt dasselbe breite Fenster: links Datum, Kategorie, Beschreibung, Betrag, Zahlungsart, Beleg
(eine Zeile, die ganze Fläche öffnet die Dateiauswahl) und „Weitere Angaben“; rechts Projekt, bei Hotels
Übernachtungszeitraum und Frühstück in einer Zeile, Reisevorschläge und Reisezuordnung. Warnungen bleiben sichtbar,
feste Erläuterungen stehen unter „Hinweise zur Zuordnung“ (`ReceiptLinkFields compact`; Schnellerfassung und
Beleg-Eingang unverändert). Auch eine Hotelrechnung passt ab etwa 1366 × 660 px ohne Scrollen.

## Alles aus der Monatsübersicht

Was bisher nur unter „Reisen“ bzw. „Kosten & Belege“ ging, ist jetzt auch in der Monatsübersicht erreichbar:

- **Fahrtenbuch importieren** in der Werkzeugleiste (danach „Zurück zum Monatsarbeitsbereich“).
- **Beleg-Eingang:** Hinweis „N Belege warten auf Zuordnung“ mit „Nacheinander zuordnen“ – öffnet die offenen Belege
  aller Monate der Reihe nach (älteste zuerst, „Beleg 2 von 5“); Schließen beendet die Runde.
- **Löschen** im Bearbeitungsfenster („Reise löschen“ / „Löschen“) mit Rückfrage und Eintrag im Änderungsprotokoll.
  Gelöschte Kosten aus dem Beleg-Eingang geben ihren Beleg wieder in den Eingang zurück (`lib/entry-removal.ts`).
  Gespeicherte Abrechnungen bleiben unverändert.
- **Rechenweg** je Tag direkt in der Zeitleiste.
- **Prüfen:** Die Prüfzeilen filtern die Zeitleiste (z. B. nur fehlende Belege) statt in die Listen zu wechseln.

Browsercheck: `tests/month-functions-browser-check.mjs`.

## Navigation ohne „Reisen“ und „Kosten & Belege“

Das Menü enthält nur noch Monatsübersicht, Auswertungen, Einstellungen und Datensicherung. Reisen und Kosten werden
ausschließlich über die Monatsübersicht erfasst, bearbeitet und gelöscht (Zeitleiste und Werkzeugleiste); der
Fahrtenbuch-Import öffnet sich aus der Werkzeugleiste und kehrt danach in den Monat zurück. Entfallen sind die beiden
Listen, die Schnellerfassung „Ausgabe“ (ersetzt durch „Sonstige Kosten“) und die schwebenden Knöpfe auf den übrigen
Seiten. Daten, Speicherformat, Berechnung und Exporte sind unverändert.
