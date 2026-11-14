const map = L.map("map", { zoomControl: false, preferCanvas: true }).setView([49.9929, 8.2473], 12);
const dataLayerPaneNames = new Map([
  ["candidates", "data-layer-candidates"],
  ["aerial", "data-layer-aerial"],
  ["basemap", "data-layer-basemap"],
]);
[...dataLayerPaneNames].forEach(([, name], index) => {
  const pane = map.createPane(name);
  pane.style.zIndex = String(390 - index * 25);
});
const featureCount = document.getElementById("feature-count");
const dataStatus = document.getElementById("data-status");
const searchStatus = document.getElementById("search-status");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("address-search");
const priorityOptions = document.getElementById("priority-options");
const measureOptions = document.getElementById("measure-options");
const clearFiltersButton = document.getElementById("clear-filters");
const priorityLegend = document.getElementById("priority-legend");
const measureFilterStatus = document.getElementById("measure-filter-status");
const priorityDescriptions = ["sehr gering", "gering", "mittel", "hoch", "sehr hoch"];
const priorityColors = ["#b7dca8", "#dce478", "#f3d16b", "#ed8a54", "#c83b45"];
const priorityStrokeColors = ["#568b52", "#939a37", "#bd8b2c", "#b94c32", "#8d2530"];
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
const controlPanel = document.querySelector(".control-panel");
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
const candidateBounds = new WeakMap();
let drawMode = null;
let informationMode = false;
let sketch = null;
let rectangleStart = null;
let rectangleDraft = null;
let ignoreNextRectangleClick = false;
let lastGeocodeRequestAt = 0;
let isSearching = false;
let aerialLoadPromise = null;
let aerialTiles = [];
let aerialZoomLevels = [];
let aerialPixelSizes = {};
let aerialTileKey = "";
let aerialRenderGeneration = 0;

basemapLayer.addTo(map);
aerialLayer.addTo(map);
loadDop20Layer();
map.on("moveend", refreshDop20Layer);

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

  aerialLoadPromise = fetch("data/geopackage/dop20_tiles.json")
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`DOP20-Luftbildindex antwortet mit HTTP ${response.status}.`);
      }
      return response.json();
    })
    .then((payload) => {
      const { tiles } = payload;
      if (!Array.isArray(tiles) || tiles.length === 0) {
        throw new Error("Der DOP20-Luftbildindex enthält keine Bildkacheln.");
      }
      const pixelSizes = payload.pixelSizes && typeof payload.pixelSizes === "object"
        ? payload.pixelSizes
        : {};
      const zoomLevels = payload.zoomLevels || [...new Set(tiles.map((tile) => tile.zoom))].sort((a, b) => a - b);
      if (!Array.isArray(zoomLevels) || zoomLevels.length === 0) {
        throw new Error("Der DOP20-Luftbildindex enthält keine Bildkacheln.");
      }
      aerialTiles = tiles;
      aerialZoomLevels = [...zoomLevels].sort((a, b) => a - b);
      aerialPixelSizes = pixelSizes;
      refreshDop20Layer();
      return tiles.length;
    })
    .catch((error) => {
      aerialLoadPromise = null;
      console.error("DOP20-Luftbild konnte nicht geladen werden:", error);
      aerialStatus.textContent = error.message || "DOP20-Luftbild konnte nicht geladen werden.";
    });

  return aerialLoadPromise;
}

