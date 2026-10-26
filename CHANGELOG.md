# Release Notes

## 1.8.2 – 26. Oktober 2026

- Über Mitternacht ohne Übernachtung (§ 9 Abs. 4a Satz 3 Nr. 3 EStG): Beginnt eine Dienstreise an einem Tag und endet
  am Folgetag, ohne dass „Auswärtige Übernachtung … tatsächlich erfolgt“ bestätigt ist, zählt die gesamte Abwesenheit
  als ein Tag. Die Teilpauschale (Schwelle wie eingestellt, gesetzlich mehr als 8 Stunden) gibt es einmal, am
  Kalendertag mit dem überwiegenden Teil; bei gleichen Teilen am Abfahrtstag mit Hinweis. Vorher bekam jede
  Fahrt über Mitternacht An- und Abreisetag, auch eine Nachtfahrt 22:00–01:00.
  Mit bestätigter Übernachtung, bei mehr als einem Datumswechsel oder mit manueller Abwesenheitskorrektur wie bisher.
  Auch bei 24 Stunden und mehr bleibt es bei der Teilpauschale. Am nicht angesetzten Tag stehen die echten Zeiten
  (Abfahrt bis Tagesende bzw. Tagesbeginn bis Rückkehr), nicht 00:00–23:59.
  Andere Fahrten am selben Tag zählen dazu. Beträge kommen weiter aus den hinterlegten Tarifen.
- Begründung je Tag nennt die Regel; Hinweis in der Vorschau beim Erfassen. Haken bei genau einer Nacht:
  „Auswärtige Übernachtung zwischen Abfahrt und Rückkehr tatsächlich erfolgt“.
- Bereits abgeschlossene Monatsabrechnungen bleiben eingefroren; bei einer Korrektur zeigt der Vergleich die Änderung.
- Tests: elf Fälle in `calculations.test.ts` (Nachtfahrt unter der Schwelle, überwiegend vor/nach Mitternacht,
  Gleichstand, mit Übernachtung, zwei Datumswechsel, manuelle Korrektur, 24 Stunden und mehr, Zeiten am anderen Tag,
  mit Tagesfahrt am selben Tag, Monatswechsel).

## 1.8.1 – 26. Oktober 2026

- Speichern im selben Tab: „Bisher: …“ im Feld „Verwendetes Fahrzeug“ (Dienstreise → Weitere Angaben) ließ das
  Fahrzeug der Fahrt leer. Danach meldete schon ein einzelner Tab „Die Daten wurden in einem anderen Tab geändert“,
  und nichts wurde mehr gespeichert. Jetzt lässt „Bisher: …“ das Fahrzeug unverändert, und der Vergleich mit dem
  gespeicherten Stand prüft beide Seiten gleich aufbereitet. Echte Änderungen aus einem anderen Tab werden weiterhin
  erkannt. Speicherformat unverändert.
- Link „Handbuch“ (Buch-Symbol) in der Seitenleiste unter „Projektzentrale“: öffnet AidKit „SpesenKit Schritt für Schritt“
  (`../aidkit/#app-spesenkit`) im eigenen Fenster.
- Tests: Regression für den Vergleich (Vitest), Prüfung der festen Handbuch-Adresse im Build und
  `tests/fahrzeug-speichern-browser-check.mjs` (zwei Fahrten nacheinander, einmal mit „Bisher: …“).

## Noch nicht veröffentlicht – Buchhaltungs-PDF

- Corporate Identity der Spektron-Suite: blaue App-Palette, mitgeliefertes Firmenlogo als dezentes
  Wasserzeichen auf allen Seiten und Firmenname „Dr. Schiffers & Partner“ in der Fußzeile.

- A4-Abrechnung mit hervorgehobenen Stammdaten und Erstattungsbetrag, Reisen, Tagespauschalen,
  Zahlungshinweisen und nummerierter Belegzuordnung; wiederholte Tabellenköpfe und durchgehende Seitenzahlen.
- PNG/JPEG, lange Bons mit Überlappung und sämtliche Seiten lesbarer Original-PDFs als Anlagen;
  fehlende oder nicht einbettbare Dateien werden ausdrücklich gekennzeichnet.
- Gleiche Belegreihenfolge und zusätzliche Zuordnungsliste im ZIP. Berechnungsregeln und eingefrorene
  Monatsstände bleiben unverändert. Reproduzierbare Musterabrechnung und gezielte Regressionstests.

## Noch nicht veröffentlicht – konkurrierende Ordnerspeicherung

