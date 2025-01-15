import { SphericalMercator } from "@mapbox/sphericalmercator";
import type { Database, SqlValue } from "@sqlite.org/sqlite-wasm";
import tiletype from "@mapbox/tiletype";

const sm = new SphericalMercator();

interface MBTilesMetadata {
  name: string;
  format: string;
  scheme: "xyz";
  minzoom: number;
  maxzoom: number;
  center: number[];
  bounds: number[];
  attribution?: string;
  description?: string;
  version?: number;
  type?: "overlay" | "baselayer";
}

function exec<T extends {} = { [columnName: string]: SqlValue }>(
  db: Database,
  sql: string
): T[] {
  return db.exec(sql, {
    rowMode: "object",
    returnValue: "resultRows",
  }) as T[];
}

/**
 * Validates the MBTiles file and returns the metadata.
 */
export function validate(db: Database): MBTilesMetadata {
  const tilesColumns = exec<ColumnInfo>(db, `PRAGMA table_info(tiles)`);
  assertMatchingSchema(tilesColumns, TILES_SCHEMA);

  const metadataColumns = exec<ColumnInfo>(db, `PRAGMA table_info(metadata)`);
  assertMatchingSchema(metadataColumns, METADATA_SCHEMA);

  const metadataRows = exec<MetadataRow>(db, "SELECT * FROM metadata");

  let metadata: any = {};
  for (const { name, value } of metadataRows) {
    switch (name) {
      // The special "json" key/value pair allows JSON to be serialized
      // and merged into the metadata of an MBTiles based source. This
      // enables nested properties and non-string datatypes to be
      // captured by the MBTiles metadata table.
      case "json":
        metadata = { ...JSON.parse(value), ...metadata };
        break;
      case "minzoom":
      case "maxzoom":
      case "center":
      case "bounds":
        // ignore, we'll calculate these later
        break;
      default:
        metadata[name] = value;
        break;
    }
  }

  if (!metadata["name"]) {
    throw new Error("Invalid MBTiles file: Missing name metadata");
  }
  if (
    metadata.format === "pbf" &&
    !metadataRows.some((r) => r.name === "json")
  ) {
    throw new Error("Invalid MBTiles file: Missing json metadata");
  }
  // Guarantee that we always return proper scheme type, even if 'tms' is specified in metadata
  metadata.scheme = "xyz";

  const [{ minzoom, maxzoom }] = exec<{ minzoom: number; maxzoom: number }>(
    db,
    "SELECT MIN(zoom_level) as minzoom, MAX(zoom_level) as maxzoom FROM tiles"
  );
  metadata.minzoom = minzoom;
  metadata.maxzoom = maxzoom;

  const [{ maxx, minx, maxy, miny }] = exec<{
    maxx: number;
    minx: number;
    maxy: number;
    miny: number;
  }>(
    db,
    "SELECT MAX(tile_column) AS maxx, " +
      "MIN(tile_column) AS minx, MAX(tile_row) AS maxy, " +
      "MIN(tile_row) AS miny FROM tiles " +
      "WHERE zoom_level = " +
      maxzoom
  );
  var urTile = sm.bbox(maxx, maxy, maxzoom, true);
  var llTile = sm.bbox(minx, miny, maxzoom, true);
  metadata.bounds = [
    llTile[0] > -180 ? llTile[0] : -180,
    llTile[1] > -90 ? llTile[1] : -90,
    urTile[2] < 180 ? urTile[2] : 180,
    urTile[3] < 90 ? urTile[3] : 90,
  ].map((v) => round(v, 6));

  const range = metadata.maxzoom - metadata.minzoom;
  const [w, s, e, n] = metadata.bounds;
  metadata.center = [
    (e - w) / 2 + w,
    (n - s) / 2 + s,
    range <= 1 ? metadata.maxzoom : Math.floor(range * 0.5) + metadata.minzoom,
  ];

  if (!metadata.format) {
    const [{ tile_data }] = exec(
      db,
      "SELECT tile_data FROM tiles WHERE tile_data IS NOT NULL LIMIT 1"
    );
    if (tile_data) {
      metadata.format = tiletype.type(tile_data as Buffer);
    }
  }

  return metadata;
}

interface ColumnInfo {
  type: "INTEGER" | "BLOB" | "TEXT";
  pk: 1 | 0;
  cid: number;
  notnull: 1 | 0;
  dflt_value: any;
  name: string;
}

type ColumnSchema = Record<string, Partial<Omit<ColumnInfo, "name">>>;
type TypedRow<T extends Record<string, { type: ColumnInfo["type"] }>> = {
  [K in keyof T]: T[K]["type"] extends "INTEGER"
    ? number
    : T[K]["type"] extends "TEXT"
    ? string
    : T[K]["type"] extends "BLOB"
    ? Buffer
    : never;
};
// type TileRow = TypedRow<typeof TILES_SCHEMA>;
type MetadataRow = TypedRow<typeof METADATA_SCHEMA>;

const METADATA_SCHEMA = {
  name: { type: "TEXT" },
  value: { type: "TEXT" },
} satisfies ColumnSchema;

const TILES_SCHEMA = {
  zoom_level: { type: "INTEGER" },
  tile_column: { type: "INTEGER" },
  tile_row: { type: "INTEGER" },
  tile_data: { type: "BLOB" },
} satisfies ColumnSchema;

function assertMatchingSchema(columns: ColumnInfo[], schema: ColumnSchema) {
  for (const [name, info] of Object.entries(schema)) {
    const column = columns.find((c) => c.name === name);
    assert(column, `Missing column '${name}'`);
    for (const [prop, value] of Object.entries(info)) {
      assert(
        // @ts-expect-error
        column[prop] === value,
        // @ts-expect-error
        `Column '${name}' should have ${prop}=${value}, but instead ${prop}=${column[prop]}`
      );
    }
  }
}

function assert(condition: any, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function round(value: number, precision: number) {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}
