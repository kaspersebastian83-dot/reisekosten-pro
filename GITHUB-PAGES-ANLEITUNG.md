# Reisekosten Pro auf GitHub Pages veröffentlichen

## 1. Vor dem Wechsel sichern

Öffnen Sie die bisherige lokale App und wählen Sie **Datensicherung → Sicherung
herunterladen**. Bewahren Sie die JSON-Datei auf. Die veröffentlichte App hat
eine andere Webadresse als `localhost` und kann deshalb nicht automatisch auf
die Browserdaten der lokalen Installation zugreifen.

## 2. Repository erstellen

1. Öffnen Sie [github.com/new](https://github.com/new).
2. Vergeben Sie beispielsweise den Namen `reisekosten-pro`.
3. Wählen Sie **Private**, wenn Ihr GitHub-Tarif GitHub Pages für private
   Repositories unterstützt. Andernfalls kann das Repository öffentlich sein:
   Diese Ausgabe enthält keine persönlichen Vorgabedaten.
4. Lassen Sie README, `.gitignore` und Lizenz zunächst abgewählt.
5. Klicken Sie auf **Create repository**.

## 3. Projekt hochladen

Entpacken Sie das bereitgestellte ZIP. Laden Sie den **Inhalt** des Ordners in
das Repository hoch, nicht den übergeordneten Ordner und nicht die ZIP-Datei.
Im Repository müssen unter anderem diese Einträge sichtbar sein:

- `.github/workflows/deploy-pages.yml`
- `app/`
- `lib/`
- `public/`
- `src/`
- `index.html`
- `package.json`
- `package-lock.json`

Auf der GitHub-Webseite wählen Sie **Add file → Upload files**, ziehen die
Dateien und Ordner in das Uploadfeld und bestätigen mit **Commit changes**.
Falls der Browser den versteckten Ordner `.github` nicht mitnimmt, laden Sie
diesen anschließend separat hoch oder verwenden Sie GitHub Desktop.

## 4. GitHub Pages aktivieren

1. Öffnen Sie im Repository **Settings**.
2. Wählen Sie links **Pages**.
3. Stellen Sie unter **Build and deployment → Source** auf **GitHub Actions**.
4. Öffnen Sie oben den Reiter **Actions**.
5. Wählen Sie **GitHub Pages bereitstellen**.
6. Warten Sie, bis Build und Deployment grün markiert sind.

Die Website ist anschließend typischerweise erreichbar unter:

`https://IHR-GITHUB-NAME.github.io/reisekosten-pro/`

## 5. Persönliche Daten wiederherstellen

1. Öffnen Sie die neue GitHub-Pages-Adresse immer im gleichen Browser.
2. Öffnen Sie **Datensicherung**.
3. Wählen Sie **Sicherung wiederherstellen** und Ihre zuvor exportierte
   JSON-Datei.
4. Kontrollieren Sie unter **Einstellungen** Name, Wohnadresse, erste
   Tätigkeitsstätte, Fahrzeugart und Kennzeichen.

Die Wiederherstellung lädt die Daten nur in den Browser. Sie schreibt nichts
in das GitHub-Repository.

## 6. Als App installieren

### iPhone oder iPad

1. Öffnen Sie die Seite in Safari.
2. Tippen Sie auf **Teilen**.
3. Wählen Sie **Zum Home-Bildschirm**.

### Android

Öffnen Sie das Browsermenü und wählen Sie **App installieren** oder **Zum
Startbildschirm hinzufügen**.

### Windows oder macOS

Öffnen Sie die Seite in Edge oder Chrome und klicken Sie rechts in der
Adressleiste auf das Installationssymbol.

## Updates

Jede Änderung im Branch `main` startet automatisch einen neuen geprüften
Build. Die installierte PWA übernimmt die neue Version beim nächsten
Online-Aufruf. Die gespeicherten Abrechnungsdaten bleiben dabei erhalten.

## Wichtige Grenzen

- Daten werden nicht zwischen Geräten synchronisiert.
- Eine Browserdatenbereinigung kann lokale Daten löschen.
- Erstellen Sie mindestens monatlich eine JSON-Sicherung.
- Wer die URL kennt, kann bei einer öffentlichen Pages-Website die leere App
  öffnen. Ihre eigenen Daten bleiben trotzdem nur in Ihrem Browser.
- Die Kamera funktioniert auf GitHub Pages über HTTPS. Der Browser muss die
  Kameraberechtigung erhalten.

## Reparatur der Veröffentlichung vom Oktober 2026

Im vorhandenen Repository `kaspersebastian83-dot/reisekosten-pro` fehlte der
Ordner `.github/`. Der bisherige automatische Pages-Lauf veröffentlichte die
Quellen: `/src/main.tsx` und die Icons lieferten 404; React und IndexedDB wurden
nicht gestartet. Ein Cache- oder Datenbank-Reset behebt diesen Fehler nicht.

Der Bugfix-Branch `bugfix/startup-and-workflows` enthält den Build-Workflow.
Dieser darf für die ausdrücklich angeforderte Veröffentlichung ebenfalls nach
Pages deployen. `main` wird dabei nicht zusammengeführt oder geändert.

Für ein erneutes Deployment dieses Branches:

1. Unter **Settings → Pages → Source** muss **GitHub Actions** ausgewählt sein.
2. Unter **Settings → Environments → github-pages → Deployment branches** muss
   `bugfix/startup-and-workflows` zugelassen sein (neben `main`).
3. Unter **Actions → GitHub Pages bereitstellen** einen erfolgreichen Lauf
   des Branches `bugfix/startup-and-workflows` öffnen und **Re-run all jobs**
   wählen. Alternativ startet ein neuer Push auf diesen Branch den Workflow.
   **Run workflow** steht erst zuverlässig bereit, wenn die Workflow-Datei im
   Standardbranch vorhanden ist. Eine Übernahme nach `main` benötigt weiterhin
   eine ausdrückliche Freigabe.
4. Beide Jobs **build** und **deploy** müssen erfolgreich abgeschlossen sein.
   Nur `dist` wird als Website-Artefakt hochgeladen.
5. Öffnen Sie `https://kaspersebastian83-dot.github.io/reisekosten-pro/` mit
   abschließendem Schrägstrich. Schließen Sie vorher alle App-Tabs und die
   installierte PWA, damit ein wartender Service Worker aktiviert werden kann.
6. Öffnen Sie online erneut; bei Bedarf verwenden Sie **Erneut laden** oder
   einmal einen harten Reload (Chrome/macOS: Cmd+Shift+R).

Falls eine alte Version hartnäckig bleibt: In den Chrome-Entwicklertools unter
**Application → Service Workers** nur den Worker für `/reisekosten-pro/`
abmelden (**Unregister**) und neu laden. **Nicht „Clear site data“ verwenden**
und weder IndexedDB noch Websitedaten löschen. Die App benötigt keinen
Datenbank-Reset. Der neue Worker verwaltet Caches pro Pages-Unterpfad, lädt
Programmdateien für Offline-Starts vor und lässt fremde App-Caches unangetastet.
Sprachmodelle für OCR benötigen beim ersten Einsatz weiterhin eine Verbindung.