function refreshDop20Layer() {
  if (!aerialTiles.length || !aerialZoomLevels.length) return;

  const centerLatitude = map.getCenter().lat * Math.PI / 180;
  const mapMetersPerPixel = 156543.03392804097 * Math.cos(centerLatitude) / (2 ** map.getZoom());
  const selectedZoom = aerialZoomLevels.find((zoom) => {
    const pixelSize = aerialPixelSizes[zoom];
    return pixelSize && Math.sqrt(pixelSize[0] * pixelSize[1]) <= mapMetersPerPixel;
  }) ?? aerialZoomLevels[aerialZoomLevels.length - 1];
  const mapBounds = map.getBounds();
  const visibleTiles = aerialTiles.filter((tile) => {
    if (tile.zoom !== selectedZoom || !Array.isArray(tile.bounds)) return false;
    const [[south, west], [north, east]] = tile.bounds;
    return north >= mapBounds.getSouth()
      && south <= mapBounds.getNorth()
      && east >= mapBounds.getWest()
      && west <= mapBounds.getEast();
  });
  const tileKey = `${selectedZoom}:${visibleTiles.map(({ column, row }) => `${column}/${row}`).join(",")}`;
  if (tileKey === aerialTileKey) return;

  aerialTileKey = tileKey;
  const generation = ++aerialRenderGeneration;
  aerialLayer.clearLayers();
  if (!visibleTiles.length) {
    aerialStatus.textContent = "Kein DOP20-Luftbild im sichtbaren Kartenausschnitt.";
    return;
  }

  visibleTiles.forEach((tile) => {
    const overlay = L.imageOverlay(tile.url, tile.bounds, {
      pane: dataLayerPaneNames.get("aerial"),
      interactive: false,
      alt: "DOP20-Luftbild Mainz",
    });
    overlay.once("error", () => {
      if (generation === aerialRenderGeneration) {
        aerialStatus.textContent = "DOP20-Luftbild konnte nicht geladen werden.";
      }
    });
    aerialLayer.addLayer(overlay);
  });
  aerialStatus.textContent = "";
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

function getMeasurementLabel() {
  if (!sketch) return "";
  if (drawMode === "distance" && sketch.points.length >= 2) {
    const meters = sketch.points.slice(1).reduce(
      (total, point, index) => total + map.distance(sketch.points[index], point),
      0,
    );
    return `Strecke: ${formatDistance(meters)}`;
  } else if (drawMode === "polygon" && sketch.points.length >= 3) {
    return `Fläche: ${formatArea(polygonArea(sketch.points))}`;
  } else if (drawMode === "rectangle" && rectangleDraft) {
    const corners = rectangleDraft.getBounds();
    const bounds = [corners.getSouthWest(), corners.getSouthEast(), corners.getNorthEast(), corners.getNorthWest()];
    return `Fläche: ${formatArea(polygonArea(bounds))}`;
  }
  return "";
}

function describeMeasurement() {
  measurementResult.textContent = getMeasurementLabel();
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
  setMobilePanelHidden(enabled);
  if (!enabled) map.closePopup();
  if (enabled) {
    closeToolMenus();
    collapseControlPanel();
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
      rectangle: "Ziehe ein Rechteck auf oder klicke die zwei diagonal gegenüberliegenden Eckpunkte.",
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

  const label = getMeasurementLabel();
  const completedLayers = [];
  sketchLayer.eachLayer((layer) => completedLayers.push(layer));
  sketchLayer.clearLayers();
  const measurementLayer = completedLayers.find((layer) => typeof layer.getLatLngs === "function");
  if (measurementLayer && label) {
    const bounds = measurementLayer.getBounds();
    const topRight = map.latLngToContainerPoint(bounds.getNorthEast());
    const bottomLeft = map.latLngToContainerPoint(bounds.getSouthWest());
    const labelWidth = Math.max(110, label.length * 7);
    const fitsInside = drawMode !== "distance"
      && Math.abs(topRight.x - bottomLeft.x) >= labelWidth + 12
      && Math.abs(topRight.y - bottomLeft.y) >= 30;
    measurementLayer.bindTooltip(label, {
      permanent: true,
      direction: fitsInside ? "center" : "top",
      offset: [0, -6],
      className: "measurement-label",
    });
  }
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
  ignoreNextRectangleClick = false;
  map.off("mousemove touchmove", updateRectangle);
  map.off("mouseup touchend", finishRectangleDrag);
}

function getEventLatLng(event) {
  if (event.latlng) return event.latlng;
  const touch = event.originalEvent.touches && event.originalEvent.touches[0]
    || event.originalEvent.changedTouches && event.originalEvent.changedTouches[0];
  if (!touch) return null;
  return map.mouseEventToLatLng(touch);
}

function createRectangleDraft(latLng) {
  rectangleStart = latLng;
  rectangleDraft = L.rectangle([latLng, latLng], {
    color: "#e47736",
    fillColor: "#f5a66f",
    fillOpacity: 0.22,
    weight: 3,
    dashArray: "6 5",
  }).addTo(sketchLayer);
}

function rectangleHasArea() {
  if (!rectangleDraft) return false;
  const bounds = rectangleDraft.getBounds();
  return !bounds.getNorthEast().equals(bounds.getSouthWest());
}

function startRectangleDrag(event) {
  if (drawMode !== "rectangle" || event.originalEvent.button > 0) return;
  const latLng = getEventLatLng(event);
  if (!latLng) return;

  L.DomEvent.stopPropagation(event.originalEvent);
  if (rectangleStart) {
    updateRectangle({ latlng: latLng });
  } else {
    createRectangleDraft(latLng);
  }
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
  map.off("mouseup touchend", finishRectangleDrag);
  if (!rectangleHasArea()) {
    ignoreNextRectangleClick = true;
    drawingHelp.textContent = "Startpunkt gesetzt. Ziehe das Rechteck auf oder klicke den diagonal gegenüberliegenden Eckpunkt.";
    return;
  }
  completeSketch();
}

map.on("click", (event) => {
  if (drawMode === "rectangle") {
    if (ignoreNextRectangleClick) {
      ignoreNextRectangleClick = false;
      return;
    }
    if (!rectangleStart) {
      createRectangleDraft(event.latlng);
      map.dragging.disable();
      map.on("mousemove touchmove", updateRectangle);
      drawingHelp.textContent = "Startpunkt gesetzt. Klicke den diagonal gegenüberliegenden Eckpunkt.";
      return;
    }
    updateRectangle(event);
    if (rectangleHasArea()) {
      completeSketch();
    } else {
      drawingHelp.textContent = "Bitte den diagonal gegenüberliegenden Eckpunkt wählen.";
    }
    return;
  }
  if (drawMode === "distance" || drawMode === "polygon") {
    sketch.points.push(event.latlng);
    updateSketch();
    return;
  }
  if (!informationMode) return;

  const feature = findFeatureAtPoint(event.latlng, getInformationHitTolerance(event));
  if (feature) {
    showFeatureInformation(makeFeaturePopup(feature), event);
  } else {
    informationStatus.hidden = false;
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
    if (window.matchMedia("(max-width: 600px)").matches) {
      setMobilePanelHidden(true);
    }
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
    collapseControlPanel();
    setMobilePanelHidden(true);
  } else {
    setMobilePanelHidden(false);
  }
});

document.getElementById("close-measure-menu").addEventListener("click", () => {
  measureMenu.hidden = true;
  measureToggle.setAttribute("aria-expanded", "false");
  setMobilePanelHidden(false);
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
    collapseControlPanel();
    setMobilePanelHidden(true);
    searchInput.focus();
  } else {
    setMobilePanelHidden(false);
  }
});

document.getElementById("close-search-menu").addEventListener("click", () => {
  searchMenu.hidden = true;
  searchToggle.setAttribute("aria-expanded", "false");
  setMobilePanelHidden(false);
  searchToggle.focus();
});

function showFeatureInformation(content, event) {
  if (!informationMode) return;
  const isMobile = window.matchMedia("(max-width: 600px)").matches;
  informationStatus.hidden = true;
  const mapBounds = map.getContainer().getBoundingClientRect();
  const toolboxBounds = mapToolbox.getBoundingClientRect();
  const panelBounds = controlPanel.getBoundingClientRect();
  const topPadding = Math.max(12, panelBounds.bottom - mapBounds.top + 10);
  const bottomPadding = Math.max(90, mapBounds.bottom - toolboxBounds.top + 12);
  const popupMaxHeight = Math.max(80, Math.min(
    250,
    toolboxBounds.top - mapBounds.top - topPadding - 36,
  ));
  L.popup({
    maxWidth: isMobile ? 250 : 390,
    minWidth: isMobile ? 190 : 280,
    maxHeight: isMobile ? popupMaxHeight : undefined,
    offset: isMobile ? L.point(18, 0) : L.point(0, 7),
    autoPanPaddingTopLeft: isMobile ? L.point(12, topPadding) : L.point(5, 5),
    autoPanPaddingBottomRight: isMobile ? L.point(18, bottomPadding) : L.point(5, 5),
  })
    .setLatLng(event.latlng)
    .setContent(content)
    .openOn(map);
  informationStatus.textContent = "Objektinformationen geöffnet.";
}

function pointSegmentDistance(point, start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const position = lengthSquared
    ? Math.max(0, Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared))
    : 0;
  return point.distanceTo(L.point(
    start.x + position * deltaX,
    start.y + position * deltaY,
  ));
}

