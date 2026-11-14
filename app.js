const map = L.map("map", { zoomControl: false }).setView([49.9929, 8.2473], 12);
const layerOrderList = document.getElementById("data-layer-order");
const initialLayerOrderItems = [...layerOrderList.querySelectorAll(".layer-order-item")];
const dataLayerPaneNames = new Map(initialLayerOrderItems.map(({ dataset }) => [
  dataset.layerId,
  `data-layer-${dataset.layerId.replace(/:/g, "-")}`,
]));
const dataLayerPanes = new Map([...dataLayerPaneNames].map(([id, name]) => [id, map.createPane(name)]));
const featureCount = document.getElementById("feature-count");
const dataStatus = document.getElementById("data-status");
const searchStatus = document.getElementById("search-status");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("address-search");
const priorityFilter = document.getElementById("priority-filter");
const measureFilter = document.getElementById("measure-filter");
const measureFilterStatus = document.getElementById("measure-filter-status");
const priorityDescriptions = ["sehr gering", "gering", "mittel", "hoch", "sehr hoch"];
const drawingHelp = document.getElementById("drawing-help");
const measurementResult = document.getElementById("measurement-result");
const finishButton = document.getElementById("finish-drawing");
const clearButton = document.getElementById("clear-drawings");
const searchToggle = document.getElementById("search-toggle");
const searchMenu = document.getElementById("search-menu");
const measureToggle = document.getElementById("measure-toggle");
const measureMenu = document.getElementById("measure-menu");
const informationToggle = document.getElementById("information-toggle");
const informationStatus = document.getElementById("information-status");
const mapToolbox = document.querySelector(".map-toolbox");
const toolButtons = [...document.querySelectorAll("[data-tool]")];
const panelTabs = [...document.querySelectorAll(".panel-tab")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];
const aerialStatus = document.getElementById("aerial-status");
const areaBoundaryPane = map.createPane("area-boundary-pane");
areaBoundaryPane.style.zIndex = "410";
const basemapLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  pane: dataLayerPaneNames.get("basemap"),
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
});
const aerialLayer = L.featureGroup();

const candidateLayer = L.featureGroup().addTo(map);
const drawingLayer = L.featureGroup().addTo(map);
const sketchLayer = L.featureGroup().addTo(map);
const areaBoundaryLayer = L.geoJSON(null, {
  pane: "area-boundary-pane",
  interactive: false,
  style: { color: "#174f3e", fill: false, weight: 2.5, opacity: 0.9 },
}).addTo(map);
const mapLayers = new Map([
  ["basemap", basemapLayer],
  ["aerial", aerialLayer],
  ["candidates", candidateLayer],
  ["measurements", [drawingLayer, sketchLayer]],
]);
let allFeatures = [];
const measuresById = new Map();
let drawMode = null;
let informationMode = false;
let sketch = null;
let rectangleStart = null;
let rectangleDraft = null;
let lastGeocodeRequestAt = 0;
let isSearching = false;
let aerialLoadPromise = null;

basemapLayer.addTo(map);
aerialLayer.addTo(map);
loadDop20Layer();

L.DomEvent.disableClickPropagation(mapToolbox);
L.DomEvent.disableScrollPropagation(mapToolbox);
document.getElementById("zoom-in").addEventListener("click", () => map.zoomIn());
document.getElementById("zoom-out").addEventListener("click", () => map.zoomOut());
L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);
loadLicenseBanner();

