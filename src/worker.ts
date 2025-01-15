/// <reference lib="webworker" />

import { pEvent } from "p-event";
import sqlite3InitModule, { type OpfsDatabase } from "@sqlite.org/sqlite-wasm";
import { validate } from "./schema.ts";

const MBTILES_FILENAME = "tiles.mbtiles";
let cleanup = async () => {};
let db: OpfsDatabase | undefined;

// Request access to the OPFS
const rootPromise = navigator.storage.getDirectory().then(async (root) => {
  cleanup = () => root.removeEntry(MBTILES_FILENAME).catch(() => {});
  // Cleanup on startup, in case last run did not clean up.
  await cleanup();
  return root;
});

const dbPromise = pEvent<string, MessageEvent<any>>(
  self,
  "message",
  (event) => event.data.type === "file"
).then(async ({ data }) => {
  const sqlite3 = await sqlite3InitModule();
  const file = data.payload as File;
  await copyFileToOpfs(file, MBTILES_FILENAME);
  const db = new sqlite3.oo1.OpfsDb(MBTILES_FILENAME, "r");

  console.log("Running SQLite3 version", sqlite3.version.libVersion);

  const metadata = validate(db);
  postMessage({ type: "metadata", payload: metadata });

  return db;
});

addEventListener("message", async (event) => {
  switch (event.data.type) {
    case "beforeunload":
      cleanup();
      return;
    case "tileRequest":
      await handleTileRequest(event.data);
      return;
  }
});

async function handleTileRequest({
  payload: { z, x, y },
  id,
}: {
  payload: { z: number; x: number; y: number };
  id: number;
}) {
  if (
    typeof z !== "number" ||
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof id !== "number"
  ) {
    throw new TypeError("Invalid Message");
  }
  const yTMS = (1 << z) - 1 - y;
  db = db ?? (await dbPromise);

  const stmt = db
    .prepare(
      `SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?`
    )
    .bind([z, x, yTMS]);

  let tileData: Uint8Array | null | undefined;

  try {
    if (stmt.step()) {
      tileData = stmt.get(0) as Uint8Array | null;
    }
  } finally {
    stmt.finalize();
  }

  if (!tileData) {
    postMessage({ id, error: "Tile not found" });
    return;
  }
  const isGzipped = tileData[0] === 0x1f && tileData[1] === 0x8b;
  const payload = isGzipped ? await gunzip(tileData.buffer) : tileData.buffer;

  postMessage({ id, payload }, { transfer: [payload] });
}

async function gunzip(inputBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  // Create a DecompressionStream instance for gzip
  const decompressionStream = new DecompressionStream("gzip");

  // Convert the input ArrayBuffer to a ReadableStream
  const inputStream = new Response(inputBuffer)
    .body as ReadableStream<Uint8Array>;

  // Pipe the input stream through the decompression stream
  const decompressedStream = inputStream.pipeThrough(decompressionStream);

  // Read the decompressed stream into a new ArrayBuffer
  const decompressedArrayBuffer = await new Response(
    decompressedStream
  ).arrayBuffer();

  return decompressedArrayBuffer;
}

async function copyFileToOpfs(file: File, name: string) {
  const root = await rootPromise;

  const opfsFileHandle = await root.getFileHandle(name, {
    create: true,
  });
  // Create a writable stream in OPFS
  const accessHandle = await opfsFileHandle.createSyncAccessHandle();
  try {
    // Set the position for writing
    let position = 0;

    // Create a reader for the file stream
    const reader = file.stream().getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Write the chunk to the OPFS
      accessHandle.write(value, { at: position });
      // Update the position for the next chunk
      position += value.byteLength;
    }
  } finally {
    accessHandle.flush();
    accessHandle.close();
  }
}
