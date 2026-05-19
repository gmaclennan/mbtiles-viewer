/// <reference lib="webworker" />

import { MBTiles } from "mbtiles-reader";
import { pEvent } from "p-event";
import type { StyleSpecification } from "maplibre-gl";

const MBTILES_FILENAME = "tiles.mbtiles";
let mbtiles: MBTiles | undefined;

const rootPromise = navigator.storage.getDirectory().then(async (root) => {
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
  const instance = await MBTiles.open(MBTILES_FILENAME);
  mbtiles = instance;
  postMessage({
    type: "metadata",
    payload: { ...instance.metadata, fileName: file.name },
  });
  return instance;
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
    case "generateSmpFromMbtiles":
      await handleGenerateSmpFromMbtiles(event.data.port);
      return;
    case "generateSmpFromStyle":
      await handleGenerateSmpFromStyle(event.data);
      return;
  }
});

const WRITE = 0;
const PULL = 0;
const ERROR = 1;
const ABORT = 1;
const CLOSE = 2;

async function handleGenerateSmpFromMbtiles(port: MessagePort) {
  try {
    mbtiles = mbtiles ?? (await mbtilesPromise);
    const stream = await createMbtilesSmpStream(mbtiles);
    const writable = new WritableStream(new MessagePortSink(port));
    await stream.pipeTo(writable);
    postMessage({ type: "smpComplete" });
  } catch (err) {
    port.postMessage({ type: ABORT, reason: String(err) });
    port.close();
    postMessage({ type: "smpError", error: String(err) });
  }
}

interface SmpFromStyleArgs {
  type: "generateSmpFromStyle";
  port: MessagePort;
  styleUrl?: string;
  styleSpec?: StyleSpecification;
  bbox: [number, number, number, number]; // west, south, east, north
  maxZoom: number;
  accessToken?: string;
}

async function handleGenerateSmpFromStyle(args: SmpFromStyleArgs) {
  const { port, styleUrl, styleSpec, bbox, maxZoom, accessToken } = args;
  const writable = new WritableStream(new MessagePortSink(port));
  try {
    const stream =
      styleUrl !== undefined
        ? await streamFromUrl(styleUrl, bbox, maxZoom, accessToken)
        : await streamFromSpec(styleSpec!, bbox, maxZoom, accessToken);
    await stream.pipeTo(writable);
    postMessage({ type: "smpComplete" });
  } catch (err) {
    port.postMessage({ type: ABORT, reason: String(err) });
    try {
      port.close();
    } catch {}
    postMessage({ type: "smpError", error: String(err) });
  }
}

/** Use the high-level `download()` helper for a remote style URL. */
async function streamFromUrl(
  styleUrl: string,
  bbox: [number, number, number, number],
  maxZoom: number,
  accessToken?: string,
) {
  const { download } = await import("styled-map-package-api/download");
  return download({
    styleUrl,
    bbox,
    maxzoom: maxZoom,
    accessToken,
    onprogress: (p) => {
      const totalTiles = Math.max(1, p.tiles.total || 0);
      const fraction = Math.min(
        1,
        (p.tiles.downloaded + p.tiles.skipped) / totalTiles,
      );
      postMessage({ type: "smpProgress", fraction });
    },
  });
}

/** Mirror of `download()` that accepts a pre-built style spec (for tile URLs we
 *  wrap into a basic raster style) so we can drive `StyleDownloader` directly. */
async function streamFromSpec(
  styleSpec: StyleSpecification,
  bbox: [number, number, number, number],
  maxZoom: number,
  accessToken?: string,
): Promise<ReadableStream<Uint8Array>> {
  const [{ StyleDownloader }, { Writer }] = await Promise.all([
    import("styled-map-package-api/style-downloader"),
    import("styled-map-package-api/writer"),
  ]);

  // Cast: the styled-map-package-api types reference its own bundled copy of
  // @maplibre/maplibre-gl-style-spec, which is structurally near-identical
  // but not type-compatible with the maplibre-gl re-export we use elsewhere.
  const downloader = new StyleDownloader(styleSpec as any, {
    concurrency: 24,
    mapboxAccessToken: accessToken,
  });

  // We mirror the structure of styled-map-package-api/download.js so that
  // progress reporting works the same way for both flows.
  const sizeCounter = new TransformStream<Uint8Array, Uint8Array>();
  let lastFraction = 0;

  (async () => {
    try {
      const inlinedStyle = await downloader.getStyle();
      const writer = new Writer(inlinedStyle);
      writer.outputStream.pipeTo(sizeCounter.writable).catch(() => {});

      for await (const spriteInfo of downloader.getSprites()) {
        await writer.addSprite(spriteInfo);
      }

      const tiles = downloader.getTiles({
        bounds: bbox,
        maxzoom: maxZoom,
        onprogress: (s) => {
          const total = Math.max(1, s.total || 0);
          lastFraction = Math.min(1, (s.downloaded + s.skipped) / total);
          postMessage({ type: "smpProgress", fraction: lastFraction });
        },
      });
      await readableFromAsync(tiles).pipeTo(
        writer.createTileWriteStream({ concurrency: 24 }),
      );
      const glyphs = downloader.getGlyphs();
      await readableFromAsync(glyphs).pipeTo(
        writer.createGlyphWriteStream(),
      );
      await writer.finish();
    } catch (err) {
      // The output stream consumer will see the error via the writer.
      try {
        sizeCounter.writable.abort(err as Error);
      } catch {}
    }
  })();

  return sizeCounter.readable;
}