function licenseLayerLabel(value, key) {
  const knownLabels = {
    cold_hot_spots_mainz: "Kalt- und Hitzeinseln Mainz",
    kaltluftstromkarte_mainz: "Kaltluftstromkarte Mainz",
    klimatopkarte_mainz: "Klimatopkarte Mainz",
  };
  if (knownLabels[key]) return knownLabels[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  return key.replaceAll("_", " ");
}

function licenseHref(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function createLicenseSegment(entries, hidden = false) {
  const segment = document.createElement("div");
  segment.className = "license-segment";
  if (hidden) {
    segment.setAttribute("aria-hidden", "true");
    segment.inert = true;
  }

  entries.forEach(({ key, item }) => {
    const entry = document.createElement("span");
    entry.className = "license-entry";

    const layer = document.createElement("strong");
    layer.className = "license-layer";
    layer.textContent = licenseLayerLabel(item.layer, key);
    entry.append(layer);

    const licenseText = document.createElement("span");
    licenseText.textContent = `Lizenz: ${item.license}`;
    entry.append(licenseText);

    const licenseUrl = item.license === "CC-BY-4.0"
      ? "https://creativecommons.org/licenses/by/4.0/"
      : null;
    if (licenseUrl) {
      const licenseLink = document.createElement("a");
      licenseLink.href = licenseUrl;
      licenseLink.target = "_blank";
      licenseLink.rel = "noopener noreferrer";
      licenseLink.textContent = "Lizenzbedingungen";
      entry.append(licenseLink);
    }

    const sourceUrl = licenseHref(item.source);
    if (sourceUrl) {
      const sourceLink = document.createElement("a");
      sourceLink.href = sourceUrl;
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener noreferrer";
      sourceLink.textContent = "Quelle";
      entry.append(sourceLink);
    }
    segment.append(entry);
  });
  return segment;
}

async function loadLicenseBanner() {
  const status = document.getElementById("license-status");
  const track = document.getElementById("license-track");
  try {
    const response = await fetch("scoring/lizenz.json");
    if (!response.ok) throw new Error(`Lizenzdatei antwortet mit HTTP ${response.status}.`);
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Die Lizenzdatei enthält kein gültiges Objekt.");
    }

    const entries = Object.entries(data).filter(([, item]) => (
      item
      && typeof item === "object"
      && typeof item.license === "string"
      && item.license.trim()
    )).map(([key, item]) => ({ key, item }));
    if (!entries.length) throw new Error("Die Lizenzdatei enthält keine gültigen Lizenzangaben.");

    track.append(createLicenseSegment(entries));
    track.append(createLicenseSegment(entries, true));
    track.hidden = false;
    status.hidden = true;
  } catch (error) {
    console.error("Lizenzbanner konnte nicht geladen werden:", error);
    status.textContent = `Lizenzhinweise nicht verfügbar: ${error.message}`;
  }
}

function loadDop20Layer() {
  if (aerialLoadPromise) return aerialLoadPromise;

  aerialStatus.textContent = "DOP20 Mainz wird aus dem GeoPackage geladen …";
  aerialLoadPromise = fetch("api/geopackage/dop20/tiles")
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `DOP20-GeoPackage antwortet mit HTTP ${response.status}.`);
      return payload;
    })
    .catch((apiError) => {
      console.warn("DOP20-API ist nicht verfügbar; verwende die vorbereiteten GeoPackage-Kacheln:", apiError);
      return fetch("data/geopackage/dop20_tiles.json")
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`statischer DOP20-Kachelindex antwortet mit HTTP ${response.status}.`);
          }
          return response.json();
        })
        .catch((fallbackError) => {
          throw new Error(
            `DOP20 konnte weder über die GeoPackage-API (${apiError.message}) noch aus dem statischen Kachelindex (${fallbackError.message}) geladen werden.`,
          );
        });
    })
    .then(({ tiles, tileWidth = 256, tileHeight = 256, sourceOrigin, pixelSize, webMercatorBounds }) => {
      if (!Array.isArray(tiles) || tiles.length === 0 || !sourceOrigin || !pixelSize || !webMercatorBounds) {
        throw new Error("Das DOP20-GeoPackage enthält keine Bildkacheln.");
      }

      const minColumn = Math.min(...tiles.map((tile) => tile.column));
      const maxColumn = Math.max(...tiles.map((tile) => tile.column));
      const minRow = Math.min(...tiles.map((tile) => tile.row));
      const maxRow = Math.max(...tiles.map((tile) => tile.row));
      const canvas = document.createElement("canvas");
      canvas.width = (maxColumn - minColumn + 1) * tileWidth;
      canvas.height = (maxRow - minRow + 1) * tileHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Der Browser kann das DOP20-Luftbild nicht zusammensetzen.");

      const loadTile = (tile) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          context.drawImage(
            image,
            (tile.column - minColumn) * tileWidth,
            (tile.row - minRow) * tileHeight,
            tileWidth,
            tileHeight,
          );
          resolve();
        };
        image.onerror = () => {
          reject(new Error(`DOP20-Kachel ${tile.zoom}/${tile.column}/${tile.row} konnte nicht geladen werden.`));
        };
        image.src = tile.url;
      });

      aerialStatus.textContent = `${tiles.length} DOP20-Quellkacheln werden zusammengesetzt …`;
      return Promise.all(tiles.map(loadTile)).then(() => {
        const [minX, minY] = webMercatorBounds[0];
        const [maxX, maxY] = webMercatorBounds[1];
        const outputCanvas = document.createElement("canvas");
        outputCanvas.width = canvas.width;
        outputCanvas.height = Math.round(canvas.width * (maxY - minY) / (maxX - minX));
        const output = outputCanvas.getContext("2d");
        if (!output) throw new Error("Der Browser kann das DOP20-Luftbild nicht georeferenzieren.");

        const projectSourcePoint = (sourceX, sourceY) => {
          const easting = sourceOrigin[0] + sourceX * pixelSize[0];
          const northing = sourceOrigin[1] - sourceY * pixelSize[1];
          const [longitude, latitude] = utmToWgs84(easting, northing);
          const radians = Math.PI / 180;
          const radius = 6378137;
          return [
            ((radius * longitude * radians - minX) / (maxX - minX)) * outputCanvas.width,
            ((maxY - radius * Math.log(Math.tan(Math.PI / 4 + latitude * radians / 2))) / (maxY - minY))
              * outputCanvas.height,
          ];
        };

        const sourceTriangle = (sourcePoints, targetPoints) => {
          const [p0, p1, p2] = sourcePoints;
          const [q0, q1, q2] = targetPoints;
          const determinant = p0[0] * (p1[1] - p2[1])
            + p1[0] * (p2[1] - p0[1])
            + p2[0] * (p0[1] - p1[1]);
          if (!determinant) return;
          const transform = (a0, a1, a2) => [
            (a0 * (p1[1] - p2[1]) + a1 * (p2[1] - p0[1]) + a2 * (p0[1] - p1[1])) / determinant,
            (a0 * (p2[0] - p1[0]) + a1 * (p0[0] - p2[0]) + a2 * (p1[0] - p0[0])) / determinant,
            (a0 * (p1[0] * p2[1] - p2[0] * p1[1])
              + a1 * (p2[0] * p0[1] - p0[0] * p2[1])
              + a2 * (p0[0] * p1[1] - p1[0] * p0[1])) / determinant,
          ];
          const [a, c, e] = transform(q0[0], q1[0], q2[0]);
          const [b, d, f] = transform(q0[1], q1[1], q2[1]);

          output.save();
          output.beginPath();
          output.moveTo(q0[0], q0[1]);
          output.lineTo(q1[0], q1[1]);
          output.lineTo(q2[0], q2[1]);
          output.closePath();
          output.clip();
          output.setTransform(a, b, c, d, e, f);
          output.drawImage(canvas, 0, 0);
          output.restore();
        };

        const meshSegments = 8;
        const sourceWidth = canvas.width / (maxColumn - minColumn + 1);
        const sourceHeight = canvas.height / (maxRow - minRow + 1);
        const cellWidth = sourceWidth / meshSegments;
        const cellHeight = sourceHeight / meshSegments;
        tiles.forEach((tile) => {
          const tileX = (tile.column - minColumn) * sourceWidth;
          const tileY = (tile.row - minRow) * sourceHeight;
          for (let row = 0; row < meshSegments; row += 1) {
            for (let column = 0; column < meshSegments; column += 1) {
              const x = tileX + column * cellWidth;
              const y = tileY + row * cellHeight;
              const source = [
                [x, y],
                [x + cellWidth, y],
                [x + cellWidth, y + cellHeight],
                [x, y + cellHeight],
              ];
              const target = source.map(([sourceX, sourceY]) => projectSourcePoint(sourceX, sourceY));
              sourceTriangle([source[0], source[1], source[2]], [target[0], target[1], target[2]]);
              sourceTriangle([source[0], source[2], source[3]], [target[0], target[2], target[3]]);
            }
          }
        });

        const radius = 6378137;
        const mercatorToLatitude = (northing) => (
          2 * Math.atan(Math.exp(northing / radius)) - Math.PI / 2
        ) * 180 / Math.PI;
        const overlayBounds = [
          [mercatorToLatitude(minY), minX / radius * 180 / Math.PI],
          [mercatorToLatitude(maxY), maxX / radius * 180 / Math.PI],
        ];
        const overlay = L.imageOverlay(outputCanvas.toDataURL("image/png"), overlayBounds, {
          pane: dataLayerPaneNames.get("aerial"),
          interactive: false,
          alt: "DOP20-Luftbild Mainz",
        });
        overlay.once("load", () => {
          aerialStatus.textContent = `DOP20 Mainz geladen (${tiles.length} Quellkacheln, reprojiziert).`;
        });
        aerialLayer.addLayer(overlay);
        return overlay;
      });
    })
    .catch((error) => {
      aerialLoadPromise = null;
      console.error("DOP20-GeoPackage konnte nicht geladen werden:", error);
      aerialStatus.textContent = error.message || "DOP20-GeoPackage konnte nicht geladen werden.";
    });

  return aerialLoadPromise;
}

