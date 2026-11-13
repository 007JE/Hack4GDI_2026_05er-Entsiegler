import json
import math
import sqlite3
import struct
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parent
ADDRESS = ("127.0.0.1", 8000)
GEOPACKAGE_PATH = ROOT / "data" / "geopackage" / "mainz_base.gpkg"
NATURE_MONUMENT_GEOPACKAGE_PATH = ROOT / "data" / "geopackage" / "naturdenkmal_point_mainz.gpkg"
DOP20_GEOPACKAGE_PATH = ROOT / "data" / "geopackage" / "dop20_mainz.gpkg"
DOP20_TABLE = "dop20"
MAX_FEATURES = 12_000
UTM_ZONE = 32
UTM_CENTRAL_MERIDIAN = math.radians(UTM_ZONE * 6 - 183)
UTM_SCALE = 0.9996
WGS84_A = 6_378_137.0
WGS84_F = 1 / 298.257223563
WGS84_E2 = WGS84_F * (2 - WGS84_F)
WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2)

LAYERS = {
    "alkis_flurstuecke": {
        "label": "ALKIS-Flurstücke",
        "geometry": "MULTIPOLYGON",
        "properties": ("flstkennz", "flaeche_qm", "t_eigentuemer", "nutzung"),
        "style": "parcels",
    },
    "osm_graues_band_parkplaetze": {
        "label": "Parkplätze / versiegelte Flächen",
        "geometry": "MULTIPOLYGON",
        "properties": ("amenity", "element", "id"),
        "style": "grey",
    },
    "osm_gruenflaechen_groesser_2ha": {
        "label": "Grünflächen über 2 ha",
        "geometry": "MULTIPOLYGON",
        "properties": ("leisure", "area_sqm"),
        "style": "green",
    },
    "naturdenkmal_point_mainz": {
        "label": "Naturdenkmale (Info-Prototyp)",
        "geometry": "MULTIPOINT",
        "properties": ("id", "flaeche", "kennung", "bezeichnung", "reportlink", "rvolink"),
        "style": "nature",
        "path": NATURE_MONUMENT_GEOPACKAGE_PATH,
    },
}


def wgs84_to_utm(longitude, latitude):
    latitude = math.radians(latitude)
    longitude = math.radians(longitude)
    sin_latitude = math.sin(latitude)
    cos_latitude = math.cos(latitude)
    tangent = math.tan(latitude)
    n = WGS84_A / math.sqrt(1 - WGS84_E2 * sin_latitude**2)
    t = tangent**2
    c = WGS84_EP2 * cos_latitude**2
    a = cos_latitude * (longitude - UTM_CENTRAL_MERIDIAN)
    a2 = a * a

    meridian = WGS84_A * (
        (1 - WGS84_E2 / 4 - 3 * WGS84_E2**2 / 64 - 5 * WGS84_E2**3 / 256) * latitude
        - (3 * WGS84_E2 / 8 + 3 * WGS84_E2**2 / 32 + 45 * WGS84_E2**3 / 1024) * math.sin(2 * latitude)
        + (15 * WGS84_E2**2 / 256 + 45 * WGS84_E2**3 / 1024) * math.sin(4 * latitude)
        - (35 * WGS84_E2**3 / 3072) * math.sin(6 * latitude)
    )
    easting = 500_000 + UTM_SCALE * n * (
        a + (1 - t + c) * a**3 / 6
        + (5 - 18 * t + t**2 + 72 * c - 58 * WGS84_EP2) * a**5 / 120
    )
    northing = UTM_SCALE * (
        meridian + n * tangent * (
            a2 / 2
            + (5 - t + 9 * c + 4 * c**2) * a2**2 / 24
            + (61 - 58 * t + t**2 + 600 * c - 330 * WGS84_EP2) * a2**3 / 720
        )
    )
    return easting, northing


