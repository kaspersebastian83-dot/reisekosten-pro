# SpesenKit – Anleitung

Stand: Version 1.8.0. SpesenKit gehört zur Büro-App-Suite **Spektron** und wird am
Büro-Terminal (RDP, eigenes Windows-Profil) in **Edge oder Chrome** genutzt.

**App öffnen:** https://kaspersebastian83-dot.github.io/reisekosten-pro/ – oder in der
Projektzentrale ganz unten rechts unter „Weitere Apps“ auf **SpesenKit**.

## Einmal einrichten

1. **Einstellungen:** Name, Wohnadresse, erste Tätigkeitsstätte und Fahrzeuge
   eintragen (Dienstwagen oder Privatwagen; beim Privatwagen Kilometerpauschale
   oder tatsächliche Kosten). Das meistens genutzte Fahrzeug als **Standard**
   markieren.
2. **Ordner einrichten** (gelber Hinweis oben oder links unten): einen eigenen
   Ordner wählen, z. B. im persönlichen Laufwerk. SpesenKit legt darin den
   Ordner `SpesenKit` an und speichert jede Änderung dort. Ohne diesen Ordner
   liegen die Daten nur im Browser – beim Abmelden oder an einem anderen
   Terminalserver können sie dann fehlen.
3. Nach einem Neustart des Browsers fragt SpesenKit einmal nach dem Zugriff auf
   den Ordner: **Zugriff bestätigen**.

## So läuft ein Monat

Alles passiert in der **Monatsübersicht**.

1. **Monat wählen:** oben in der Monatsleiste (Jan … Dez, Symbol = Stand des
   Monats). „Mit … beginnen“ springt zum ältesten Monat mit offener Abrechnung.
2. **Erfassen** über die Knöpfe oben:
   - **Dienstreise erfassen** – Projekt (Nummer und Ort, z. B. `26.0123 Köln`),
     Reisegrund, Ziel, Abfahrt und Rückkehr, Mahlzeiten. Rechts stehen
     Abwesenheitsdauer und Verpflegungsvorschau.
   - **Hotelrechnung** und **Sonstige Kosten** – Datum (Rechnungsdatum),
     Betrag, Zahlungsart, Beleg als Datei; rechts Projekt und Reisezuordnung.
   - **Beleg fotografieren** – Beleg ablegen und später zuordnen.
   - **Fahrtenbuch importieren** – Vimcar-CSV oder andere CSV/XLSX.
3. **Viele Einträge am Stück:** **Speichern & nächste** (oder Strg+Enter) hält
   das Fenster offen und belegt den nächsten Eintrag vor (Reise: Folgetag,
   Fahrzeug, Uhrzeiten; Kosten: Datum, Zahlungsart, Reise). **Speichern &
   fertig** schließt.
4. **Monat im Überblick:** je Tag die Verpflegung, darunter Reisen und Kosten.
   Ein Klick auf eine Zeile öffnet sie zum **Bearbeiten oder Löschen**.
   „Rechenweg“ erklärt die Berechnung des Tages.
5. **Beleg-Eingang:** Warten fotografierte Belege, erscheint „N Belege warten
   auf Zuordnung“ – **Nacheinander zuordnen** zeigt sie der Reihe nach.
6. **Prüfen:** Die Prüfzeilen (ungeprüfte Reisen, Kosten, fehlende Belege,
   mögliche Duplikate) zeigen in der Zeitleiste genau die betroffenen Einträge.
   „Eindeutige Zeiten bestätigen“ bestätigt vollständige Fahrten gesammelt.
7. **Abschließen:** rechts **Spesenabrechnung erstellen** → Abschlussprüfung →
   **Monatsabrechnung abschließen** → **Verbindlich abschließen**. Danach ist
   der Stand eingefroren; spätere Änderungen erscheinen als Korrekturentwurf
   mit neuer Version.
