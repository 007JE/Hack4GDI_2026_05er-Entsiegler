# Hack4GDI2026 – Entsiegelung Mainz

Webpräsentation für das Projekt „Entsiegelung Mainz“. Der aktuelle Prototyp konzentriert sich auf Karte, Adresssuche, Messwerkzeuge und Flächenfilter. Räumliche Analyse und Bewertungslogik werden später ergänzt.

## Lokal starten

Voraussetzung: Python 3.7 oder neuer. Im Projektordner unter Windows starten:

```bash
py server.py
```

Danach <http://127.0.0.1:8000> im Browser öffnen. Auf anderen Systemen kann der Startbefehl `python server.py` lauten. Python stellt die Dateien lokal bereit; es wird nicht direkt in der HTML-Seite ausgeführt.

## Funktionen

- Leaflet-Karte mit OpenStreetMap-Hintergrund und Startansicht Mainz
- Zentrierter Hack4GDI-Header mit Teamnamen und Projektlogo
- Rechts angeordnetes Bedienpanel mit den Reitern „Layer“ und „Filter“
- Gruppierte Layer für Hintergrundkarten und GeoJSON-Exporte
- Adresssuche über die Lupen-Schaltfläche in der Karten-Toolbox, Flächenfilter mit einklappbaren Mehrfachauswahl-Checkboxen unter „Filter“
- Karten-Toolbox mit Zoom, Info-Modus und Messwerkzeugen für Strecken, Polygone und Rechtecke per Ziehen oder zwei diagonalen Eckpunkten
- Objektinformationen werden nur im aktiven Info-Modus per Klick eingeblendet; sonst kann die Karte normal verschoben werden
- Messungen lassen sich ein- und ausblenden sowie gemeinsam löschen
- Kartenebenen einzeln ein- und ausblendbar
- Kartenmenü mit „Layer“ und „Filter“ startet eingeklappt; erneuter Klick auf den offenen Menüpunkt klappt ihn zu
- Layer-Untermenüs starten ebenfalls eingeklappt; die Karte fokussiert automatisch Mainz anhand des Gemeindeumrings
- DOP20-Originalkacheln werden einzeln und unverändert direkt aus `data/geopackage/dop20_mainz.gpkg` über den Python-Server in Leaflet angezeigt
- gestaltete Info-Karte mit Bewertungsstufe (1–5), entsiegelbarer Fläche und Maßnahmenvorschlägen; fehlende Werte werden als nicht hinterlegt markiert
- dauerhaft laufender Lizenzbanner am unteren Bildschirmrand, gespeist aus `scoring/lizenz.json`; die Quellen und bekannten Lizenzbedingungen sind verlinkt
- Adresssuche über den Geocoding-Dienst Nominatim
- Strecke messen sowie Flächen als Polygon oder aufgezogenes Rechteck messen
- GeoJSON-Flächen mit einklappbaren Mehrfachauswahl-Checkboxen nach Dringlichkeitsstufen und Maßnahmen filtern; Stufe 1 ist grün, Stufe 5 rot. Die Farblegende liegt unter „Layer“.
- Responsive Bedienoberfläche mit Projektlogo

Leaflet, OpenStreetMap-Kartenkacheln und Adresssuche werden online geladen. Für das Luftbild muss die Website über `python server.py` gestartet werden: Der lokale Python-Server liest die DOP20-Rasterkacheln direkt und unverändert aus `data/geopackage/dop20_mainz.gpkg` und stellt sie über eine GeoPackage-API bereit. So werden nicht die separat exportierten Mini-Kacheln geladen. Die Kartenansicht wählt anhand der Kartenauflösung die passende im GeoPackage vorhandene Zoomstufe und lädt nur Kacheln im sichtbaren Ausschnitt. Das aktuell eingecheckte GeoPackage enthält 41 Kacheln auf Stufe 3 mit etwa 7,3 × 7,8 m pro Pixel; eine höhere Bildauflösung kann das GeoPackage daher nicht liefern.

Die Webkarte lädt die berechneten Flächen aus `data/geojson/ergebnis.geojson`. Prioritäten (`prioritaet`, Stufe 1–5) und Maßnahmen (`massnahme`) können jeweils mehrfach ausgewählt werden; innerhalb einer Filtergruppe gilt ODER, zwischen Stufen und Maßnahmen UND. Standardmäßig ist nichts ausgewählt, wodurch alle Flächen sichtbar sind. „Alle Filter entfernen“ stellt diesen Ausgangszustand wieder her. Die Farbgebung verdeutlicht das Entsiegelungspotenzial von Grün (Stufe 1, gering) bis Rot (Stufe 5, sehr hoch). Die Objektinfo zeigt zusätzlich Fläche, Score und Begründung aus `flaeche_m2`, `score_final` und `massnahme_berg`; wenn im Maßnahmenkatalog eine Beispielquelle hinterlegt ist, wird sie als gekürzter Link angeboten. Die auswählbaren Maßnahmen werden ohne Browser-Cache aus `scoring/massnahmenkatalog.json` geladen, damit Aktualisierungen der lokalen Datei direkt übernommen werden.

## Projektdateien

- `index.html`, `app.js`, `style/style.css`: Weboberfläche und Kartenfunktionen
- `data/bilder/`: Projektlogo und weitere Webbilder
- `data/geojson/`: GeoJSON-Exporte und statischer Mainzer Umring
- `data/geopackage/dop20_mainz.gpkg`: lokales DOP20-Luftbild für die Kartenansicht
- `data/geopackage/dop20_tiles.json` und `data/geopackage/dop20_tiles/`: vorhandener statischer DOP20-Export; die Website verwendet stattdessen die Originaldaten aus dem GeoPackage über den lokalen Server
- `data/geopackage/mainz_umring.gpkg`: Gemeindeumring Mainz als QGIS-Datengrundlage; für den Betrieb auch unter statischen Servern liegt der Umring zusätzlich als `data/geojson/mainz_umring.geojson` vor
- `data/luftbilder/`: vorgesehene Ablage für Luftbilder
- `scoring/`: vorbereitete Dokumentation der späteren Bewertungsmethodik
- `scoring/lizenz.json`: zentrale Quelle für die im laufenden Banner angezeigten Layer-, Quellen- und Lizenzangaben
- `scoring/Maßnahmen.docx`: bereitgestellte Maßnahmenbeschreibung und erste Zuordnungsideen
- `scoring/massnahmenkatalog.json` und `scoring/massnahmenkatalog.md`: strukturierter Maßnahmenkatalog mit vorläufigen Flächenprofilen für die spätere GIS-Integration