function pointInRing(point, coordinates) {
  let inside = false;
  let previous = coordinates.length - 1;
  for (let index = 0; index < coordinates.length; index += 1) {
    const currentPoint = map.latLngToLayerPoint(L.latLng(coordinates[index][1], coordinates[index][0]));
    const previousPoint = map.latLngToLayerPoint(L.latLng(coordinates[previous][1], coordinates[previous][0]));
    if ((currentPoint.y > point.y) !== (previousPoint.y > point.y)) {
      const crossingX = ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y))
        / (previousPoint.y - currentPoint.y) + currentPoint.x;
      if (point.x < crossingX) inside = !inside;
    }
    previous = index;
  }
  return inside;
}

function distanceToRing(point, coordinates) {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = map.latLngToLayerPoint(L.latLng(coordinates[index - 1][1], coordinates[index - 1][0]));
    const end = map.latLngToLayerPoint(L.latLng(coordinates[index][1], coordinates[index][0]));
    distance = Math.min(distance, pointSegmentDistance(point, start, end));
  }
  if (coordinates.length > 1) {
    const start = map.latLngToLayerPoint(L.latLng(coordinates[coordinates.length - 1][1], coordinates[coordinates.length - 1][0]));
    const end = map.latLngToLayerPoint(L.latLng(coordinates[0][1], coordinates[0][0]));
    distance = Math.min(distance, pointSegmentDistance(point, start, end));
  }
  return distance;
}