function utmToWgs84(easting, northing) {
  const flattening = 1 / 298.257223563;
  const eccentricitySquared = flattening * (2 - flattening);
  const secondEccentricitySquared = eccentricitySquared / (1 - eccentricitySquared);
  const scale = 0.9996;
  const semiMajorAxis = 6378137;
  const eccentricityPrime = (1 - Math.sqrt(1 - eccentricitySquared))
    / (1 + Math.sqrt(1 - eccentricitySquared));
  const meridian = northing / scale;
  const mu = meridian / (
    semiMajorAxis * (1 - eccentricitySquared / 4 - 3 * eccentricitySquared ** 2 / 64
      - 5 * eccentricitySquared ** 3 / 256)
  );
  const footpoint = mu
    + (3 * eccentricityPrime / 2 - 27 * eccentricityPrime ** 3 / 32) * Math.sin(2 * mu)
    + (21 * eccentricityPrime ** 2 / 16 - 55 * eccentricityPrime ** 4 / 32) * Math.sin(4 * mu)
    + (151 * eccentricityPrime ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * eccentricityPrime ** 4 / 512) * Math.sin(8 * mu);
  const sinFootpoint = Math.sin(footpoint);
  const cosFootpoint = Math.cos(footpoint);
  const tangent = Math.tan(footpoint);
  const c1 = secondEccentricitySquared * cosFootpoint ** 2;
  const t1 = tangent ** 2;
  const n1 = semiMajorAxis / Math.sqrt(1 - eccentricitySquared * sinFootpoint ** 2);
  const r1 = semiMajorAxis * (1 - eccentricitySquared)
    / (1 - eccentricitySquared * sinFootpoint ** 2) ** 1.5;
  const d = (easting - 500000) / (n1 * scale);
  const d2 = d ** 2;
  const latitude = footpoint - (n1 * tangent / r1) * (
    d2 / 2
    - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * secondEccentricitySquared) * d2 ** 2 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * secondEccentricitySquared - 3 * c1 ** 2)
      * d2 ** 3 / 720
  );
  const longitude = Math.PI / 20 + (
    d
    - (1 + 2 * t1 + c1) * d ** 3 / 6
    + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * secondEccentricitySquared + 24 * t1 ** 2)
      * d ** 5 / 120
  ) / cosFootpoint;
  return [longitude * 180 / Math.PI, latitude * 180 / Math.PI];
}

let mainzBoundaryPromise;

function getAreaPadding() {
  return window.matchMedia("(max-width: 600px)").matches
    ? { paddingTopLeft: [16, 16], paddingBottomRight: [16, 16], maxZoom: 16 }
    : { paddingTopLeft: [32, 32], paddingBottomRight: [390, 32], maxZoom: 16 };
}

function loadMainzBoundary() {
  if (!mainzBoundaryPromise) {
    mainzBoundaryPromise = fetch("data/geojson/mainz_umring.geojson")
      .then((response) => {
        if (!response.ok) throw new Error(`Mainzer Umring konnte nicht geladen werden (${response.status}).`);
        return response.json();
      })
      .then((geojson) => {
        if (geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features) || geojson.features.length === 0) {
          throw new Error("Die Datei für den Mainzer Umring enthält keine gültige GeoJSON-FeatureCollection.");
        }
        return geojson;
      })
      .catch((error) => {
        mainzBoundaryPromise = null;
        throw error;
      });
  }
  return mainzBoundaryPromise;
}