- Vor jedem Ersetzen von `spesenkit.json`: geprüfte Kopien des Speicherkandidaten und des gelesenen
  Vorgängers mit UUID im Namen. Sie bleiben dauerhaft in `Sicherungen`, auch bei Fehlern oder konkurrierenden
  Terminalservern, und lassen sich unter Datensicherung wiederherstellen.
- Revisions- und Inhaltsvergleich sowie erneute Dateivergleiche vor dem Ersetzen; erkannte fremde Stände
  führen zur Konfliktentscheidung. Abweichender Inhalt mit gleicher/älterer Revision wird nicht automatisch geladen.
- Kopien werden zurückgelesen; Fehler beim Sichern oder Prüfen stoppen das Ersetzen. Vorhandene Abschlüsse,
  Datenformat 1 und ältere Sicherungsnamen bleiben kompatibel.
- Keine globale Dateisperre: zwei getrennte Sitzungen können im letzten Rennfenster weiterhin beide ihren
  eigenen Dateistand bestätigen. Bei aktualisierten Schreibern bleiben beide Stände als Kopien erhalten;
  Erfolg bedeutet Rücklesebestätigung zum Prüfzeitpunkt, keine dauerhafte Exklusivität.

## 1.8.0 – Abschlussdurchlauf

Zusammenfassung der Version: Ordnerablage und Sicherungen, Erfassen und Prüfen in der Monatsübersicht, Monatsleiste,
Stapelerfassung, kompakte Formulare, Beleg-Eingang der Reihe nach, Löschen im Fenster, ohne die Reiter „Reisen“ und
„Kosten & Belege“.

- Reise löschen löst die Reisezuordnung zugeordneter Kosten und Belege (mit Protokolleintrag) statt sie auf eine
  gelöschte Reise zeigen zu lassen; die Rückfrage nennt die Anzahl.
- Monatswechsel während des Fahrtenbuch-Imports behält „Zurück zum Monatsarbeitsbereich“ (führt in den neuen Monat).
- Versionsnummer 1.8.0; Browserchecks simulieren App-Updates unabhängig von der Versionsnummer.

## Reiter „Reisen“ und „Kosten & Belege“ entfernt (Schritt 2 von 2)

- Menü: Monatsübersicht, Auswertungen, Einstellungen, Datensicherung.
- Import kehrt nach Abschluss in die Monatsübersicht zurück („Zur Monatsübersicht“).
- Schnellerfassung „Ausgabe“ und schwebende Beleg-/Ausgabe-Knöpfe entfallen; Kosten über „Sonstige Kosten“ bzw.
  „Beleg fotografieren“ in der Monatsübersicht.
- „Prüfen“ zeigt Belege im Eingang mit „Belege nacheinander zuordnen“.
- Browserchecks auf die Monatsübersicht umgestellt (Zeitleiste statt Listen).
- Daten, Speicherformat, Berechnung und Exporte unverändert.

## Alles aus der Monatsübersicht (Schritt 1 von 2)

- Fahrtenbuch-Import in der Werkzeugleiste; Werkzeugleiste mit kürzeren Beschriftungen.
- Beleg-Eingang der Reihe nach zuordnen („Nacheinander zuordnen“, „Beleg 2 von 5“).
- Reise und Kostenposition im Bearbeitungsfenster löschen (mit Rückfrage, Änderungsprotokoll; Beleg geht zurück in
  den Eingang).
- Rechenweg je Tag in der Zeitleiste; Prüfzeilen filtern die Zeitleiste.
- Die Reiter „Reisen“ und „Kosten & Belege“ bleiben in diesem Schritt noch erhalten.

## Kostenformular ohne Scrollen

- „Kosten & Beleg“ zweispaltig im breiten Fenster: Betrag und Beleg links, Projekt und Reisezuordnung rechts.
- Belegauswahl als eine kompakte Zeile; Hotelzeitraum und Frühstück nebeneinander.
- Feste Erläuterungen aufklappbar, Warnungen weiterhin sichtbar. Prüfungen und Speicherlogik unverändert.

## Reiseformular ohne Scrollen

- „Neue Dienstreise“ zweispaltig im breiteren Fenster: Eingaben links, Abwesenheit, Bestätigung und
  Verpflegungsvorschau rechts. Abfahrt/Rückkehr in einer Zeile, Erklärtexte gekürzt bzw. aufklappbar.
- Speichern-Knöpfe bleiben in allen Fenstern unten sichtbar, auch wenn gescrollt werden muss.
- Prüfungen, Pflichtfelder und Berechnung unverändert.

## Veraltete Browserchecks repariert (nur Tests)

