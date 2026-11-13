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
const scoreFilter = document.getElementById("score-filter");
const scoreMinInput = document.getElementById("score-min");
const scoreMaxInput = document.getElementById("score-max");
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
const geoPackageStatus = document.getElementById("gpkg-status");
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
const geoPackageLayers = new Map([
  ["alkis_flurstuecke", { label: "ALKIS-Flurstücke", group: L.featureGroup().addTo(map), visible: true }],
  ["klima_hitzeinseln", { label: "Klima-Hitzeinseln", group: L.featureGroup(), visible: false }],
  ["osm_graues_band_parkplaetze", { label: "Parkplätze / versiegelte Flächen", group: L.featureGroup(), visible: false }],
  ["osm_gruenflaechen_groesser_2ha", { label: "Grünflächen über 2 ha", group: L.featureGroup(), visible: false }],
]);
const mapLayers = new Map([
  ["basemap", basemapLayer],
  ["aerial", aerialLayer],
  ["candidates", candidateLayer],
  ["measurements", [drawingLayer, sketchLayer]],
  ...[...geoPackageLayers].map(([name, layer]) => [`gpkg:${name}`, layer.group]),
]);
const geoPackageRequests = new Map();
const geoPackageMessages = new Map();
const staticGeoPackageData = new Map();
let allFeatures = [];
let drawMode = null;
let informationMode = false;
let sketch = null;
let rectangleStart = null;
let rectangleDraft = null;
let scoreBounds = null;
let lastGeocodeRequestAt = 0;
let isSearching = false;
let geoPackageFetchTimer = null;
let aerialLoadPromise = null;

basemapLayer.addTo(map);
aerialLayer.addTo(map);
loadDop20Layer();

L.DomEvent.disableClickPropagation(mapToolbox);
L.DomEvent.disableScrollPropagation(mapToolbox);
document.getElementById("zoom-in").addEventListener("click", () => map.zoomIn());
document.getElementById("zoom-out").addEventListener("click", () => map.zoomOut());
L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);

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
    .then(({ tiles, bounds, tileWidth = 256, tileHeight = 256 }) => {
      if (!Array.isArray(tiles) || tiles.length === 0) {
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
        const mosaicBounds = bounds || [
          [
            Math.min(...tiles.map((tile) => tile.bounds[0][0])),
            Math.min(...tiles.map((tile) => tile.bounds[0][1])),
          ],
          [
            Math.max(...tiles.map((tile) => tile.bounds[1][0])),
            Math.max(...tiles.map((tile) => tile.bounds[1][1])),
          ],
        ];
        const overlay = L.imageOverlay(canvas.toDataURL("image/png"), mosaicBounds, {
          pane: dataLayerPaneNames.get("aerial"),
          interactive: false,
          alt: "DOP20-Luftbild Mainz",
        });
        overlay.once("load", () => {
          aerialStatus.textContent = `DOP20 Mainz geladen (${tiles.length} Quellkacheln, mosaikiert).`;
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
    ? "Objektinfo aktiv: Kartenobjekte anklicken. Ohne diesen Modus lässt sich die Karte verschieben."
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
  L.popup()
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
  ...[...geoPackageLayers].map(([name]) => [`gpkg:${name}`, document.getElementById(`toggle-gpkg-${name}`)]),
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
    if (layerName === "candidates") {
      document.getElementById("filter-candidates-toggle").checked = checkbox.checked;
    }
  });
});

document.getElementById("filter-candidates-toggle").addEventListener("change", (event) => {
  const visible = event.currentTarget.checked;
  document.getElementById("toggle-candidates").checked = visible;
  setLayerVisibility("candidates", visible);
  refreshLayerOrderControls();
});

function setGeoPackageMessage(name, message) {
  geoPackageMessages.set(name, message);
  geoPackageStatus.textContent = [...geoPackageMessages.values()].join(" · ");
}

function stopGeoPackageRequest(name) {
  const request = geoPackageRequests.get(name);
  if (!request) return;
  request.controller.abort();
  geoPackageRequests.delete(name);
}

function geoPackageFeaturePopup(feature) {
  const labels = {
    flstkennz: "Flurstückskennzeichen",
    flaeche_qm: "Fläche",
    t_eigentuemer: "Eigentum",
    nutzung: "Nutzung",
    temp_klasse: "Temperaturklasse",
    leisure: "Typ",
    area_sqm: "Fläche",
  };
  const content = L.DomUtil.create("div", "feature-popup");
  Object.entries(feature.properties || {}).forEach(([name, value]) => {
    const row = L.DomUtil.create("p", "", content);
    const label = labels[name] || name;
    row.textContent = `${label}: ${name === "flaeche_qm" || name === "area_sqm"
      ? `${Number(value).toLocaleString("de-DE")} m²`
      : value}`;
  });
  if (!content.childElementCount) content.textContent = "GeoPackage-Objekt";
  return content;
}

function renderGeoPackageLayer(name, geojson, source = "Kartenausschnitt") {
  const layer = geoPackageLayers.get(name);
  const styles = {
    alkis_flurstuecke: { color: "#b4512d", fillColor: "#e7a372", fillOpacity: 0.04, weight: 1.15 },
    osm_graues_band_parkplaetze: { color: "#545c61", fillColor: "#788087", fillOpacity: 0.36, weight: 1.1 },
    osm_gruenflaechen_groesser_2ha: { color: "#36754e", fillColor: "#69a779", fillOpacity: 0.4, weight: 1.4 },
  };
  const heatStyles = {
    Mittel: { color: "#9b7413", fillColor: "#f2c94c", fillOpacity: 0.48, weight: 1.5 },
    Hoch: { color: "#a34412", fillColor: "#f07832", fillOpacity: 0.58, weight: 1.6 },
    Extrem: { color: "#741d2b", fillColor: "#c93645", fillOpacity: 0.7, weight: 1.8 },
  };
  layer.group.clearLayers();
  L.geoJSON(geojson, {
    pane: dataLayerPaneNames.get("gpkg:" + name),
    style: (feature) => name === "klima_hitzeinseln"
      ? heatStyles[feature.properties?.temp_klasse] || heatStyles.Mittel
      : styles[name],
    onEachFeature: (feature, featureLayer) => {
      featureLayer.on("click", (event) => showFeatureInformation(geoPackageFeaturePopup(feature), event));
    },
  }).eachLayer((featureLayer) => layer.group.addLayer(featureLayer));
  const count = geojson.features.length.toLocaleString("de-DE");
  const checkbox = document.getElementById(`toggle-gpkg-${name}`);
  const label = checkbox?.closest(".layer-toggle").querySelector("[data-gpkg-label]");
  if (label) label.textContent = `${layer.label} (${count})`;
  if (source === "Kartenausschnitt" && geojson.truncated) {
    source = "Kartenausschnitt, Ausschnitt begrenzt";
  }
  setGeoPackageMessage(name, `${layer.label}: ${count} ${source}`);
}

function loadStaticGeoPackageLayer(name) {
  if (!staticGeoPackageData.has(name)) {
    const request = fetch(`data/geojson/geopackage/${name}.geojson`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`statisches GeoJSON antwortet mit HTTP ${response.status}.`);
        }
        const geojson = await response.json();
        if (geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
          throw new Error("Die Datei enthält keine gültige GeoJSON-FeatureCollection.");
        }
        return geojson;
      })
      .catch((error) => {
        staticGeoPackageData.delete(name);
        throw error;
      });
    staticGeoPackageData.set(name, request);
  }
  return staticGeoPackageData.get(name);
}