async function focusMainz() {
  areaBoundaryLayer.clearLayers();

  try {
    const boundary = await loadMainzBoundary();
    areaBoundaryLayer.addData(boundary);
    const bounds = areaBoundaryLayer.getBounds();
    if (!bounds.isValid()) throw new Error("Der Mainzer Umring enthält keine gültige Kartenausdehnung.");
    map.fitBounds(bounds, getAreaPadding());
  } catch (error) {
    console.error("Mainzer Kartenausschnitt konnte nicht geladen werden:", error);
  }
}

focusMainz();

function formatDistance(meters) {
  return meters >= 1000
    ? `${(meters / 1000).toLocaleString("de-DE", { maximumFractionDigits: 2 })} km`
    : `${meters.toLocaleString("de-DE", { maximumFractionDigits: 1 })} m`;
}

function formatArea(squareMeters) {
  return squareMeters >= 10000
    ? `${(squareMeters / 10000).toLocaleString("de-DE", { maximumFractionDigits: 2 })} ha`
    : `${squareMeters.toLocaleString("de-DE", { maximumFractionDigits: 1 })} m²`;
}

function polygonArea(latLngs) {
  const earthRadius = 6378137;
  let area = 0;

  for (let index = 0; index < latLngs.length; index += 1) {
    const current = latLngs[index];
    const next = latLngs[(index + 1) % latLngs.length];
    const currentLatitude = (current.lat * Math.PI) / 180;
    const nextLatitude = (next.lat * Math.PI) / 180;
    const longitudeDifference = ((next.lng - current.lng) * Math.PI) / 180;
    area += longitudeDifference * (2 + Math.sin(currentLatitude) + Math.sin(nextLatitude));
  }

  return Math.abs((area * earthRadius * earthRadius) / 2);
}

function describeMeasurement() {
  if (!sketch) {
    measurementResult.textContent = "";
    return;
  }

  if (drawMode === "distance" && sketch.points.length >= 2) {
    const meters = sketch.points.slice(1).reduce(
      (total, point, index) => total + map.distance(sketch.points[index], point),
      0,
    );
    measurementResult.textContent = `Strecke: ${formatDistance(meters)}`;
  } else if (drawMode === "polygon" && sketch.points.length >= 3) {
    measurementResult.textContent = `Fläche: ${formatArea(polygonArea(sketch.points))}`;
  } else if (drawMode === "rectangle" && rectangleDraft) {
    const corners = rectangleDraft.getBounds();
    const bounds = [corners.getSouthWest(), corners.getSouthEast(), corners.getNorthEast(), corners.getNorthWest()];
    measurementResult.textContent = `Fläche: ${formatArea(polygonArea(bounds))}`;
  } else {
    measurementResult.textContent = "";
  }
}

function updateSketch() {
  sketchLayer.clearLayers();
  if (!sketch || sketch.points.length === 0) {
    describeMeasurement();
    return;
  }

  if (drawMode === "distance" && sketch.points.length > 1) {
    L.polyline(sketch.points, { color: "#e47736", weight: 4 }).addTo(sketchLayer);
  } else if (drawMode === "polygon" && sketch.points.length > 1) {
    const lineStyle = { color: "#e47736", weight: 3, dashArray: "6 5" };
    if (sketch.points.length >= 3) {
      L.polygon(sketch.points, {
        color: "#e47736",
        fillColor: "#f5a66f",
        fillOpacity: 0.22,
        weight: 3,
        dashArray: "6 5",
      }).addTo(sketchLayer);
    } else {
      L.polyline(sketch.points, lineStyle).addTo(sketchLayer);
    }
  }

  sketch.points.forEach((point) => {
    L.circleMarker(point, {
      radius: 4,
      color: "#fff",
      weight: 2,
      fillColor: "#e47736",
      fillOpacity: 1,
    }).addTo(sketchLayer);
  });
  describeMeasurement();
}

function updateToolButtons() {
  toolButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.tool === drawMode));
  });
  finishButton.hidden = !drawMode || drawMode === "rectangle";
  map.getContainer().classList.toggle("is-drawing", Boolean(drawMode));
}

function setInformationMode(enabled) {
  informationMode = enabled;
  informationToggle.setAttribute("aria-pressed", String(enabled));
  map.getContainer().classList.toggle("is-identifying", enabled);
  informationStatus.hidden = !enabled;
  informationStatus.textContent = enabled
    ? "Info aktiv: Kartenobjekte anklicken. Ohne diesen Modus lässt sich die Karte verschieben."
    : "";
  if (!enabled) map.closePopup();
  if (enabled) {
    searchMenu.hidden = true;
    searchToggle.setAttribute("aria-expanded", "false");
    measureMenu.hidden = true;
    measureToggle.setAttribute("aria-expanded", "false");
    if (drawMode) setDrawMode(null);
  }
}

