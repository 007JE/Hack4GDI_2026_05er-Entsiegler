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
- Layer-Überlagerung mit Drag-and-drop-Reihenfolge (mit Pfeiltasten-Alternative); die Sichtbarkeit wird mit den vorhandenen Layer-Schaltern gesteuert
- Adresssuche über die Lupen-Schaltfläche in der Karten-Toolbox, Flächenfilter unter „Filter“
- Karten-Toolbox mit Zoom, Info-Modus und Messwerkzeugen für Strecken, Polygone und Rechtecke per Ziehen oder zwei diagonalen Eckpunkten
- Objektinformationen werden nur im aktiven Info-Modus per Klick eingeblendet; sonst kann die Karte normal verschoben werden
- Messungen lassen sich ein- und ausblenden sowie gemeinsam löschen
- Kartenebenen einzeln ein- und ausblendbar
- Kartenmenü mit „Layer“ und „Filter“ startet eingeklappt; erneuter Klick auf den offenen Menüpunkt klappt ihn zu
- Layer-Untermenüs starten ebenfalls eingeklappt; die Karte fokussiert automatisch Mainz anhand des Gemeindeumrings
- DOP20-Originalkacheln werden einzeln und ohne PNG-Mosaik direkt aus `data/geopackage/dop20_mainz.gpkg` über den Python-Server in Leaflet angezeigt
- gestaltete Info-Karte mit Bewertungsstufe (1–5), entsiegelbarer Fläche und Maßnahmenvorschlägen; fehlende Werte werden als nicht hinterlegt markiert
- dauerhaft laufender Lizenzbanner am unteren Bildschirmrand, gespeist aus `scoring/lizenz.json`; die Quellen und bekannten Lizenzbedingungen sind verlinkt
- Adresssuche über den Geocoding-Dienst Nominatim
- Strecke messen sowie Flächen als Polygon oder aufgezogenes Rechteck messen
- GeoJSON-Flächen nach fünf Prioritätsstufen und Maßnahmen aus dem Maßnahmenkatalog filtern
- Responsive Bedienoberfläche mit Projektlogo

Leaflet, Kartenkacheln und Adresssuche werden online geladen. Der lokale Python-Server liest die DOP20-Rasterkacheln aus `data/geopackage/dop20_mainz.gpkg` und stellt sie unverändert einzeln über eine GeoPackage-API bereit. Die Kartenansicht wählt anhand der Kartenauflösung die passende im GeoPackage vorhandene Zoomstufe und lädt nur Kacheln im sichtbaren Ausschnitt. Als Fallback liegen die exportierten Einzelkacheln und ihr Index unter `data/geopackage/dop20_tiles/` und `data/geopackage/dop20_tiles.json`; sie werden ebenfalls einzeln angezeigt. Das aktuell eingecheckte GeoPackage enthält allerdings nur 41 Kacheln auf Stufe 3 mit etwa 7,3 × 7,8 m pro Pixel; höher aufgelöste Quelldaten sind darin nicht enthalten.

Die Webkarte lädt die berechneten Flächen aus `data/geojson/ergebnis.geojson`. Der Filter liest die Priorität aus `prioritaet` (Stufe 1–5) und die Maßnahme aus `massnahme`; die Objektinfo zeigt zusätzlich Fläche, Score und Begründung aus `flaeche_m2`, `score_final` und `massnahme_berg`. Die Stufen reichen von „Entsiegelungspotenzial sehr gering“ (1) bis „Entsiegelungspotenzial sehr hoch“ (5). Die auswählbaren Maßnahmen werden ohne Browser-Cache aus `scoring/massnahmenkatalog.json` geladen, damit Aktualisierungen der lokalen Datei direkt übernommen werden.

## Projektdateien

- `index.html`, `app.js`, `style/style.css`: Weboberfläche und Kartenfunktionen
- `data/bilder/`: Projektlogo und weitere Webbilder
- `data/geojson/`: GeoJSON-Exporte und statischer Mainzer Umring
- `data/geopackage/dop20_mainz.gpkg`: lokales DOP20-Luftbild für die Kartenansicht
- `data/geopackage/dop20_tiles.json` und `data/geopackage/dop20_tiles/`: statischer Fallback-Export der DOP20-Kacheln für Server ohne GeoPackage-API
- `data/geopackage/mainz_umring.gpkg`: Gemeindeumring Mainz als QGIS-Datengrundlage; für den Betrieb auch unter statischen Servern liegt der Umring zusätzlich als `data/geojson/mainz_umring.geojson` vor
- `data/luftbilder/`: vorgesehene Ablage für Luftbilder
- `scoring/`: vorbereitete Dokumentation der späteren Bewertungsmethodik
- `scoring/lizenz.json`: zentrale Quelle für die im laufenden Banner angezeigten Layer-, Quellen- und Lizenzangaben
- `scoring/Maßnahmen.docx`: bereitgestellte Maßnahmenbeschreibung und erste Zuordnungsideen
- `scoring/massnahmenkatalog.json` und `scoring/massnahmenkatalog.md`: strukturierter Maßnahmenkatalog mit vorläufigen Flächenprofilen für die spätere GIS-Integration