function fetchGeoPackageLayer(name) {
  const layer = geoPackageLayers.get(name);
  const checkbox = document.getElementById(`toggle-gpkg-${name}`);
  if (!layer || !checkbox || !checkbox.checked) return;
  if (staticGeoPackageData.has(name) && layer.group.getLayers().length > 0) return;

  stopGeoPackageRequest(name);
  const controller = new AbortController();
  const request = { controller, id: Symbol(name) };
  geoPackageRequests.set(name, request);
  setGeoPackageMessage(name, `${layer.label} werden geladen …`);

  const bounds = map.getBounds();
  const requestUrl = new URL("api/geopackage/features", window.location.href);
  requestUrl.search = new URLSearchParams({
    layer: name,
    bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(","),
  });

  fetch(requestUrl, { signal: controller.signal, headers: { Accept: "application/geo+json, application/json" } })
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `GeoPackage antwortet mit HTTP ${response.status}.`);
      }
      return payload;
    })
    .then((geojson) => {
      if (geoPackageRequests.get(name)?.id !== request.id) return;
      if (geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
        throw new Error("Der GeoPackage-Layer lieferte keine gültige GeoJSON-FeatureCollection.");
      }
      renderGeoPackageLayer(name, geojson);
    })
    .catch((error) => {
      if (error.name === "AbortError" || geoPackageRequests.get(name)?.id !== request.id) return;
      setGeoPackageMessage(name, `${layer.label}: API nicht verfügbar, lade statisches GeoJSON …`);
      return loadStaticGeoPackageLayer(name)
        .then((geojson) => {
          if (geoPackageRequests.get(name)?.id !== request.id || !checkbox.checked) return;
          renderGeoPackageLayer(name, geojson, "im Gebiet (statisches GeoJSON)");
        })
        .catch((fallbackError) => {
          if (geoPackageRequests.get(name)?.id !== request.id) return;
          console.error(`GeoPackage-Layer ${name} konnte weder über die API noch als GeoJSON geladen werden:`, {
            apiError: error,
            geojsonError: fallbackError,
          });
          setGeoPackageMessage(
            name,
            `${layer.label} konnte nicht geladen werden: ${fallbackError.message || error.message || "unbekannter Fehler"}`,
          );
        });
    })
    .finally(() => {
      if (geoPackageRequests.get(name)?.id === request.id) geoPackageRequests.delete(name);
    });
}