def utm_to_wgs84(easting, northing):
    e1 = (1 - math.sqrt(1 - WGS84_E2)) / (1 + math.sqrt(1 - WGS84_E2))
    meridian = northing / UTM_SCALE
    mu = meridian / (
        WGS84_A * (1 - WGS84_E2 / 4 - 3 * WGS84_E2**2 / 64 - 5 * WGS84_E2**3 / 256)
    )
    footpoint = (
        mu
        + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu)
        + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu)
        + (151 * e1**3 / 96) * math.sin(6 * mu)
        + (1097 * e1**4 / 512) * math.sin(8 * mu)
    )
    sin_footpoint = math.sin(footpoint)
    cos_footpoint = math.cos(footpoint)
    tangent = math.tan(footpoint)
    c1 = WGS84_EP2 * cos_footpoint**2
    t1 = tangent**2
    n1 = WGS84_A / math.sqrt(1 - WGS84_E2 * sin_footpoint**2)
    r1 = WGS84_A * (1 - WGS84_E2) / (1 - WGS84_E2 * sin_footpoint**2) ** 1.5
    d = (easting - 500_000) / (n1 * UTM_SCALE)
    d2 = d * d

    latitude = footpoint - (n1 * tangent / r1) * (
        d2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * WGS84_EP2) * d2**2 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * WGS84_EP2 - 3 * c1**2) * d2**3 / 720
    )
    longitude = UTM_CENTRAL_MERIDIAN + (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * WGS84_EP2 + 24 * t1**2) * d**5 / 120
    ) / cos_footpoint
    return [math.degrees(longitude), math.degrees(latitude)]


def decode_wkb_geometry(blob, transform=utm_to_wgs84):
    position = [0]
    data = memoryview(blob)

    def unpack(fmt, endian):
        size = struct.calcsize(fmt)
        values = struct.unpack_from(endian + fmt, data, position[0])
        position[0] += size
        return values[0] if len(values) == 1 else values

    def read_geometry():
        byte_order = unpack("B", "<")
        endian = "<" if byte_order == 1 else ">"
        geometry_type = unpack("I", endian)
        has_z = bool(geometry_type & 0x80000000)
        has_m = bool(geometry_type & 0x40000000)
        has_srid = bool(geometry_type & 0x20000000)
        if has_srid:
            unpack("I", endian)
        if geometry_type & 0xE0000000:
            base_type = geometry_type & 0xFF
            dimensions = 2 + int(has_z) + int(has_m)
        else:
            dimension = geometry_type // 1000
            base_type = geometry_type % 1000
            dimensions = 2 + int(dimension in (1, 3)) + int(dimension in (2, 3))

        def read_point():
            values = unpack("d" * dimensions, endian)
            return transform(values[0], values[1])

        if base_type == 1:
            return {"type": "Point", "coordinates": read_point()}
        if base_type == 2:
            count = unpack("I", endian)
            return {"type": "LineString", "coordinates": [read_point() for _ in range(count)]}
        if base_type == 3:
            ring_count = unpack("I", endian)
            rings = []
            for _ in range(ring_count):
                point_count = unpack("I", endian)
                rings.append([read_point() for _ in range(point_count)])
            return {"type": "Polygon", "coordinates": rings}
        if base_type in (4, 5, 6, 7):
            names = {4: "MultiPoint", 5: "MultiLineString", 6: "MultiPolygon", 7: "GeometryCollection"}
            count = unpack("I", endian)
            geometries = [read_geometry() for _ in range(count)]
            if base_type == 7:
                return {"type": names[base_type], "geometries": geometries}
            return {"type": names[base_type], "coordinates": [geometry["coordinates"] for geometry in geometries]}
        raise ValueError(f"Nicht unterstützter WKB-Geometrietyp: {base_type}")

    return read_geometry()


def decode_geopackage_geometry(blob):
    data = memoryview(blob)
    if len(data) < 8 or bytes(data[:2]) != b"GP":
        raise ValueError("Ungültiger GeoPackage-Geometrieheader.")
    flags = data[3]
    if flags & 0x10:
        return None
    header_endian = "<" if flags & 1 else ">"
    srs_id = struct.unpack_from(f"{header_endian}i", data, 4)[0]
    if srs_id == 25832:
        transform = utm_to_wgs84
    elif srs_id in (4326, 4258):
        transform = lambda longitude, latitude: [longitude, latitude]
    else:
        raise ValueError(f"Nicht unterstütztes GeoPackage-Koordinatensystem: EPSG:{srs_id}.")
    envelope_indicator = (flags >> 1) & 0x07
    envelope_sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
    if envelope_indicator not in envelope_sizes:
        raise ValueError("Ungültige GeoPackage-Geometriehülle.")
    return decode_wkb_geometry(data[8 + envelope_sizes[envelope_indicator]:], transform)