function distanceToLine(point, coordinates) {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = map.latLngToLayerPoint(L.latLng(coordinates[index - 1][1], coordinates[index - 1][0]));
    const end = map.latLngToLayerPoint(L.latLng(coordinates[index][1], coordinates[index][0]));
    distance = Math.min(distance, pointSegmentDistance(point, start, end));
  }
  return distance;
}

function distanceToPolygon(point, rings) {
  if (!rings.length) return Number.POSITIVE_INFINITY;
  if (pointInRing(point, rings[0]) && !rings.slice(1).some((ring) => pointInRing(point, ring))) return 0;
  return rings.reduce((distance, ring) => Math.min(distance, distanceToRing(point, ring)), Number.POSITIVE_INFINITY);
}

function geometryDistanceToPoint(geometry, point) {
  if (!geometry) return Number.POSITIVE_INFINITY;
  switch (geometry.type) {
    case "Point": {
      const position = map.latLngToLayerPoint(L.latLng(geometry.coordinates[1], geometry.coordinates[0]));
      return point.distanceTo(position);
    }
    case "MultiPoint":
      return geometry.coordinates.reduce((distance, coordinates) => {
        const position = map.latLngToLayerPoint(L.latLng(coordinates[1], coordinates[0]));
        return Math.min(distance, point.distanceTo(position));
      }, Number.POSITIVE_INFINITY);
    case "LineString":
      return distanceToLine(point, geometry.coordinates);
    case "MultiLineString":
      return geometry.coordinates.reduce(
        (distance, line) => Math.min(distance, distanceToLine(point, line)),
        Number.POSITIVE_INFINITY,
      );
    case "Polygon":
      return distanceToPolygon(point, geometry.coordinates);
    case "MultiPolygon":
      return geometry.coordinates.reduce(
        (distance, polygon) => Math.min(distance, distanceToPolygon(point, polygon)),
        Number.POSITIVE_INFINITY,
      );
    case "GeometryCollection":
      return geometry.geometries.reduce(
        (distance, item) => Math.min(distance, geometryDistanceToPoint(item, point)),
        Number.POSITIVE_INFINITY,
      );
    default:
      return Number.POSITIVE_INFINITY;
  }
}

