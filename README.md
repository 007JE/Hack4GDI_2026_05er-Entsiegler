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
- Rechts angeordnetes Bedienpanel mit den Reitern „Datengrundlage“ und „Filter“
- Gruppierte Layer für Hintergrundkarten, GeoPackage-Daten und GeoJSON-Exporte
- Layer-Überlagerung mit Drag-and-drop-Reihenfolge (mit Pfeiltasten-Alternative); die Sichtbarkeit wird mit den vorhandenen Layer-Schaltern gesteuert
- Adresssuche über die Lupen-Schaltfläche in der Karten-Toolbox, Flächenfilter unter „Filter“
- Karten-Toolbox mit Zoom, Informationsmodus und Messwerkzeugen für Strecken, Polygone und Rechtecke
- Objekt-Metadaten werden nur im aktiven Info-Modus per Klick eingeblendet; sonst kann die Karte normal verschoben werden
- Messungen lassen sich ein- und ausblenden sowie gemeinsam löschen
- Kartenebenen einzeln ein- und ausblendbar
- Kartenmenü mit „Datengrundlage“ und „Filter“ startet eingeklappt; erneuter Klick auf den offenen Menüpunkt klappt ihn zu
- Layer-Untermenüs starten ebenfalls eingeklappt; die Karte fokussiert automatisch Mainz anhand des Gemeindeumrings
- Lokales DOP20-Luftbild aus `data/geopackage/dop20_mainz.gpkg`; der Python-Server stellt die GeoPackage-Kacheln für Leaflet bereit
- lokale GeoPackage-Layer aus `data/geopackage/mainz_base.gpkg` (ALKIS-Flurstücke, Hitzeinseln, Parkplätze/versiegelte Flächen und Grünflächen)
- Hitzeinseln sind nach den GeoPackage-Temperaturklassen „Mittel“, „Hoch“ und „Extrem“ abgestuft eingefärbt
- Adresssuche über den Geocoding-Dienst Nominatim
- Strecke messen sowie Flächen als Polygon oder aufgezogenes Rechteck messen
- GeoJSON-Flächen nach Score und Prioritätsklasse filtern
- Responsive Bedienoberfläche mit Projektlogo

Leaflet, Kartenkacheln und Adresssuche werden online geladen. Der lokale Python-Server liest die GeoPackage-Layer mit der Python-Standardbibliothek (SQLite) aus, wandelt EPSG:25832 in WGS84/GeoJSON um und filtert sie anhand des Kartenausschnitts. Die DOP20-Rasterkacheln werden über die lokale GeoPackage-API direkt aus `data/geopackage/dop20_mainz.gpkg` geladen und im Browser zu einem einzigen Kartenbild zusammengesetzt, damit keine sichtbaren Trennlinien zwischen den Quellkacheln entstehen. Als Fallback liegen die exportierten Bildkacheln und ihr Index unter `data/geopackage/dop20_tiles/` und `data/geopackage/dop20_tiles.json`; damit funktioniert das Luftbild auch auf statischen Servern ohne API (z. B. VS Code Live Server auf Port 5500). Vektorlayer laden dort ihre vorbereiteten GeoJSON-Dateien aus `data/geojson/geopackage/`. Flurstücke werden beim Start eingeblendet; die übrigen GeoPackage-Layer können unabhängig zugeschaltet werden.

Für die spätere Flächenintegration dient `data/geojson/entsiegelungskandidaten.geojson`. Der Filter erwartet in den GeoJSON-`properties` die Felder `score` (numerisch) und `priority` (Prioritätsklasse); beide Felder sind optional. Ohne Flächendaten bleibt die Karte bedienbar und zeigt einen entsprechenden Hinweis.

## Projektdateien

- `index.html`, `app.js`, `style/style.css`: Weboberfläche und Kartenfunktionen
- `data/bilder/`: Projektlogo und weitere Webbilder
- `data/geojson/`: GeoJSON-Exporte, statischer Mainzer Umring und GeoPackage-Layer für Server ohne API
- `data/geopackage/mainz_base.gpkg`: lokale QGIS-Datenbank mit ALKIS-Flurstücken und weiteren Analyse-Layern
- `data/geopackage/dop20_mainz.gpkg`: lokales DOP20-Luftbild für die Kartenansicht
- `data/geopackage/dop20_tiles.json` und `data/geopackage/dop20_tiles/`: statischer Fallback-Export der DOP20-Kacheln für Server ohne GeoPackage-API
- `data/geopackage/mainz_umring.gpkg`: Gemeindeumring Mainz als QGIS-Datengrundlage; für den Betrieb auch unter statischen Servern liegt der Umring zusätzlich als `data/geojson/mainz_umring.geojson` vor
- `data/luftbilder/`: vorgesehene Ablage für Luftbilder
- `scoring/`: vorbereitete Dokumentation der späteren Bewertungsmethodik