geoPackageLayers.forEach((layer, name) => {
  const checkbox = document.getElementById(`toggle-gpkg-${name}`);
  checkbox.addEventListener("change", () => {
    layer.visible = checkbox.checked;
    refreshLayerOrderControls();
    setLayerVisibility(`gpkg:${name}`, checkbox.checked);
    if (checkbox.checked) {
      fetchGeoPackageLayer(name);
    } else {
      stopGeoPackageRequest(name);
      layer.group.clearLayers();
      geoPackageMessages.delete(name);
      geoPackageStatus.textContent = [...geoPackageMessages.values()].join(" · ");
    }
  });
});

map.on("moveend", () => {
  window.clearTimeout(geoPackageFetchTimer);
  geoPackageFetchTimer = window.setTimeout(() => {
    geoPackageLayers.forEach((layer, name) => {
      if (layer.visible) fetchGeoPackageLayer(name);
    });
  }, 250);
});

fetch("api/geopackage/layers")
  .then(async (response) => {
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `GeoPackage antwortet mit HTTP ${response.status}.`);
    return payload;
  })
  .then(({ layers }) => {
    if (!Array.isArray(layers)) throw new Error("Der Server lieferte keine GeoPackage-Layerliste.");
    layers.forEach((metadata) => {
      const layer = geoPackageLayers.get(metadata.name);
      const checkbox = document.getElementById(`toggle-gpkg-${metadata.name}`);
      if (!layer || !checkbox) return;
      const label = checkbox.closest(".layer-toggle").querySelector("[data-gpkg-label]");
      if (label) {
        label.textContent = `${metadata.label} (${Number(metadata.count).toLocaleString("de-DE")})`;
      }
    });
    const visibleLayers = [...geoPackageLayers].filter(([, layer]) => layer.visible);
    if (visibleLayers.length) {
      visibleLayers.forEach(([name]) => fetchGeoPackageLayer(name));
    } else {
      geoPackageStatus.textContent = `${layers.length} GeoPackage-Layer verfügbar.`;
    }
  })
  .catch((error) => {
    console.error("GeoPackage-Layerliste konnte nicht geladen werden:", error);
    geoPackageStatus.textContent = error.message || "GeoPackage-Layerliste konnte nicht geladen werden.";
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
  const properties = propertiesFor(feature);
  const content = L.DomUtil.create("div", "feature-popup");
  const title = L.DomUtil.create("strong", "", content);
  title.textContent = properties.name || properties.titel || "Entsiegelungsfläche";

  if (properties.score !== undefined && properties.score !== null) {
    const score = L.DomUtil.create("p", "", content);
    score.textContent = `Score: ${properties.score}`;
  }
  if (properties.priority) {
    const priority = L.DomUtil.create("p", "", content);
    priority.textContent = `Priorität: ${properties.priority}`;
  }
  return content;
}

function renderCandidates() {
  const selectedPriority = priorityFilter.value;
  const minimum = Number(scoreMinInput.value);
  const maximum = Number(scoreMaxInput.value);
  const hasScoreFilter = scoreBounds && (minimum > scoreBounds.min || maximum < scoreBounds.max);

  if (hasScoreFilter && minimum > maximum) {
    dataStatus.textContent = "Der Mindest-Score darf nicht größer als der Höchst-Score sein.";
    return;
  }

  candidateLayer.clearLayers();
  const visible = allFeatures.filter((feature) => {
    const properties = propertiesFor(feature);
    if (selectedPriority && String(properties.priority ?? "") !== selectedPriority) return false;
    if (hasScoreFilter) {
      const score = Number(properties.score);
      if (!Number.isFinite(score) || score < minimum || score > maximum) return false;
    }
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

function configureFilters(features) {
  const scores = features
    .map((feature) => Number(propertiesFor(feature).score))
    .filter(Number.isFinite);
  const priorities = [...new Set(
    features.map((feature) => propertiesFor(feature).priority).filter((value) => value !== undefined && value !== null && value !== ""),
  )].map(String).sort((a, b) => a.localeCompare(b, "de"));

  priorityFilter.replaceChildren(new Option("Alle Prioritäten", ""));
  priorities.forEach((priority) => priorityFilter.add(new Option(priority, priority)));
  priorityFilter.disabled = priorities.length === 0;

  scoreBounds = scores.length
    ? { min: Math.floor(Math.min(...scores)), max: Math.ceil(Math.max(...scores)) }
    : null;
  if (scoreBounds) {
    scoreMinInput.value = String(scoreBounds.min);
    scoreMaxInput.value = String(scoreBounds.max);
  } else {
    scoreMinInput.value = "0";
    scoreMaxInput.value = "100";
  }
  scoreFilter.disabled = !scoreBounds;

  priorityFilter.addEventListener("change", renderCandidates);
  scoreMinInput.addEventListener("input", renderCandidates);
  scoreMaxInput.addEventListener("input", renderCandidates);
}

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
    configureFilters(allFeatures);
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