/** Convert an async iterable into a ReadableStream. Mirrors
 *  styled-map-package-api/utils/streams (which isn't a public export). */
function readableFromAsync<T>(iterable: AsyncIterable<T>): ReadableStream<T> {
  if (typeof (ReadableStream as any).from === "function") {
    return (ReadableStream as any).from(iterable);
  }
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream<T>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}

class MessagePortSink implements UnderlyingSink<Uint8Array> {
  #port: MessagePort;
  #controller!: WritableStreamDefaultController;
  #readyResolve!: () => void;
  #readyReject!: (reason: any) => void;
  #readyPromise!: Promise<void>;

  constructor(port: MessagePort) {
    this.#port = port;
    port.onmessage = (event) => this.#onMessage(event.data);
    this.#resetReady();
  }

  start(controller: WritableStreamDefaultController) {
    this.#controller = controller;
    return this.#readyPromise;
  }

  write(chunk: Uint8Array) {
    this.#port.postMessage({ type: WRITE, chunk }, [chunk.buffer]);
    this.#resetReady();
    return this.#readyPromise;
  }

  close() {
    this.#port.postMessage({ type: CLOSE });
    this.#port.close();
  }

  abort(reason: any) {
    this.#port.postMessage({ type: ABORT, reason: String(reason) });
    this.#port.close();
  }

  #onMessage(message: { type: number; reason?: any }) {
    if (message.type === PULL) this.#readyResolve();
    if (message.type === ERROR) {
      this.#controller.error(message.reason);
      this.#readyReject(message.reason);
      this.#port.close();
    }
  }

  #resetReady() {
    this.#readyPromise = new Promise((resolve, reject) => {
      this.#readyResolve = resolve;
      this.#readyReject = reject;
    });
  }
}

const SOURCE_ID = "mbtiles-source";

async function createMbtilesSmpStream(
  reader: MBTiles,
): Promise<ReadableStream<Uint8Array>> {
  const { Writer } = await import("styled-map-package-api/writer");
  const metadata = reader.metadata;

  const style = {
    version: 8,
    name: metadata.name,
    sources: {
      [SOURCE_ID]: {
        ...metadata,
        type: metadata.format === "pbf" ? "vector" : "raster",
        tileSize: metadata.format === "pbf" ? 512 : 256,
      },
    },
    layers:
      metadata.format === "pbf"
        ? [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "white" },
            },
          ]
        : [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "white" },
            },
            {
              id: "raster",
              type: "raster",
              source: SOURCE_ID,
              paint: { "raster-opacity": 1 },
            },
          ],
  };

  const writer = new Writer(style, { dedupe: true });

  (async () => {
    try {
      const tileWriteStream = writer.createTileWriteStream();
      const writable = tileWriteStream.getWriter();
      for (const tile of reader) {
        await writable.write([
          tile.data,
          {
            z: tile.z,
            x: tile.x,
            y: tile.y,
            format: tile.format,
            sourceId: SOURCE_ID,
          },
        ]);
      }
      await writable.close();
      await writer.finish();
    } catch (err) {
      writer.abort(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return writer.outputStream;
}

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
  const opfsFileHandle = await root.getFileHandle(name, { create: true });
  const accessHandle = await opfsFileHandle.createSyncAccessHandle();
  try {
    let position = 0;
    const reader = file.stream().getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accessHandle.write(value, { at: position });
      position += value.byteLength;
    }
  } finally {
    accessHandle.flush();
    accessHandle.close();
  }
}