function findFeatureAtPoint(latLng, tolerance) {
  if (!map.hasLayer(candidateLayer)) return null;
  const point = map.latLngToLayerPoint(latLng);
  const containerPoint = map.latLngToContainerPoint(latLng);
  const searchBounds = L.latLngBounds(
    map.containerPointToLatLng(L.point(containerPoint.x - tolerance, containerPoint.y - tolerance)),
    map.containerPointToLatLng(L.point(containerPoint.x + tolerance, containerPoint.y + tolerance)),
  );
  const layers = candidateLayer.getLayers();
  let nearestFeature = null;
  let nearestDistance = tolerance + Number.EPSILON;
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    const bounds = candidateBounds.get(layer);
    if (!layer.feature || !bounds || !bounds.intersects(searchBounds)) continue;
    const distance = geometryDistanceToPoint(layer.feature.geometry, point);
    if (distance <= tolerance && distance < nearestDistance) {
      nearestFeature = layer.feature;
      nearestDistance = distance;
    }
  }
  return nearestFeature;
}

function getInformationHitTolerance(event) {
  const originalEvent = event.originalEvent;
  const isTouch = originalEvent?.pointerType === "touch"
    || originalEvent?.touches?.length
    || originalEvent?.changedTouches?.length
    || window.matchMedia("(pointer: coarse)").matches;
  return isTouch ? 24 : 8;
}

function activateTab(tab) {
  const isOpen = tab.getAttribute("aria-expanded") === "true";
  const shouldCollapse = isOpen;
  if (!shouldCollapse && window.matchMedia("(max-width: 600px)").matches) {
    closeToolMenus();
    setInformationMode(false);
  }
  panelTabs.forEach((item) => {
    const active = !shouldCollapse && item === tab;
    item.setAttribute("aria-expanded", String(active));
    item.classList.toggle("is-active", active);
  });
  tabPanels.forEach((panel) => {
    panel.hidden = shouldCollapse || panel.id !== tab.getAttribute("aria-controls");
  });
  controlPanel.classList.toggle("is-collapsed", shouldCollapse);
}

function collapseControlPanel() {
  if (!window.matchMedia("(max-width: 600px)").matches) return;
  panelTabs.forEach((tab) => {
    tab.setAttribute("aria-expanded", "false");
    tab.classList.remove("is-active");
  });
  tabPanels.forEach((panel) => {
    panel.hidden = true;
  });
  controlPanel.classList.add("is-collapsed");
}

function setMobilePanelHidden(hidden) {
  const isMobile = window.matchMedia("(max-width: 600px)").matches;
  controlPanel.classList.toggle("is-mobile-overlay-hidden", hidden && isMobile);
}