def parse_bbox(query):
    values = query.get("bbox", [])
    if len(values) != 1:
        raise ValueError("Es wird genau ein gültiger Kartenausschnitt (bbox) benötigt.")
    coordinates = values[0].split(",")
    if len(coordinates) != 4:
        raise ValueError("Der Kartenausschnitt muss vier Koordinaten enthalten.")
    try:
        west, south, east, north = (float(value) for value in coordinates)
    except ValueError as error:
        raise ValueError("Der Kartenausschnitt enthält ungültige Koordinaten.") from error
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError("Der Kartenausschnitt liegt außerhalb gültiger WGS84-Koordinaten.")

    projected = [
        wgs84_to_utm(longitude, latitude)
        for longitude, latitude in (
            (west, south), (west, north), (east, south), (east, north),
            ((west + east) / 2, south), ((west + east) / 2, north),
            (west, (south + north) / 2), (east, (south + north) / 2),
        )
    ]
    margin = 25
    min_x = min(point[0] for point in projected) - margin
    min_y = min(point[1] for point in projected) - margin
    max_x = max(point[0] for point in projected) + margin
    max_y = max(point[1] for point in projected) + margin
    return min_x, min_y, max_x, max_y


def geopackage_features(layer_name, bounds):
    layer = LAYERS[layer_name]
    geopackage_path = layer.get("path", GEOPACKAGE_PATH)
    if not geopackage_path.is_file():
        raise FileNotFoundError(f"GeoPackage nicht gefunden: {geopackage_path.name}")

    min_x, min_y, max_x, max_y = bounds
    connection = sqlite3.connect(f"file:{geopackage_path.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        layer_metadata = connection.execute(
            "SELECT data_type, srs_id FROM gpkg_contents WHERE table_name = ?",
            (layer_name,),
        ).fetchone()
        if layer_metadata is None or layer_metadata["data_type"] != "features" or layer_metadata["srs_id"] != 25832:
            raise ValueError(f"Der Layer {layer_name} fehlt oder verwendet kein EPSG:25832.")

        columns = {
            row["name"] for row in connection.execute(f'PRAGMA table_info("{layer_name}")')
        }
        geometry_column = connection.execute(
            "SELECT column_name FROM gpkg_geometry_columns WHERE table_name = ?",
            (layer_name,),
        ).fetchone()
        if geometry_column is None or not set(layer["properties"]).issubset(columns):
            raise ValueError(f"Die erwartete Layerstruktur für {layer_name} wurde nicht gefunden.")

        rtree_table = f"rtree_{layer_name}_{geometry_column['column_name']}"
        has_rtree = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            (rtree_table,),
        ).fetchone()
        selected_properties = ", ".join(f'feature."{name}"' for name in layer["properties"])
        if has_rtree:
            sql = (
                f'SELECT feature."fid", feature."{geometry_column["column_name"]}", {selected_properties} '
                f'FROM "{layer_name}" AS feature '
                f'JOIN "{rtree_table}" AS bounds ON bounds.id = feature.fid '
                "WHERE bounds.minx <= ? AND bounds.maxx >= ? "
                "AND bounds.miny <= ? AND bounds.maxy >= ? LIMIT ?"
            )
            parameters = (max_x, min_x, max_y, min_y, MAX_FEATURES + 1)
        else:
            sql = (
                f'SELECT "fid", "{geometry_column["column_name"]}", {selected_properties} '
                f'FROM "{layer_name}" LIMIT ?'
            )
            parameters = (MAX_FEATURES + 1,)

        rows = connection.execute(sql, parameters).fetchall()
    finally:
        connection.close()

    truncated = len(rows) > MAX_FEATURES
    features = []
    for row in rows[:MAX_FEATURES]:
        geometry = decode_geopackage_geometry(row[1])
        if geometry is None:
            continue
        properties = {
            name: row[name]
            for name in layer["properties"]
            if row[name] is not None
        }
        features.append({
            "type": "Feature",
            "id": row[0],
            "geometry": geometry,
            "properties": properties,
        })
    return {"type": "FeatureCollection", "features": features, "truncated": truncated}