- `browser-check`, `feature-browser-check`, `receipt-linking-browser-check`: Freigabe über den bestätigten Abschluss
  statt über das Statusfeld; synthetische Fahrten mit bestätigter Abwesenheit; Beleg-Knopf im Monatsarbeitsbereich;
  Rückfrage vor dem Wiederherstellen einer Sicherung bestätigen; gespeicherte Entwürfe bleiben eingefroren – neue
  Einstellungen werden mit „Neue Version erstellen“ geprüft.
- `branding-browser-check`: Wiederherstellungsrückfrage bestätigen. Läuft mit einem Build von `be44696` als
  `LEGACY_DIST`.
- Damit laufen alle Browserchecks wieder vollständig. Keine Änderung an der App.

## Neues Layout der Monatsübersicht

- Monatsleiste oben (alle zwölf Monate in einer Zeile) statt einer langen Liste links; die Seite gewinnt die volle Breite.
- Kopfzeile mit Monat, Status und schlanker Werkzeugleiste statt des großen blauen Balkens und sechs gleichrangiger Knöpfe.
- Rechts eine mitlaufende Spalte mit Erstattung, Beträgen und „Erfassen · Prüfen · Abschließen“; links die Zeitleiste.
- Doppelte Monatsplakette oben in der Monatsübersicht entfernt; Erläuterungen zu kleinen Hinweisen bzw. aufklappbar.
- Browserchecks an die neue Anordnung angepasst.

## Stapelerfassung am Monatsende

- Reise- und Kostenformular: „Speichern & nächste“ (Strg+Enter) und „Speichern & fertig“. Das Fenster bleibt offen,
  der nächste Entwurf ist vorbelegt (Reise: Folgetag, Fahrzeug, Startort, Uhrzeiten; Kosten: Datum, Zahlungsart,
  Reise-/Projektzuordnung), Inhaltliches bleibt leer. Fokus springt ins erste Feld.
- Zähler „N … in dieser Runde erfasst“; Prüfungen und Doppelerfassungs-Hinweise unverändert, die Zeitleiste
  aktualisiert sich im Hintergrund.
- Browserchecks auf „Speichern & fertig“ umgestellt, neuer `batch-entry-browser-check`.

## Prüfen und Abschließen (Fluss, Schritt 3)

- Abschlussprüfung gruppiert gleichartige Hinweise (z. B. „Projektzuordnung ist unklar · 11 Einträge“); große Gruppen
  eingeklappt, blockierende Fehler immer offen; Bearbeiten-Knopf je Eintrag in einer Zeile.
- Monatsabrechnung zeigt den Weg „1 Erfassen · 2 Prüfen · 3 Abschließen“ mit Stand; die Zahlen stammen aus derselben
  Prüfung wie der Abschluss (Vorschau ohne Entwurf, nichts wird angelegt).
- Oben steht jetzt der Status des gewählten Monats (wie in der Jahresleiste) statt einer monatsübergreifenden Zahl.
- Abschlussdialog fasst verbleibende Hinweise als Gruppen zusammen.

## Monats-Zeitleiste (Fluss, Schritt 2)

- Neuer Abschnitt „Monat im Überblick“ in der Monatsübersicht: je Tag Datum und Verpflegungspauschale (aus der
  Monatsberechnung), darunter je Reise und Kostenposition eine Zeile mit Hinweis- und Belegmarkierung.
- Mehrtägige Reisen erscheinen an Folgetagen als Fortsetzung, Kosten nach Rechnungsdatum.
- Klick auf eine Zeile öffnet sie direkt dort zum Bearbeiten.

## Erfassen direkt in der Monatsübersicht (Fluss, Schritt 1)

- Dienstreise, Hotelrechnung und sonstige Kosten öffnen sich als Formular über dem Monat – kein Wechsel in „Reisen“
  bzw. „Kosten & Belege“; nach Speichern oder Abbrechen geht es im Monat weiter.
- Hinweise aus der Abschlussprüfung werden ebenfalls dort bearbeitet; die Prüfung bleibt sichtbar.
- Keine doppelten „Beleg“/„Ausgabe“-Knöpfe mehr oben in der Monatsübersicht.
- Reiseformular: vor der ersten Eingabe ein ruhiger Hinweis statt roter Fehler.
- Kostenformular: Händler, Rechnungsnummer, Steuer, Erstattungsstatus und Anteil unter „Weitere Angaben“
  (automatisch geöffnet, wenn dort Werte stehen).
- Browserchecks an den neuen Ablauf angepasst; `workflow-browser-check` läuft wieder vollständig,
  `review-browser-check` bestätigt die Wiederherstellungsrückfrage aus 3.3c.