function setDrawMode(mode) {
  cancelRectangleDrag();
  sketchLayer.clearLayers();
  sketch = null;
  rectangleDraft = null;
  drawMode = drawMode === mode ? null : mode;

  if (drawMode) {
    sketch = { points: [] };
    drawingHelp.textContent = {
      distance: "Klicke mehrere Punkte; die Strecke wird laufend berechnet.",
      polygon: "Klicke mindestens drei Eckpunkte und beende das Polygon.",
      rectangle: "Ziehe mit gedrückter Maustaste ein Rechteck auf.",
    }[drawMode];
    map.doubleClickZoom.disable();
  } else {
    drawingHelp.textContent = "Werkzeug auswählen, um auf der Karte zu messen.";
    map.doubleClickZoom.enable();
  }

  updateToolButtons();
  describeMeasurement();
}

function completeSketch() {
  if (!drawMode) return;

  const valid = drawMode === "distance"
    ? sketch && sketch.points.length >= 2
    : drawMode === "polygon"
      ? sketch && sketch.points.length >= 3
      : Boolean(rectangleDraft);

  if (!valid) {
    drawingHelp.textContent = drawMode === "distance"
      ? "Für eine Strecke bitte mindestens zwei Punkte setzen."
      : "Für ein Polygon bitte mindestens drei Eckpunkte setzen.";
    return;
  }

  const completedLayers = [];
  sketchLayer.eachLayer((layer) => completedLayers.push(layer));
  sketchLayer.clearLayers();
  completedLayers.forEach((layer) => drawingLayer.addLayer(layer));
  rectangleDraft = null;
  sketch = null;
  cancelRectangleDrag();
  drawMode = null;
  drawingHelp.textContent = "Messung abgeschlossen. Weitere Werkzeuge können direkt verwendet werden.";
  updateToolButtons();
}

function cancelRectangleDrag() {
  if (map.dragging && !map.dragging.enabled()) map.dragging.enable();
  rectangleStart = null;
  map.off("mousemove touchmove", updateRectangle);
  map.off("mouseup touchend", finishRectangleDrag);
}

function getEventLatLng(event) {
  if (event.latlng) return event.latlng;
  const touch = event.originalEvent.touches && event.originalEvent.touches[0];
  if (!touch) return null;
  return map.mouseEventToLatLng(touch);
}

function startRectangleDrag(event) {
  if (drawMode !== "rectangle" || event.originalEvent.button > 0) return;
  const latLng = getEventLatLng(event);
  if (!latLng) return;

  L.DomEvent.stopPropagation(event.originalEvent);
  rectangleStart = latLng;
  rectangleDraft = L.rectangle([rectangleStart, rectangleStart], {
    color: "#e47736",
    fillColor: "#f5a66f",
    fillOpacity: 0.22,
    weight: 3,
    dashArray: "6 5",
  }).addTo(sketchLayer);
  map.dragging.disable();
  map.on("mousemove touchmove", updateRectangle);
  map.on("mouseup touchend", finishRectangleDrag);
}

function updateRectangle(event) {
  const latLng = getEventLatLng(event);
  if (!rectangleStart || !latLng || !rectangleDraft) return;
  rectangleDraft.setBounds(L.latLngBounds(rectangleStart, latLng));
  describeMeasurement();
}

function finishRectangleDrag() {
  if (!rectangleStart) return;
  cancelRectangleDrag();
  if (!rectangleDraft || rectangleDraft.getBounds().getNorthEast().equals(rectangleDraft.getBounds().getSouthWest())) {
    if (rectangleDraft) sketchLayer.removeLayer(rectangleDraft);
    rectangleDraft = null;
    return;
  }
  completeSketch();
}

map.on("click", (event) => {
  if (drawMode === "distance" || drawMode === "polygon") {
    sketch.points.push(event.latlng);
    updateSketch();
    return;
  }
  if (!informationMode) return;

  const target = event.originalEvent && event.originalEvent.target;
  const clickedFeature = target instanceof Element && target.closest(".leaflet-interactive");
  if (!clickedFeature) {
    informationStatus.textContent = `Keine Objektinformation an dieser Stelle · ${event.latlng.lat.toFixed(5)}, ${event.latlng.lng.toFixed(5)}`;
  }
});
map.on("mousedown touchstart", startRectangleDrag);
map.on("dblclick", () => {
  if (drawMode === "distance") completeSketch();
});

toolButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setInformationMode(false);
    setDrawMode(button.dataset.tool);
  });
});

measureToggle.addEventListener("click", () => {
  const isOpen = !measureMenu.hidden;
  measureMenu.hidden = isOpen;
  measureToggle.setAttribute("aria-expanded", String(!isOpen));
  if (!isOpen) {
    searchMenu.hidden = true;
    searchToggle.setAttribute("aria-expanded", "false");
    setInformationMode(false);
  }
});

document.getElementById("close-measure-menu").addEventListener("click", () => {
  measureMenu.hidden = true;
  measureToggle.setAttribute("aria-expanded", "false");
});

informationToggle.addEventListener("click", () => {
  setInformationMode(!informationMode);
});

searchToggle.addEventListener("click", () => {
  const isOpen = !searchMenu.hidden;
  searchMenu.hidden = isOpen;
  searchToggle.setAttribute("aria-expanded", String(!isOpen));
  if (!isOpen) {
    measureMenu.hidden = true;
    measureToggle.setAttribute("aria-expanded", "false");
    setInformationMode(false);
    searchInput.focus();
  }
});

document.getElementById("close-search-menu").addEventListener("click", () => {
  searchMenu.hidden = true;
  searchToggle.setAttribute("aria-expanded", "false");
  searchToggle.focus();
});

function showFeatureInformation(content, event) {
  if (!informationMode) return;
  L.popup({ maxWidth: 390, minWidth: 280 })
    .setLatLng(event.latlng)
    .setContent(content)
    .openOn(map);
  informationStatus.textContent = "Objektinformationen geöffnet.";
}

