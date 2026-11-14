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
- Objektinformationen werden nur im aktiven Info-Modus per Klick eingeblendet; eine fingerfreundliche Treffertoleranz erleichtert die Auswahl am Handy und das Popup bleibt kompakt. Außerhalb des Info-Modus lässt sich die Karte normal verschieben.
- Abgeschlossene Strecken und Flächen behalten ihre Beschriftung auf der Karte; kleine Formen erhalten das Label daneben. Messungen lassen sich gemeinsam löschen.
- Kartenebenen einzeln ein- und ausblendbar
- Kartenmenü mit „Layer“ und „Filter“ startet eingeklappt; erneuter Klick auf den offenen Menüpunkt klappt ihn zu
- Layer-Untermenüs starten ebenfalls eingeklappt; die Karte fokussiert automatisch Mainz anhand des Gemeindeumrings
- Nahtloses DOP20-Luftbild, reprojiziert aus den Originalkacheln von `data/geopackage/dop20_mainz.gpkg`
- gestaltete Info-Karte mit Bewertungsstufe (1–5), entsiegelbarer Fläche und Maßnahmenvorschlägen; fehlende Werte werden als nicht hinterlegt markiert
- dauerhaft laufender Lizenzbanner am unteren Bildschirmrand, gespeist aus `scoring/lizenz.json`; die Quellen und bekannten Lizenzbedingungen sind verlinkt
- Adresssuche über den Geocoding-Dienst Nominatim
- Strecke messen sowie Flächen als Polygon oder aufgezogenes Rechteck messen
- GeoJSON-Flächen mit einklappbaren Mehrfachauswahl-Checkboxen nach Dringlichkeitsstufen und Maßnahmen filtern; Stufe 1 ist grün, Stufe 5 rot. Die Farblegende liegt unter „Layer“.
- Responsive Bedienoberfläche mit Projektlogo

Leaflet, OpenStreetMap-Kartenkacheln und Adresssuche werden online geladen. Für das DOP20-Luftbild verwenden lokale Starts und statische Hosts wie GitHub Pages dasselbe, aus den 41 Originalkacheln des GeoPackages reprojizierte Web-Mercator-Mosaik. Dadurch werden keine schief ausgerichteten Mini-Overlays mehr zusammengesetzt; das komprimierte WebP-Bild ist rund 0,6 MB groß. Die Originaldaten haben etwa 7,3 × 7,8 m pro Pixel und liefern keine höhere Bildauflösung. Die vielen Flächen werden mit Leaflets Canvas-Renderer gezeichnet, um die SVG-/DOM-Last auf Mobilgeräten zu verringern.

Die Webkarte lädt die berechneten Flächen aus `data/geojson/ergebnis.geojson`. Prioritäten (`prioritaet`, Stufe 1–5) und Maßnahmen (`massnahme`) können jeweils mehrfach ausgewählt werden; innerhalb einer Filtergruppe gilt ODER, zwischen Stufen und Maßnahmen UND. Standardmäßig ist nichts ausgewählt, wodurch alle Flächen sichtbar sind. „Alle Filter entfernen“ stellt diesen Ausgangszustand wieder her. Die Farbgebung verdeutlicht das Entsiegelungspotenzial von Grün (Stufe 1, gering) bis Rot (Stufe 5, sehr hoch). Die Objektinfo zeigt zusätzlich Fläche, Score und Begründung aus `flaeche_m2`, `score_final` und `massnahme_berg`; wenn im Maßnahmenkatalog eine Beispielquelle hinterlegt ist, wird sie als gekürzter Link angeboten. Die auswählbaren Maßnahmen werden ohne Browser-Cache aus `scoring/massnahmenkatalog.json` geladen, damit Aktualisierungen der lokalen Datei direkt übernommen werden.

## Projektdateien

- `index.html`, `app.js`, `style/style.css`: Weboberfläche und Kartenfunktionen
- `data/bilder/`: Projektlogo und weitere Webbilder
- `data/geojson/`: GeoJSON-Exporte und statischer Mainzer Umring
- `data/geopackage/dop20_mainz.gpkg`: lokales DOP20-Luftbild für die Kartenansicht
- `data/geopackage/dop20_tiles.json` und `data/geopackage/dop20_mainz_webmercator.webp`: nahtloses Web-Mosaik aus den Originaldaten im GeoPackage
- `data/geopackage/mainz_umring.gpkg`: Gemeindeumring Mainz als QGIS-Datengrundlage; für den Betrieb auch unter statischen Servern liegt der Umring zusätzlich als `data/geojson/mainz_umring.geojson` vor
- `data/luftbilder/`: vorgesehene Ablage für Luftbilder
- `scoring/`: vorbereitete Dokumentation der späteren Bewertungsmethodik
- `scoring/lizenz.json`: zentrale Quelle für die im laufenden Banner angezeigten Layer-, Quellen- und Lizenzangaben
- `scoring/Maßnahmen.docx`: bereitgestellte Maßnahmenbeschreibung und erste Zuordnungsideen
- `scoring/massnahmenkatalog.json` und `scoring/massnahmenkatalog.md`: strukturierter Maßnahmenkatalog mit vorläufigen Flächenprofilen für die spätere GIS-Integration
