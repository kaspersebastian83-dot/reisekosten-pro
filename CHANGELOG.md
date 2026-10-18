# Release Notes

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
