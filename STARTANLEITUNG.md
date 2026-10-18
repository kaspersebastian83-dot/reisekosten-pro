# SpesenKit – Startanleitung

Für die Veröffentlichung als installierbare Web-App siehe
[GITHUB-PAGES-ANLEITUNG.md](GITHUB-PAGES-ANLEITUNG.md).

## Schnellstart

1. Installieren Sie einmalig Node.js 22 oder neuer von `nodejs.org`.
2. Entpacken Sie den Projektordner.
3. Öffnen Sie im Projektordner ein Terminal.
4. Führen Sie `npm install` aus.
5. Starten Sie die App mit `npm run dev`.
6. Öffnen Sie die im Terminal angezeigte lokale Adresse im Browser.

Auf dem Mac genügt normalerweise ein Doppelklick auf `START-MAC.command`. Die einmalige Installation läuft automatisch und die App öffnet sich anschließend im Browser.

### Windows: Download wurde unterbrochen

Meldungen mit `deprecated` sind nur Hinweise aus verwendeten Bibliotheken und
kein Fehler. Bei `ECONNRESET` wurde die Internetverbindung während der
einmaligen Installation unterbrochen. Ab Version 1.5.1 versucht
`START-WINDOWS.bat` den Download automatisch bis zu dreimal erneut und erkennt
unvollständige Installationen.

Falls Windows zusätzlich `EPERM` meldet, schließen Sie alle geöffneten
Terminal- und Reisekosten-Fenster und starten Sie Windows einmal neu. Starten
Sie anschließend wieder `START-WINDOWS.bat`. Der Paket-Zwischenspeicher liegt
künftig im Benutzerprofil und nicht mehr im Programmordner.

## Fahrten importieren

1. Öffnen Sie **Fahrten importieren**.
2. Exportieren Sie in Vimcar den gewünschten Monat als **CSV** und wählen Sie
   diese Datei aus. Für andere Fahrtenbücher sind auch XLSX oder CSV
   möglich.
3. Wählen Sie das Tabellenblatt und kontrollieren Sie die vorgeschlagene Spaltenzuordnung.
4. Prüfen Sie die Vorschau und bestätigen Sie den Import.
5. Kontrollieren Sie anschließend unter **Reisen** die gelb markierten Abwesenheitszeiten.

Beim erkannten Vimcar-Profil importiert die App nur `Betrieb_km`. Arbeitsweg-
und Privatfahrten werden nicht als Reisekosten angesetzt. Die Abwesenheitsdauer
eines Tages beginnt mit der ersten Betriebsfahrt und endet mit der letzten
Betriebsfahrt; `Fahrtdauer_min` bleibt als reine Fahrzeit dokumentiert. Eine
Privatfahrt vor der ersten Betriebsfahrt wird gelb zur Bestätigung markiert.

Wohnadresse und erste Tätigkeitsstätte werden einmalig unter **Einstellungen**
eingetragen. Nahe GPS-Hausnummern derselben Straße werden bei der
Adresszuordnung toleriert.

Der bereitgestellte Vimcar-PDF-Bericht enthält keine Uhrzeiten und reicht daher
nicht für eine Spesenberechnung. Laden Sie den CSV-Export desselben Zeitraums
hoch. Die App erklärt dies verständlich, wenn versehentlich die PDF gewählt
wurde.

## Monatsabrechnung

1. Wählen Sie oben den Abrechnungsmonat.
2. Folgen Sie auf der Startseite den vier Schritten **Fahrten**, **Ausgaben**, **Prüfen** und **Abschließen**.
3. Erfassen Sie typische Kosten über **Ausgabe**. Wählen Sie beispielsweise Parken, geben Sie nur den Betrag ein und drücken Sie Enter oder **Speichern**. Datum, Zahlungsart, Steuer und Reise werden vorgeschlagen.
4. Für einen Beleg klicken Sie auf **Beleg** beziehungsweise auf das Kamera-Symbol am unteren Bildschirmrand. Auf Smartphone und iPad öffnet sich direkt die Kamera.
5. Die lokale Texterkennung schlägt Datum, Betrag, Händler, Kategorie und Umsatzsteuer vor. Prüfen Sie die Angaben kurz und wählen Sie **Bestätigen & Ausgabe anlegen**. Die passende Reise wird nach dem Datum vorgeschlagen.
6. Falls Sie gerade keine Zeit haben, wählen Sie **Nur im Eingang speichern**. Offene Belege können später unter **Kosten und Belege** kontrolliert werden.
7. Bestätigen Sie eindeutige importierte Fahrten gesammelt. Mahlzeiten lassen sich unmittelbar in den Tageskarten anklicken.
8. Öffnen Sie **Monatsabrechnungen**, kontrollieren Sie die Einzelaufstellung und exportieren Sie PDF, Excel, CSV, DATEV-CSV oder ein ZIP-Paket. Die PDF enthält ein Belegverzeichnis und fügt JPG-/PNG-Belege als Anhangseiten ein.
9. Nach dem Status **freigegeben** wird die Abrechnung gesperrt. Korrekturen erfolgen über eine neue Version.

