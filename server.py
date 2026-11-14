import json
import math
import sqlite3
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
ADDRESS = ("127.0.0.1", 8000)
DOP20_GEOPACKAGE_PATH = ROOT / "data" / "geopackage" / "dop20_mainz.gpkg"
DOP20_TABLE = "dop20"
UTM_ZONE = 32
UTM_CENTRAL_MERIDIAN = math.radians(UTM_ZONE * 6 - 183)
UTM_SCALE = 0.9996
WGS84_A = 6_378_137.0
WGS84_F = 1 / 298.257223563
WGS84_E2 = WGS84_F * (2 - WGS84_F)
WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2)

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
    pixel_sizes = {}
    for zoom, column, row, matrix_width, matrix_height, tile_width, tile_height, pixel_x, pixel_y in rows:
        if not (0 <= column < matrix_width and 0 <= row < matrix_height):
            raise ValueError("Das DOP20-GeoPackage enthält eine Kachel außerhalb ihrer Matrix.")
        tile_span_x = tile_width * pixel_x
        tile_span_y = tile_height * pixel_y
        west = min_x + column * tile_span_x
        east = west + tile_span_x
        north = max_y - row * tile_span_y
        south = north - tile_span_y
        corners = [
            utm_to_wgs84(x, y)
            for x, y in ((west, south), (west, north), (east, south), (east, north))
        ]
        tiles.append({
            "zoom": zoom,
            "column": column,
            "row": row,
            "url": f"/api/geopackage/dop20/tiles/{zoom}/{column}/{row}",
            "bounds": [
                [min(latitude for _, latitude in corners), min(longitude for longitude, _ in corners)],
                [max(latitude for _, latitude in corners), max(longitude for longitude, _ in corners)],
            ],
        })
        zoom_levels.add(zoom)
        pixel_sizes[zoom] = [pixel_x, pixel_y]

    if not tiles:
        raise ValueError("Das DOP20-GeoPackage enthält keine Bildkacheln.")
    return {
        "layer": DOP20_TABLE,
        "tiles": tiles,
        "zoomLevels": sorted(zoom_levels),
        "pixelSizes": pixel_sizes,
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

if __name__ == "__main__":
    handler = partial(ProjectRequestHandler, directory=str(ROOT))
    with ThreadingHTTPServer(ADDRESS, handler) as server:
        print(f"Website bereit unter http://{ADDRESS[0]}:{ADDRESS[1]}")
        server.serve_forever()