## Sicherungsstände im SpesenKit-Ordner (Schritt 3.3c)

- Tägliche Sicherung des Stands vor der ersten Änderung des Tages; Aufbewahrung 14 Tage + 12 Monatsstände.
- Sicherung nach jedem Monatsabschluss, manuelle Sicherung, Sicherung vor jeder Wiederherstellung.
- Liste unter Datensicherung mit Wiederherstellen (Bestätigung, Warnung bei wegfallenden Abschlüssen).
- „JSON auswählen“ fragt vor dem Ersetzen nach und sichert den aktuellen Stand.

## Ablage abgeschlossener Abrechnungen (Schritt 3.3b)

- Nach dem Abschluss: PDF und ZIP (optional Excel) automatisch in `SpesenKit/Spesen/Jahr/Monat`, gleiche Inhalte und
  Namen wie die Export-Knöpfe; nie überschreiben, Korrekturen als V02 daneben.
- Abrechnungsansicht: Ablagestand, „Im SpesenKit-Ordner ablegen“, „Abrechnung drucken“.
- Ablagefehler ändern den Abschluss nicht; Hinweis mit „Erneut ablegen“.

## Persönlicher SpesenKit-Ordner (Schritt 3.3a)

- Einmal den persönlichen Mitarbeiterordner wählen; jede Änderung wird zusätzlich in
  `SpesenKit/Daten/spesenkit.json` gespeichert (Revision, Rücklesekontrolle, Vorgängerstand).
- Beim Start Abgleich Browser ↔ Datei: eindeutige Fälle automatisch, sonst Entscheidungsdialog mit Sicherungskopie.
- Monatsabschluss/Korrektur melden Erfolg erst nach dem Schreiben in den Ordner.
- Speicherstatus in der Seitenleiste, Hinweise bei fehlendem Ordner, Zugriff, Schreibfehler, fehlender/unlesbarer Datei.
- Unverändert: Datenbankidentität, Datenformat, Berechnung, Abschlusslogik, Exporte, Service Worker.

## Suite-Einbindung und neues Icon

- Neues App-Icon (Koffer mit Euro-Zeichen, Amber) für Startbildschirm, Browser-Tab und Seitenleiste; im Stil der übrigen Apps.
- Seitenleiste: Rückweg „Projektzentrale · Spektron · alle Apps“ (`../Projektzentrale/`).
- Unverändert: Datenbank, Berechnung, Abschluss, Service Worker, Manifest-Identität (Name, id, scope), Exporte.


## Fehlerbehebung: App startete nach einem Update nicht mehr