function activateTab(tab) {
  const isOpen = tab.getAttribute("aria-expanded") === "true";
  const shouldCollapse = isOpen;
  const controlPanel = document.querySelector(".control-panel");
  panelTabs.forEach((item) => {
    const active = !shouldCollapse && item === tab;
    item.setAttribute("aria-expanded", String(active));
    item.classList.toggle("is-active", active);
  });
  tabPanels.forEach((panel) => {
    panel.hidden = shouldCollapse || panel.id !== tab.getAttribute("aria-controls");
  });
  controlPanel.classList.toggle("is-collapsed", shouldCollapse);
  controlPanel.querySelector(".map-credit").hidden = shouldCollapse;
}

panelTabs.forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab));
});

function setLayerVisibility(name, visible) {
  const layerOrLayers = mapLayers.get(name);
  const layers = Array.isArray(layerOrLayers) ? layerOrLayers : [layerOrLayers];
  layers.forEach((layer) => {
    if (visible && !map.hasLayer(layer)) layer.addTo(map);
    if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
  });
}

const layerVisibilityInputs = new Map([
  ["basemap", document.getElementById("toggle-basemap")],
  ["aerial", document.getElementById("toggle-aerial")],
  ["candidates", document.getElementById("toggle-candidates")],
]);

function refreshLayerOrderControls() {
  const items = [...layerOrderList.querySelectorAll(".layer-order-item")];
  items.forEach((item, index) => {
    const input = layerVisibilityInputs.get(item.dataset.layerId);
    const visibility = item.querySelector("[data-layer-visibility]");
    const visible = Boolean(input && input.checked);
    visibility.textContent = visible ? "Sichtbar" : "Aus";
    visibility.classList.toggle("is-visible", visible);
    visibility.setAttribute("aria-label", visible ? "Layer ist sichtbar" : "Layer ist ausgeblendet");
    item.querySelector('[data-direction="up"]').disabled = index === 0;
    item.querySelector('[data-direction="down"]').disabled = index === items.length - 1;
    item.setAttribute("aria-posinset", String(index + 1));
    item.setAttribute("aria-setsize", String(items.length));
  });
}

function applyDataLayerOrder(announce = false) {
  const items = [...layerOrderList.querySelectorAll(".layer-order-item")];
  items.forEach((item, index) => {
    const pane = dataLayerPanes.get(item.dataset.layerId);
    if (pane) pane.style.zIndex = String(390 - index * 25);
  });
  refreshLayerOrderControls();

  if (announce) {
    const firstLayerName = items[0].querySelector(".layer-order-name").textContent;
    document.getElementById("layer-order-status").textContent = `Reihenfolge aktualisiert. Oberster Layer: ${firstLayerName}.`;
  }
}

let draggedLayerItem = null;
let layerOrderChanged = false;

layerOrderList.addEventListener("dragstart", (event) => {
  const item = event.target.closest(".layer-order-item");
  if (!item) return;
  draggedLayerItem = item;
  layerOrderChanged = false;
  item.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", item.dataset.layerId);
});

layerOrderList.addEventListener("dragover", (event) => {
  const target = event.target.closest(".layer-order-item");
  if (!draggedLayerItem || !target || target === draggedLayerItem) return;
  event.preventDefault();
  const insertAfter = event.clientY >= target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
  layerOrderList.insertBefore(draggedLayerItem, insertAfter ? target.nextElementSibling : target);
  layerOrderChanged = true;
});

layerOrderList.addEventListener("drop", (event) => {
  if (draggedLayerItem) event.preventDefault();
});

layerOrderList.addEventListener("dragend", () => {
  if (!draggedLayerItem) return;
  draggedLayerItem.classList.remove("is-dragging");
  draggedLayerItem = null;
  if (layerOrderChanged) applyDataLayerOrder(true);
});

layerOrderList.addEventListener("click", (event) => {
  const button = event.target.closest(".layer-order-move");
  if (!button) return;
  const item = button.closest(".layer-order-item");
  const sibling = button.dataset.direction === "up" ? item.previousElementSibling : item.nextElementSibling;
  if (!sibling) return;
  layerOrderList.insertBefore(item, button.dataset.direction === "up" ? sibling : sibling.nextElementSibling);
  applyDataLayerOrder(true);
  const movedIndex = [...layerOrderList.children].indexOf(item);
  item.querySelector(`[data-direction="${movedIndex === 0 ? "down" : "up"}"]`).focus();
});

applyDataLayerOrder();

[
  ["toggle-basemap", "basemap"],
  ["toggle-aerial", "aerial"],
  ["toggle-candidates", "candidates"],
  ["toggle-measurements", "measurements"],
].forEach(([inputId, layerName]) => {
  const checkbox = document.getElementById(inputId);
  checkbox.addEventListener("change", () => {
    setLayerVisibility(layerName, checkbox.checked);
    refreshLayerOrderControls();
  });
});

finishButton.addEventListener("click", completeSketch);
clearButton.addEventListener("click", () => {
  setDrawMode(null);
  drawingLayer.clearLayers();
  sketchLayer.clearLayers();
  measurementResult.textContent = "";
  drawingHelp.textContent = "Werkzeug auswählen, um auf der Karte zu messen.";
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && drawMode) setDrawMode(null);
});

function propertiesFor(feature) {
  return feature && feature.properties ? feature.properties : {};
}

function makeFeaturePopup(feature) {
  return makeMeasureInfoPopup(feature);
}

function firstProperty(properties, names) {
  for (const name of names) {
    if (properties[name] !== undefined && properties[name] !== null && properties[name] !== "") {
      return properties[name];
    }
  }
  return null;
}