8. **Ablage:** Abgeschlossene Abrechnungen legt SpesenKit selbst im Ordner unter
   `SpesenKit\Spesen\<Jahr>\<Monat>\` ab (PDF und ZIP mit Belegen; Excel
   zuschaltbar). „Abrechnung drucken“ öffnet die PDF zum Drucken. Exporte
   (PDF, Excel, CSV, DATEV-CSV, ZIP) gibt es zusätzlich in der Abrechnung.

Freigabe und Auszahlung sind getrennt: SpesenKit gibt nichts automatisch frei
und zahlt nichts aus.

## Sicherungen

- Automatisch im Ordner `SpesenKit\Sicherungen`: einmal täglich der Stand vor
  der ersten Änderung (14 Tage, dazu je Monat einer für 12 Monate) und nach
  jedem Monatsabschluss (bleibt dauerhaft).
- **Datensicherung → Jetzt sichern** legt sofort eine Sicherung an;
  „Wiederherstellen“ fragt vorher nach und sichert den aktuellen Stand.
- Zusätzlich lässt sich unter **Datensicherung** eine JSON-Sicherung
  herunterladen und wieder einspielen.
- Vor jedem Schreibversuch bleiben zusätzlich geprüfte **Speicherkandidaten** und
  Vorgängerstände erhalten. Unter **Datensicherung → Sicherungen → Speicherkandidaten
  und Vorgänger anzeigen** lassen sich auch konkurrierende oder fehlgeschlagene
  Versuche nach Prüfung wiederherstellen. Diese Kopien werden nicht automatisch
  gelöscht und enthalten ebenfalls sämtliche Belege.
- Bei abweichenden Datenständen ausdrücklich entscheiden, welcher Stand gilt.
  Alle offenen Sitzungen sollten dieselbe aktuelle App-Version verwenden; eine
  serverübergreifende Sperre gibt es nicht. Deshalb möglichst nur eine Sitzung
  gleichzeitig bearbeiten. Die Kopien sichern die Wiederherstellung ab.

## Beleg-Erkennung

Beim ersten Einsatz der Texterkennung wird einmalig ein Sprachmodell geladen.
Danach läuft die Erkennung im Browser; der Beleg wird dabei nicht an den
Anbieter der App übertragen. Die Erkennungsvorschläge immer kurz prüfen.

Die Abrechnungs-PDF nummeriert Kosten und Belege automatisch. Bildbelege und
lesbare PDF-Belege werden in derselben Reihenfolge angehängt; lange Bons werden
auf mehrere Seiten verteilt. HEIC, geschützte oder defekte Dateien sowie PDFs mit
Anmerkungen oder Formularfeldern erhalten einen verständlichen Hinweis zum
separaten Beifügen. Fehlende Belege sind ebenfalls gekennzeichnet. Der ZIP-Export
enthält alle vorhandenen Originaldateien mit einem passenden Belegverzeichnis.

## Fahrtenbuch-Import

Vimcar: den Monat als **CSV** exportieren (der Vimcar-PDF-Bericht enthält keine
Uhrzeiten). Beim erkannten Vimcar-Profil zählt nur `Betrieb_km`; Arbeitsweg und
Privatfahrten werden nicht angesetzt. Die Abwesenheit eines Tages reicht von der
ersten bis zur letzten Betriebsfahrt. Die Importprüfung zeigt jede Zeile mit
Status; übernommen wird erst nach Bestätigung. Danach führt „Zur
Monatsübersicht“ zurück in den Monat.

## Für Entwickler

Lokal starten mit Node.js 22 oder neuer (`npm ci`, `npm run dev`; unter
Windows `START-WINDOWS.bat`, unter macOS `START-MAC.command`). Prüfung mit
`npm test`, Browserchecks siehe README. Veröffentlichung über GitHub Pages:
[GITHUB-PAGES-ANLEITUNG.md](GITHUB-PAGES-ANLEITUNG.md).

## Wichtiger fachlicher Hinweis

Die Anwendung dokumentiert und berechnet Reisekosten anhand der hinterlegten,
versionierten Konfiguration. Sie ersetzt keine steuerliche Einzelfallberatung.
Insbesondere die Drei-Monats-Regel, erste Tätigkeitsstätte, Auslandsreisen und
interne Firmenregelungen müssen bei Zweifeln fachlich geprüft werden.
