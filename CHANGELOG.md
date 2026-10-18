# Release Notes


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