function addInfoMetric(parent, label, value, note, variant = "") {
  const card = L.DomUtil.create("section", `feature-metric ${variant}`.trim(), parent);
  const heading = L.DomUtil.create("h3", "", card);
  heading.textContent = label;
  const output = L.DomUtil.create("strong", "feature-metric-value", card);
  output.textContent = value;
  const description = L.DomUtil.create("p", "feature-metric-note", card);
  description.textContent = note;
}

function formatInfoArea(value) {
  const area = Number(value);
  if (!Number.isFinite(area) || area < 0) return null;
  return `${area.toLocaleString("de-DE", { maximumFractionDigits: 1 })} m²`;
}

function formatMeasures(value) {
  if (Array.isArray(value)) {
    const measures = value.map(String).filter(Boolean);
    return measures.length ? measures.join(", ") : null;
  }
  if (typeof value === "string") return value.trim() || null;
  return null;
}

function makeMeasureInfoPopup(feature) {
  const properties = propertiesFor(feature);
  const content = L.DomUtil.create("article", "feature-popup feature-info-card");
  const heading = L.DomUtil.create("header", "feature-info-heading", content);
  const title = L.DomUtil.create("h2", "", heading);
  title.textContent = properties.name || properties.titel || "Entsiegelungsfläche";
  const subtitle = L.DomUtil.create("p", "feature-info-subtitle", heading);
  subtitle.textContent = "Entsiegelungspotenzial";

  const metrics = L.DomUtil.create("div", "feature-metrics", content);
  const explicitRating = firstProperty(properties, [
    "bewertungsstufe",
    "bewertungstufe",
    "bewertungs_stufe",
    "bewertung_stufe",
  ]);
  const score = Number(properties.score);
  const rawRating = explicitRating ?? (Number.isInteger(score) && score >= 1 && score <= 5 ? score : null);
  const rating = Number(rawRating);
  const validRating = Number.isInteger(rating) && rating >= 1 && rating <= 5;
  const ratingValue = validRating ? `${rating} / 5` : "Noch nicht bewertet";
  const ratingNote = validRating
    ? `Entsiegelungspotenzial ${priorityDescriptions[rating - 1]}`
    : "Entsiegelungspotenzial: Stufe 1 (sehr gering) bis Stufe 5 (sehr hoch)";
  addInfoMetric(metrics, "Bewertungsstufe", ratingValue, ratingNote, validRating ? `rating-${rating}` : "is-unavailable");

  const rawArea = firstProperty(properties, [
    "entsiegelbare_flaeche_qm",
    "entsiegelbare_flaeche",
    "entsiegelungsflaeche_qm",
    "entsiegelungsflaeche",
    "flaeche_entsiegelung_qm",
    "flaeche_entsiegelung",
    "flaeche_qm",
  ]);
  const area = rawArea === null ? null : formatInfoArea(rawArea);
  addInfoMetric(
    metrics,
    "Entsiegelbare Fläche",
    area || "Nicht hinterlegt",
    area
      ? "Für diese Fläche vorgesehene Entsiegelung"
      : "Flächengröße ist im Datensatz nicht enthalten",
    area ? "" : "is-unavailable",
  );

  const rawMeasures = firstProperty(properties, [
    "vorgeschlagene_massnahmen",
    "vorgeschlagene_massnahme",
    "massnahmen_vorschlag",
    "massnahme_vorschlag",
    "massnahmen",
    "massnahme",
  ]);
  const measures = formatMeasures(rawMeasures);
  addInfoMetric(
    metrics,
    "Vorgeschlagene Maßnahmen",
    measures || "Noch nicht zugeordnet",
    measures
      ? "Vorschlag für diese Fläche"
      : "Keine Maßnahmen im Datensatz hinterlegt",
    measures ? "" : "is-unavailable",
  );

  const metadataValues = [["Score", properties.score], ["Priorität", properties.priority]];
  const metadata = metadataValues.filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (metadata.length) {
    const section = L.DomUtil.create("section", "feature-info-metadata", content);
    const metaTitle = L.DomUtil.create("h3", "", section);
    metaTitle.textContent = "Zusatzinformationen";
    metadata.forEach(([label, value]) => {
      const row = L.DomUtil.create("p", "feature-popup-meta-row", section);
      row.textContent = `${label}: ${value}`;
    });
  }
  return content;
}

function renderCandidates() {
  const selectedPriority = priorityFilter.value;
  const selectedMeasure = measureFilter.value;

  candidateLayer.clearLayers();
  const visible = allFeatures.filter((feature) => {
    const properties = propertiesFor(feature);
    if (selectedPriority && getPriorityLevel(properties) !== selectedPriority) return false;
    if (selectedMeasure && !featureHasMeasure(properties, selectedMeasure)) return false;
    return true;
  });

  const visibleCollection = { type: "FeatureCollection", features: visible };
  L.geoJSON(visibleCollection, {
    pane: dataLayerPaneNames.get("candidates"),
    style: {
      color: "#176b52",
      fillColor: "#55a783",
      fillOpacity: 0.56,
      weight: 2,
    },
    pointToLayer: (_feature, latLng) => L.circleMarker(latLng, {
      radius: 7,
      color: "#176b52",
      fillColor: "#55a783",
      fillOpacity: 0.8,
      weight: 2,
    }),
    onEachFeature: (feature, layer) => {
      layer.on("click", (event) => showFeatureInformation(makeFeaturePopup(feature), event));
    },
  }).eachLayer((layer) => candidateLayer.addLayer(layer));

  featureCount.textContent = String(visible.length);
  dataStatus.textContent = allFeatures.length
    ? `${visible.length} von ${allFeatures.length} Flächen sichtbar.`
    : "Noch keine Flächendaten vorhanden. GeoJSON kann später ergänzt werden.";
}

