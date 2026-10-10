# Reisekosten Pro

Version 1.6.0 – GitHub-Pages-Ausgabe

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