def geopackage_dop20_tiles():
    if not DOP20_GEOPACKAGE_PATH.is_file():
        raise FileNotFoundError(f"GeoPackage {DOP20_GEOPACKAGE_PATH.name} wurde nicht gefunden.")

    connection = sqlite3.connect(f"file:{DOP20_GEOPACKAGE_PATH.as_posix()}?mode=ro", uri=True)
    try:
        content = connection.execute(
            "SELECT data_type, srs_id FROM gpkg_contents WHERE table_name = ?",
            (DOP20_TABLE,),
        ).fetchone()
        if content != ("tiles", 25832):
            raise ValueError("Das DOP20-GeoPackage enthält keinen Raster-Layer in EPSG:25832.")

        matrix_set = connection.execute(
            "SELECT min_x, min_y, max_x, max_y FROM gpkg_tile_matrix_set WHERE table_name = ?",
            (DOP20_TABLE,),
        ).fetchone()
        if matrix_set is None:
            raise ValueError("Für den DOP20-Raster-Layer fehlt die Kachelausdehnung.")
        min_x, min_y, max_x, max_y = matrix_set

        rows = connection.execute(
            """
            SELECT tiles.zoom_level, tiles.tile_column, tiles.tile_row,
                   matrix.matrix_width, matrix.matrix_height,
                   matrix.tile_width, matrix.tile_height,
                   matrix.pixel_x_size, matrix.pixel_y_size
            FROM dop20 AS tiles
            JOIN gpkg_tile_matrix AS matrix
              ON matrix.table_name = ? AND matrix.zoom_level = tiles.zoom_level
            ORDER BY tiles.zoom_level, tiles.tile_row, tiles.tile_column
            """,
            (DOP20_TABLE,),
        ).fetchall()
    finally:
        connection.close()

    tiles = []
    zoom_levels = set()
    for zoom, column, row, matrix_width, matrix_height, tile_width, tile_height, pixel_x, pixel_y in rows:
        if not (0 <= column < matrix_width and 0 <= row < matrix_height):
            raise ValueError("Das DOP20-GeoPackage enthält eine Kachel außerhalb ihrer Matrix.")
        tile_span_x = tile_width * pixel_x
        tile_span_y = tile_height * pixel_y
        west = min_x + column * tile_span_x
        east = west + tile_span_x
        north = max_y - row * tile_span_y
        south = north - tile_span_y
        southwest = utm_to_wgs84(west, south)
        northeast = utm_to_wgs84(east, north)
        tiles.append({
            "zoom": zoom,
            "column": column,
            "row": row,
            "url": f"/api/geopackage/dop20/tiles/{zoom}/{column}/{row}",
            "bounds": [[southwest[1], southwest[0]], [northeast[1], northeast[0]]],
        })
        zoom_levels.add(zoom)

    if not tiles:
        raise ValueError("Das DOP20-GeoPackage enthält keine Bildkacheln.")
    if len(zoom_levels) != 1:
        raise ValueError("Das DOP20-GeoPackage muss für das Mosaik genau eine Zoomstufe enthalten.")

    min_column = min(tile["column"] for tile in tiles)
    max_column = max(tile["column"] for tile in tiles)
    min_row = min(tile["row"] for tile in tiles)
    max_row = max(tile["row"] for tile in tiles)
    tile_width = rows[0][5]
    tile_height = rows[0][6]
    pixel_x = rows[0][7]
    pixel_y = rows[0][8]
    mosaic_west = min_x + min_column * tile_width * pixel_x
    mosaic_east = min_x + (max_column + 1) * tile_width * pixel_x
    mosaic_north = max_y - min_row * tile_height * pixel_y
    mosaic_south = max_y - (max_row + 1) * tile_height * pixel_y
    southwest = utm_to_wgs84(mosaic_west, mosaic_south)
    northeast = utm_to_wgs84(mosaic_east, mosaic_north)
    source_corners = [
        utm_to_wgs84(mosaic_west, mosaic_north),
        utm_to_wgs84(mosaic_east, mosaic_north),
        utm_to_wgs84(mosaic_east, mosaic_south),
        utm_to_wgs84(mosaic_west, mosaic_south),
    ]
    web_mercator_radius = 6_378_137.0
    projected_corners = [
        (
            web_mercator_radius * math.radians(longitude),
            web_mercator_radius * math.log(math.tan(math.pi / 4 + math.radians(latitude) / 2)),
        )
        for longitude, latitude in source_corners
    ]
    return {
        "layer": DOP20_TABLE,
        "tiles": tiles,
        "zoomLevels": sorted(zoom_levels),
        "tileWidth": tile_width,
        "tileHeight": tile_height,
        "sourceOrigin": [mosaic_west, mosaic_north],
        "pixelSize": [pixel_x, pixel_y],
        "webMercatorBounds": [
            [min(point[0] for point in projected_corners), min(point[1] for point in projected_corners)],
            [max(point[0] for point in projected_corners), max(point[1] for point in projected_corners)],
        ],
        "bounds": [[southwest[1], southwest[0]], [northeast[1], northeast[0]]],
    }