function getPriorityLevel(properties) {
  const value = firstProperty(properties, [
    "priority",
    "prioritaet",
    "prioritätsstufe",
    "prioritaetsstufe",
    "bewertungsstufe",
    "bewertungs_stufe",
  ]);
  const match = String(value ?? "").match(/(?:^|\D)([1-5])(?:\D|$)/);
  return match ? match[1] : "";
}

function featureHasMeasure(properties, measureId) {
  const selectedMeasure = measuresById.get(measureId);
  if (!selectedMeasure) return false;
  const selectedValues = new Set([measureId, selectedMeasure.name].map((value) => value.toLocaleLowerCase("de-DE")));
  const propertyNames = [
    "massnahme_id",
    "massnahmen_id",
    "vorgeschlagene_massnahmen",
    "vorgeschlagene_massnahme",
    "massnahmen_vorschlag",
    "massnahme_vorschlag",
    "massnahmen",
    "massnahme",
  ];
  return propertyNames.some((name) => {
    const raw = properties[name];
    const values = Array.isArray(raw)
      ? raw
      : typeof raw === "string"
        ? raw.split(/[,;|]/)
        : [];
    return values.some((value) => selectedValues.has(String(value).trim().toLocaleLowerCase("de-DE")));
  });
}

function configureFilters() {
  priorityFilter.replaceChildren(new Option("Alle Prioritäten", ""));
  for (let level = 1; level <= 5; level += 1) {
    priorityFilter.add(new Option(
      `Stufe ${level} – Entsiegelungspotenzial ${priorityDescriptions[level - 1]}`,
      String(level),
    ));
  }
  priorityFilter.disabled = false;
}

priorityFilter.addEventListener("change", renderCandidates);
measureFilter.addEventListener("change", renderCandidates);

fetch("scoring/massnahmenkatalog.json")
  .then((response) => {
    if (!response.ok) throw new Error(`Maßnahmenkatalog konnte nicht geladen werden (${response.status}).`);
    return response.json();
  })
  .then((catalog) => {
    if (!catalog || !Array.isArray(catalog.measures)) {
      throw new Error("Der Maßnahmenkatalog enthält keine gültige Maßnahmenliste.");
    }
    catalog.measures.forEach((measure) => {
      if (typeof measure.id !== "string" || typeof measure.name !== "string") {
        throw new Error("Der Maßnahmenkatalog enthält einen ungültigen Eintrag.");
      }
      measuresById.set(measure.id, measure);
    });
    measureFilter.replaceChildren(new Option("Alle Maßnahmen", ""));
    catalog.measures.forEach(({ id, name }) => measureFilter.add(new Option(name, id)));
    measureFilter.disabled = catalog.measures.length === 0;
    measureFilterStatus.textContent = catalog.measures.length
      ? ""
      : "Im Maßnahmenkatalog sind keine Maßnahmen hinterlegt.";
    renderCandidates();
  })
  .catch((error) => {
    console.error("Maßnahmenfilter konnte nicht geladen werden:", error);
    measureFilterStatus.textContent = error.message || "Maßnahmenfilter konnte nicht geladen werden.";
  });

fetch("data/geojson/entsiegelungskandidaten.geojson")
  .then((response) => {
    if (!response.ok) {
      throw new Error(`GeoJSON konnte nicht geladen werden (${response.status}).`);
    }
    return response.json();
  })
  .then((geojson) => {
    if (geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
      throw new Error("Die GeoJSON-Datei enthält keine gültige FeatureCollection.");
    }
    allFeatures = geojson.features;
    configureFilters();
    renderCandidates();

    if (allFeatures.length > 0) {
      const bounds = L.geoJSON(geojson).getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 });
    }
  })
  .catch((error) => {
    console.error(error);
    dataStatus.textContent = "Flächendaten konnten nicht geladen werden. Die Karte bleibt nutzbar.";
    featureCount.textContent = "0";
  });

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (isSearching) return;
  const query = searchInput.value.trim();
  if (!query) return;

  isSearching = true;
  const searchButton = searchForm.querySelector("button");
  searchButton.disabled = true;
  searchStatus.textContent = "Adresse wird gesucht …";
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: `${query}, Mainz, Deutschland`,
    format: "jsonv2",
    limit: "1",
    countrycodes: "de",
  });

  const delay = Math.max(0, 1000 - (Date.now() - lastGeocodeRequestAt));
  window.setTimeout(() => {
    lastGeocodeRequestAt = Date.now();
    fetch(url, { headers: { "Accept-Language": "de" } })
      .then((response) => {
        if (!response.ok) throw new Error(`Adresssuche fehlgeschlagen (${response.status}).`);
        return response.json();
      })
      .then((results) => {
        if (results.length === 0) throw new Error("Keine passende Adresse gefunden.");
        const result = results[0];
        const latitude = Number(result.lat);
        const longitude = Number(result.lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          throw new Error("Die Adresssuche lieferte ungültige Koordinaten.");
        }
        map.flyTo([latitude, longitude], 17);
        searchStatus.textContent = result.display_name;
      })
      .catch((error) => {
        console.error(error);
        searchStatus.textContent = error.message || "Adresssuche fehlgeschlagen.";
      })
      .finally(() => {
        isSearching = false;
        searchButton.disabled = false;
      });
  }, delay);
});