## Dienstwagen und Privatwagen einrichten

1. Öffnen Sie **Einstellungen**.
2. Tragen Sie unter **Fahrzeuge & Kilometererstattung** Fahrzeug/Modell und Kennzeichen ein.
3. Wählen Sie **Dienstwagen** oder **Privatwagen**.
4. Beim Privatwagen wählen Sie zwischen **Kilometerpauschale** und **tatsächlichen Fahrzeugkosten**.
5. Markieren Sie das meistens verwendete Fahrzeug als **Standard** und speichern Sie die Einstellungen.

Das Standardfahrzeug wird bei neuen und importierten Fahrten vorgeschlagen. In einer Reise können Sie jederzeit ein anderes Fahrzeug wählen. Für einen Dienstwagen berechnet die App keine persönliche Kilometerpauschale. Die Monatsübersicht sowie PDF-, Excel- und CSV-Export enthalten Name, Monat, Fahrzeugart, Fahrzeug/Modell und Kennzeichen.

## Beleg-Eingang

Der **Beleg-Eingang** ist unter **Kosten & Belege** dauerhaft sichtbar. Über **Beleg fotografieren** können Sie einen Beleg aufnehmen und mit **Nur im Eingang speichern** für die spätere Prüfung ablegen.

Beim ersten Einsatz der Texterkennung wird einmalig ein Sprachmodell geladen. Danach läuft die Erkennung im Browser; der fotografierte Beleg wird dabei nicht an den Anbieter der App übertragen. PDF- und HEIC-Belege bleiben im ZIP-Export im Original erhalten, werden jedoch nicht zuverlässig automatisch gelesen oder als Bildseite in die PDF eingebettet.

## Start auf dem Mac, wenn Apple die Datei blockiert

1. Klicken Sie mit der rechten Maustaste auf `START-MAC.command` und wählen Sie **Öffnen**.
2. Bestätigen Sie anschließend noch einmal **Öffnen**.
3. Falls diese Auswahl nicht erscheint, öffnen Sie **Systemeinstellungen → Datenschutz & Sicherheit**, scrollen nach unten und klicken bei der blockierten Datei auf **Dennoch öffnen**.
4. Als sichere Alternative öffnen Sie das Terminal, tippen `xattr -dr com.apple.quarantine ` mit einem Leerzeichen am Ende, ziehen den entpackten Projektordner in das Terminalfenster und drücken Enter. Danach können Sie `START-MAC.command` doppelklicken.

## Datensicherung

Unter **Datensicherung** laden Sie eine vollständige JSON-Sicherung herunter. Bewahren Sie diese Datei an einem sicheren Ort auf. Über **Sicherung wiederherstellen** lässt sich der Datenstand auf demselben oder einem anderen Gerät einspielen.

## Lokale Daten und Offline-Nutzung

Die App speichert Daten in IndexedDB des verwendeten Browsers. Löschen Sie die Browserdaten nicht, ohne zuvor eine Sicherung zu erstellen. Nach dem ersten erfolgreichen Laden kann die App als PWA installiert und weitgehend offline verwendet werden.

## Wichtiger fachlicher Hinweis

Die Anwendung dokumentiert und berechnet Reisekosten anhand der hinterlegten, versionierten Konfiguration. Sie ersetzt keine steuerliche Einzelfallberatung. Insbesondere die Drei-Monats-Regel, erste Tätigkeitsstätte, Auslandsreisen und interne Firmenregelungen müssen bei Zweifeln fachlich geprüft werden.
