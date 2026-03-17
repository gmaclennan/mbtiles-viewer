/// <reference lib="webworker" />

import { MBTiles } from "mbtiles-reader";
import { pEvent } from "p-event";

const MBTILES_FILENAME = "tiles.mbtiles";
let mbtiles: MBTiles | undefined;

// Request access to the OPFS
const rootPromise = navigator.storage.getDirectory().then(async (root) => {
  // Cleanup on startup, in case last run did not clean up.
  await root.removeEntry(MBTILES_FILENAME).catch(() => {});
  return root;
});

const mbtilesPromise = pEvent<string, MessageEvent<any>>(
  self,
  "message",
  (event) => event.data.type === "file",
).then(async ({ data }) => {
  const file = data.payload as File;
  await copyFileToOpfs(file, MBTILES_FILENAME);
  const mbtiles = await MBTiles.open(MBTILES_FILENAME);

  postMessage({ type: "metadata", payload: mbtiles.metadata });

  return mbtiles;
});

addEventListener("message", async (event) => {
  switch (event.data.type) {
    case "beforeunload":
      mbtiles?.close();
      (await rootPromise).removeEntry(MBTILES_FILENAME).catch(() => {});
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
  mbtiles = mbtiles ?? (await mbtilesPromise);

  try {
    const tile = mbtiles.getTile({ z, x, y });
    const isGzipped = tile.data[0] === 0x1f && tile.data[1] === 0x8b;
    const payload = isGzipped
      ? await gunzip(tile.data.buffer as ArrayBuffer)
      : (tile.data.buffer as ArrayBuffer);

    postMessage({ id, payload }, { transfer: [payload] });
  } catch {
    postMessage({ id, error: "Tile not found" });
  }
}

async function gunzip(inputBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  const decompressionStream = new DecompressionStream("gzip");
  const inputStream = new Response(inputBuffer)
    .body as ReadableStream<Uint8Array>;
  const decompressedStream = inputStream.pipeThrough(
    decompressionStream as any,
  );
  return new Response(decompressedStream).arrayBuffer();
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