function closeToolMenus() {
  searchMenu.hidden = true;
  searchToggle.setAttribute("aria-expanded", "false");
  measureMenu.hidden = true;
  measureToggle.setAttribute("aria-expanded", "false");
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

[
  ["toggle-basemap", "basemap"],
  ["toggle-aerial", "aerial"],
  ["toggle-candidates", "candidates"],
  ["toggle-measurements", "measurements"],
].forEach(([inputId, layerName]) => {
  const checkbox = document.getElementById(inputId);
  checkbox.addEventListener("change", () => {
    setLayerVisibility(layerName, checkbox.checked);
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
  return card;
}

function formatInfoArea(value) {
  const area = Number(value);
  if (!Number.isFinite(area) || area < 0) return null;
  return `${area.toLocaleString("de-DE", { maximumFractionDigits: 1 })} m²`;
}

function formatMeasures(value) {
  const values = Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? value.split(/[,;|]/)
      : [];
  const labels = values
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => measuresById.get(item)?.name || item);
  return labels.length ? labels.join(", ") : null;
}

function catalogMeasuresFor(value) {
  const values = Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? value.split(/[,;|]/)
      : [];
  const measures = values
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => measuresById.get(item)
      || [...measuresById.values()].find(
        (measure) => measure.name.toLocaleLowerCase("de-DE") === item.toLocaleLowerCase("de-DE"),
      ))
    .filter(Boolean);
  return [...new Map(measures.map((measure) => [measure.id, measure])).values()];
}

function addMeasureExampleLinks(card, rawMeasures) {
  const examples = catalogMeasuresFor(rawMeasures)
    .map((measure) => {
      if (typeof measure.source !== "string") return null;
      try {
        const url = new URL(measure.source);
        if (url.protocol !== "https:" && url.protocol !== "http:") return null;
        return { name: measure.name, href: url.href, domain: url.hostname.replace(/^www\./, "") };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (!examples.length) return;

  const links = L.DomUtil.create("div", "feature-example-links", card);
  examples.forEach(({ name, href, domain }) => {
    const link = L.DomUtil.create("a", "feature-popup-link", links);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `Beispiel ${domain} ↗`;
    link.setAttribute("aria-label", `Beispiel für ${name} auf ${domain} öffnen`);
  });
}

function makeMeasureInfoPopup(feature) {
  const properties = propertiesFor(feature);
  const content = L.DomUtil.create("article", "feature-popup feature-info-card");
  const heading = L.DomUtil.create("header", "feature-info-heading", content);
  const title = L.DomUtil.create("h2", "", heading);
  title.textContent = properties.name || properties.titel || properties.nutzung || "Entsiegelungsfläche";
  const subtitle = L.DomUtil.create("p", "feature-info-subtitle", heading);
  subtitle.textContent = "Entsiegelungspotenzial";

  const metrics = L.DomUtil.create("div", "feature-metrics", content);
  const explicitRating = firstProperty(properties, [
    "prioritaet_5",
    "priorität_5",
    "priority",
    "prioritaet",
    "priorität",
    "prioritätsstufe",
    "prioritaetsstufe",
    "bewertungsstufe",
    "bewertungstufe",
    "bewertungs_stufe",
    "bewertung_stufe",
  ]);
  const score = Number(properties.score);
  const rawRating = explicitRating ?? (Number.isInteger(score) && score >= 1 && score <= 5 ? score : null);
  const parsedRating = Number(rawRating);
  const rating = Number.isInteger(parsedRating) ? parsedRating : Number(getPriorityLevel(properties));
  const validRating = Number.isInteger(rating) && rating >= 1 && rating <= 5;
  const ratingValue = validRating ? `${rating} / 5` : "Noch nicht bewertet";
  const ratingNote = validRating
    ? `Entsiegelungspotenzial ${priorityDescriptions[rating - 1]}`
    : "Entsiegelungspotenzial: Stufe 1 (sehr gering) bis Stufe 5 (sehr hoch)";
  addInfoMetric(metrics, "Bewertungsstufe", ratingValue, ratingNote, validRating ? `rating-${rating}` : "is-unavailable");

  const rawArea = firstProperty(properties, [
    "flaeche_m2",
    "flaeche_qm",
    "entsiegelbare_flaeche_qm",
    "entsiegelbare_flaeche",
    "entsiegelungsflaeche_qm",
    "entsiegelungsflaeche",
    "flaeche_entsiegelung_qm",
    "flaeche_entsiegelung",
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
    "massnahme_id",
    "vorgeschlagene_massnahmen",
    "vorgeschlagene_massnahme",
    "massnahmen_vorschlag",
    "massnahme_vorschlag",
    "massnahmen",
    "massnahme",
  ]);
  const measures = formatMeasures(rawMeasures);
  addMeasureExampleLinks(heading, rawMeasures);
  const measureCard = addInfoMetric(
    metrics,
    "Vorgeschlagene Maßnahmen",
    measures || "Noch nicht zugeordnet",
    measures
      ? firstProperty(properties, ["massnahme_begr", "massnahme_berg"]) || "Vorschlag für diese Fläche"
      : "Keine Maßnahmen im Datensatz hinterlegt",
    measures ? "" : "is-unavailable",
  );

  const scoreMetadata = firstProperty(properties, ["score_final", "score"]);
  const priority = firstProperty(properties, [
    "prioritaet_5",
    "priorität_5",
    "priority",
    "prioritaet",
    "prioritätsstufe",
    "prioritaetsstufe",
  ]);
  const metadataValues = [["Score", scoreMetadata], ["Priorität", priority]];
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
  const selectedPriorities = new Set([...priorityOptions.querySelectorAll("input:checked")].map(({ value }) => value));
  const selectedMeasures = new Set([...measureOptions.querySelectorAll("input:checked")].map(({ value }) => value));
  updateClearFiltersButton();

  candidateLayer.clearLayers();
  const visible = allFeatures.filter((feature) => {
    const properties = propertiesFor(feature);
    if (selectedPriorities.size && !selectedPriorities.has(getPriorityLevel(properties))) return false;
    if (
      selectedMeasures.size
      && ![...selectedMeasures].some((measureId) => featureHasMeasure(properties, measureId))
    ) return false;
    return true;
  });

  const visibleCollection = { type: "FeatureCollection", features: visible };
  L.geoJSON(visibleCollection, {
    pane: dataLayerPaneNames.get("candidates"),
    style: (feature) => {
      const priorityLevel = Number(getPriorityLevel(propertiesFor(feature)));
      const colorIndex = priorityLevel - 1;
      return {
        color: priorityStrokeColors[colorIndex] || "#176b52",
        fillColor: priorityColors[colorIndex] || "#55a783",
        fillOpacity: 0.62,
        weight: 2,
      };
    },
    pointToLayer: (feature, latLng) => {
      const colorIndex = Number(getPriorityLevel(propertiesFor(feature))) - 1;
      return L.circleMarker(latLng, {
        radius: 7,
        color: priorityStrokeColors[colorIndex] || "#176b52",
        fillColor: priorityColors[colorIndex] || "#55a783",
        fillOpacity: 0.82,
        weight: 2,
      });
    },
  }).eachLayer((layer) => {
    candidateLayer.addLayer(layer);
    if (typeof layer.getBounds === "function") candidateBounds.set(layer, layer.getBounds());
  });

  featureCount.textContent = String(visible.length);
  dataStatus.textContent = allFeatures.length
    ? `${visible.length} von ${allFeatures.length} Flächen sichtbar.`
    : "Noch keine Flächendaten vorhanden. GeoJSON kann später ergänzt werden.";
}

function getPriorityLevel(properties) {
  const value = firstProperty(properties, [
    "priority",
    "prioritaet",
    "prioritaet_5",
    "priorität_5",
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
  priorityOptions.replaceChildren();
  priorityLegend.replaceChildren();
  for (let level = 1; level <= 5; level += 1) {
    const levelValue = String(level);
    addFilterCheckbox(
      priorityOptions,
      levelValue,
      `Stufe ${level} – ${priorityDescriptions[level - 1]}`,
      priorityColors[level - 1],
    );

    const legendItem = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "priority-swatch";
    swatch.style.backgroundColor = priorityColors[level - 1];
    swatch.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = `Stufe ${level}: ${priorityDescriptions[level - 1]}`;
    legendItem.append(swatch, label);
    priorityLegend.append(legendItem);
  }
  updateClearFiltersButton();
}

clearFiltersButton.addEventListener("click", () => {
  [priorityOptions, measureOptions].forEach((container) => {
    container.querySelectorAll("input:checked").forEach((input) => {
      input.checked = false;
    });
  });
  renderCandidates();
  clearFiltersButton.focus();
});

function updateClearFiltersButton() {
  clearFiltersButton.disabled = !priorityOptions.querySelector("input:checked")
    && !measureOptions.querySelector("input:checked");
}

function addFilterCheckbox(container, value, text, color = null) {
  const label = document.createElement("label");
  label.className = "filter-option";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = value;
  input.addEventListener("change", renderCandidates);
  label.append(input);

  if (color) {
    const swatch = document.createElement("span");
    swatch.className = "priority-swatch";
    swatch.style.backgroundColor = color;
    swatch.setAttribute("aria-hidden", "true");
    label.append(swatch);
  }

  const name = document.createElement("span");
  name.textContent = text;
  label.append(name);
  container.append(label);
}

fetch("scoring/massnahmenkatalog.json", { cache: "no-store" })
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
    measureOptions.replaceChildren();
    catalog.measures.forEach(({ id, name }) => addFilterCheckbox(measureOptions, id, name));
    updateClearFiltersButton();
    measureFilterStatus.textContent = catalog.measures.length
      ? ""
      : "Im Maßnahmenkatalog sind keine Maßnahmen hinterlegt.";
    renderCandidates();
  })
  .catch((error) => {
    console.error("Maßnahmenfilter konnte nicht geladen werden:", error);
    measureFilterStatus.textContent = error.message || "Maßnahmenfilter konnte nicht geladen werden.";
  });

fetch("data/geojson/ergebnis.geojson", { cache: "no-store" })
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