def geopackage_dop20_tile(zoom, column, row):
    if not DOP20_GEOPACKAGE_PATH.is_file():
        raise FileNotFoundError(f"GeoPackage {DOP20_GEOPACKAGE_PATH.name} wurde nicht gefunden.")

    connection = sqlite3.connect(f"file:{DOP20_GEOPACKAGE_PATH.as_posix()}?mode=ro", uri=True)
    try:
        result = connection.execute(
            """
            SELECT tile_data FROM dop20
            WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?
            """,
            (zoom, column, row),
        ).fetchone()
    finally:
        connection.close()
    if result is None:
        raise FileNotFoundError("Die angeforderte DOP20-Bildkachel wurde nicht gefunden.")

    image = result[0]
    if image.startswith(b"\x89PNG\r\n\x1a\n"):
        content_type = "image/png"
    elif image.startswith(b"\xff\xd8\xff"):
        content_type = "image/jpeg"
    else:
        raise ValueError("Die angeforderte DOP20-Kachel hat ein nicht unterstütztes Bildformat.")
    return image, content_type


class ProjectRequestHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/geopackage/dop20/tiles":
            self.geopackage_dop20_tile_index()
            return
        tile_prefix = "/api/geopackage/dop20/tiles/"
        if path.startswith(tile_prefix):
            tile_path = path[len(tile_prefix):]
            self.geopackage_dop20_tile_image(tile_path)
            return
        if path == "/api/geopackage/layers":
            self.geopackage_layers()
            return
        if path == "/api/geopackage/features":
            self.geopackage_layer_features()
            return
        super().do_GET()

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def geopackage_dop20_tile_index(self):
        try:
            tiles = geopackage_dop20_tiles()
        except FileNotFoundError as error:
            self.send_json(404, {"error": str(error)})
            return
        except (sqlite3.Error, ValueError, OverflowError) as error:
            self.send_json(500, {"error": f"DOP20-Kachelübersicht konnte nicht gelesen werden: {error}."})
            return
        self.send_json(200, tiles)

    def geopackage_dop20_tile_image(self, path):
        values = path.split("/")
        if len(values) != 3:
            self.send_json(400, {"error": "Die DOP20-Kacheladresse ist ungültig."})
            return
        try:
            zoom, column, row = (int(value) for value in values)
            if min(zoom, column, row) < 0:
                raise ValueError
            image, content_type = geopackage_dop20_tile(zoom, column, row)
        except ValueError:
            self.send_json(400, {"error": "Die DOP20-Kacheladresse enthält ungültige Koordinaten."})
            return
        except FileNotFoundError as error:
            self.send_json(404, {"error": str(error)})
            return
        except sqlite3.Error as error:
            self.send_json(500, {"error": f"DOP20-Kachel konnte nicht gelesen werden: {error}."})
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(image)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(image)

    def geopackage_layers(self):
        if not GEOPACKAGE_PATH.is_file():
            self.send_json(404, {"error": f"GeoPackage {GEOPACKAGE_PATH.name} wurde nicht gefunden."})
            return
        try:
            layers = []
            for name, metadata in LAYERS.items():
                geopackage_path = metadata.get("path", GEOPACKAGE_PATH)
                if not geopackage_path.is_file():
                    continue
                connection = sqlite3.connect(f"file:{geopackage_path.as_posix()}?mode=ro", uri=True)
                try:
                    row = connection.execute(
                        "SELECT data_type, srs_id FROM gpkg_contents WHERE table_name = ?",
                        (name,),
                    ).fetchone()
                    if row is None or row[0] != "features" or row[1] != 25832:
                        continue
                    count = connection.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
                    layers.append({
                        "name": name,
                        "label": metadata["label"],
                        "geometry": metadata["geometry"],
                        "count": count,
                        "style": metadata["style"],
                    })
                finally:
                    connection.close()
        except sqlite3.Error as error:
            self.send_json(500, {"error": f"GeoPackage konnte nicht gelesen werden: {error}."})
            return
        self.send_json(200, {"layers": layers})

    def geopackage_layer_features(self):
        query = parse_qs(urlsplit(self.path).query)
        layer_names = query.get("layer", [])
        if len(layer_names) != 1 or layer_names[0] not in LAYERS:
            self.send_json(400, {"error": "Der angeforderte GeoPackage-Layer ist ungültig."})
            return
        try:
            bounds = parse_bbox(query)
            collection = geopackage_features(layer_names[0], bounds)
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return
        except FileNotFoundError as error:
            self.send_json(404, {"error": str(error)})
            return
        except (sqlite3.Error, struct.error, OverflowError) as error:
            self.send_json(500, {"error": f"GeoPackage-Layer konnte nicht gelesen werden: {error}."})
            return
        self.send_json(200, collection)


if __name__ == "__main__":
    handler = partial(ProjectRequestHandler, directory=str(ROOT))
    with ThreadingHTTPServer(ADDRESS, handler) as server:
        print(f"Website bereit unter http://{ADDRESS[0]}:{ADDRESS[1]}")
        server.serve_forever()