- Ursache: Bei der Installation einer neuen Version holte der Service Worker die
  `index.html` aus dem HTTP-Cache des Browsers (GitHub Pages erlaubt 10 Minuten).
  Wer die App kurz vor einem Deploy geöffnet hatte, bekam die alte `index.html`
  neben den neuen Programmdateien gespeichert. Die alten Dateien gibt es nach dem
  Deploy nicht mehr (404) – Anzeige „Die Anwendung konnte nicht geladen werden“,
  dauerhaft, auch nach „Erneut laden“ (gesehen in Safari nach PR #9).
- Die Installation lädt die App-Shell jetzt immer frisch vom Server (`cache: "reload"`)
  und prüft, dass jede in der `index.html` genannte Programmdatei mitgespeichert ist;
  sonst wird die Installation verworfen und beim nächsten Start wiederholt.
- Selbstreparatur: Findet die neue Version eine laufende kaputte Version (Shell ohne
  ihre Dateien), ersetzt sie diese sofort und lädt die betroffenen Tabs neu. Ein
  „Erneut laden“ genügt. Intakte Versionen werden wie bisher erst nach Zustimmung
  aller Tabs („Jetzt aktualisieren“) ersetzt. Gespeicherte Daten bleiben unberührt.

## SpesenKit – sichtbare Umbenennung

- Produktname und Untertitel: SpesenKit · Dienstreisen · Spesen · Abrechnungen.
- Branding, Start-/Fehleranzeigen, PWA-Name, SK-Icons und Excel-Ersteller aktualisiert.
- Repository `reisekosten-pro`, Pages-URL, Installationsidentität, Datenbank,
  Backups, Abrechnungen und Berechnungen unverändert; keine Migration oder Rücksetzung.
- Der dienstreiseorientierte Workflow aus PR #3 bleibt erhalten.

## 1.7.0 – zur Prüfung, noch nicht veröffentlicht

- Importprüfung zeigt alle CSV/XLSX-Fahrten mit echten Quellzeilen, Status,
  Ausschlussgründen und Warnungen. Filter und Auswahl bestimmen die Übernahme.
  Ungültige Daten sind gesperrt; Cancel verändert keine gespeicherten Daten.
- Bestätigung prüft Dateiduplikate und aktuellen IndexedDB-Stand erneut und
  speichert Fahrten/Profil atomar; Doppelklicks sind abgefangen. Privat- und
  Arbeitsweg-Fahrten bleiben ohne Erstattung und werden vor Import ausgeschlossen.
- Tages-/Fahrt-/Monatsdetails erklären dieselben Berechnungsergebnisse inklusive
  Mahlzeiten (auch null Prozent), Kilometer, Ausgaben und Cent-Rundungen.
  Neue eingefrorene Abrechnungen behalten den Erklärungsstand; historische
  Lücken alter Snapshots werden ausdrücklich angezeigt.
- Laufende App-Version aus package.json plus Build-Commit unter Einstellungen.
  Wartende Updates lassen sich verschieben oder ausdrücklich aktivieren;
  offene Eingaben/Importe und andere App-Tabs schützen vor unbeabsichtigtem Reload.
  Aktive HTML-Shell und Assets bleiben konsistent, einschließlich Offline-Start.
- Header bei Tabletbreite und Fahrzeugfelder auf schmaleren Desktopfenstern
  umbrechen, ohne die Seite horizontal zu verbreitern.
- PR-CI prüft Tests/TypeScript/Build ohne Veröffentlichung. Erst eine spätere
  freigegebene Übernahme nach main löst das Pages-Deployment aus.

Korrekturen aus dem PR-Review:
- Veraltete Tabs überschreiben neuere Fahrten, Belege oder Abschlüsse nicht mehr:
  Vergleich mit dem zuletzt gespeicherten Stand innerhalb der Schreibtransaktion,
  mit sichtbarer Konfliktmeldung und Sicherungsmöglichkeit.
- Suchfilter ändern nur die sichtbaren Tage, nicht die Berechnungsgrundlage.
  Fahrten, die im Vormonat beginnen, erscheinen auch an ihren Folgetagen.
- Zustimmende Tabs bleiben bis Update-Aktivierung/Abbruch gesperrt; die Reload-
  Bereitschaft besteht vor der Antwort. Ein währenddessen neu geöffneter Tab
  verhindert die Aktivierung. Datei-/Sicherungslesen blockiert Updates; ältere
  Dateilese-Ergebnisse können eine neuere Auswahl nicht ersetzen.
- CSV-Quellzeilen folgen den tatsächlichen Parser-Datensätzen; Quote-Fehler
  sperren den betroffenen Datensatz. Uhrzeiten müssen vollständig gültig sein,
  numerische Excel-Bruchteile werden vor formatierten Zeitstrings erkannt.
- Kilometerdetails zeigen den verwendeten Satz mit seiner tatsächlichen
  Genauigkeit statt einer irreführenden Rundung auf zwei Dezimalstellen.
- Der explizite Daten-Reset verwendet ebenfalls die geschützte Schreibtransaktion.

Keine neuen Abhängigkeiten, Speicherkeys oder Schema-Migrationen. Bestehende
Daten und Belege bleiben erhalten. Erklärungsfelder sind optionale Ergänzungen
in Abrechnungssnapshots. Keine Änderung von Tarifen oder Erstattungsformeln.

Verifikation: npm test (87 Unit-/Regressionstests, TypeScript, Produktionsbuild,
1 statischer Buildtest); vorhandene Chromium-Workflows (14 Checks); neue
Chromium-Features (8 Checks) und PR-Review-Regressionen (6 Checks) unter /reisekosten-pro/, 390px und 820px.
Mit synthetischen Daten und isolierten Browserprofilen geprüft: keine Writes
vor Bestätigung, Cancel/Selektion/Duplikate/Doppelklick/Transaktionsfehler,
aktueller Speicher bei Bestätigung, eingefrorene Erklärung, verzögertes und
angenommenes Update, mehrere Tabs, laufende vs. simulierte neue Version,
IndexedDB/localStorage-Erhalt und Offline-Start. Reale iPhone-/iPad-Geräte,
Safari/WebKit und eine Veröffentlichung dieses Releases sind nicht geprüft.

Kein CSV/XLSX-Ausgabenimport vorhanden: vorhandene Belegprüfung/OCR und
JSON-Sicherung/Wiederherstellung bleiben die unterstützten Wege für Ausgaben.
Der bestehende Vite-Hinweis auf große Export-/OCR-Bundles bleibt bestehen.
