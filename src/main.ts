import "maplibre-gl/dist/maplibre-gl.css";
import pDefer, { type DeferredPromise } from "p-defer";
import { includeKeys } from "filter-obj";
import createProtocolHandler from "./protocol-handler.ts";
import { pEvent } from "p-event";
import {
  NavigationControl,
  type IControl,
  type StyleSpecification,
} from "maplibre-gl";
import { layerStyles } from "./layer-styles.ts";

// Register service worker for PWA + streaming downloads
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(
    import.meta.env.MODE === "production" ? "/sw.js" : "/dev-sw.js?dev-sw",
    { type: import.meta.env.MODE === "production" ? "classic" : "module" },
  );
}

const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});

class Api {
  #id = 0;
  #worker: Worker;
  #pendingTileRequests = new Map<number, DeferredPromise<ArrayBuffer>>();
  constructor(worker: Worker) {
    this.#worker = worker;
    worker.addEventListener("message", this.#handleMessage);
  }
  #handleMessage = (event: MessageEvent<any>) => {
    const pending = this.#pendingTileRequests.get(event.data.id);
    if (!pending) return;
    this.#pendingTileRequests.delete(event.data.id);
    if (event.data.error) {
      pending.reject(new Error(event.data.error));
    } else {
      pending.resolve(event.data.payload);
    }
  };
  async getTile({ z, x, y }: { z: number; x: number; y: number }) {
    const requestId = this.#id++;
    const deferred = pDefer<ArrayBuffer>();
    this.#pendingTileRequests.set(requestId, deferred);
    this.#worker.postMessage({
      type: "tileRequest",
      payload: { z, x, y },
      id: requestId,
    });
    return deferred.promise;
  }
}

const api = new Api(worker);

const input = document.getElementById("file-input") as HTMLInputElement;
const button = document.getElementById("open-button") as HTMLButtonElement;
const spinner = document.getElementById("spinner") as HTMLDivElement;

button?.addEventListener("click", async () => {
  input?.click();
});

input?.addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  setInProgress(true);
  worker.postMessage({ type: "file", payload: file });
});

setInProgress(false);

function setInProgress(inProgress: boolean) {
  if (inProgress) {
    input?.setAttribute("disabled", "true");
    button?.setAttribute("disabled", "true");
    spinner?.classList.remove("hidden");
    button?.classList.add("hidden");
  } else {
    input?.removeAttribute("disabled");
    spinner?.classList.add("hidden");
    button?.classList.remove("hidden");
    button?.removeAttribute("disabled");
  }
}

window.addEventListener("beforeunload", () => {
  worker.postMessage({ type: "beforeunload" });
});

pEvent<"message", MessageEvent<any>>(
  worker,
  "message",
  (event) => event.data.type === "metadata"
).then(async ({ data: { payload: metadata } }) => {
  const map = await mapPromise;
  map.addControl(
    new NavigationControl({
      showCompass: false,
    }),
    "top-right"
  );
  map.addControl(
    new SaveControl({ fileName: metadata.fileName }),
    "top-right"
  );
  map.addControl(
    new CloseControl(() => {
      window.location.reload();
    }),
    "top-left"
  );

  if (metadata.format === "pbf") {
    map.addSource("mbtiles", {
      ...includeKeys(metadata, ["bounds", "center", "minzoom", "maxzoom"]),
      type: "vector",
      tiles: ["mbtiles://./{z}/{x}/{y}"],
    });
    for (const layerStyle of layerStyles(metadata.vector_layers || [])) {
      map.addLayer(layerStyle);
    }
  } else {
    map.addSource("mbtiles", {
      ...includeKeys(metadata, ["bounds", "center", "minzoom", "maxzoom"]),
      type: "raster",
      tiles: ["mbtiles://./{z}/{x}/{y}"],
      tileSize: 256,
    });
    map.addLayer({
      id: "mbtiles",
      type: "raster",
      source: "mbtiles",
    });
  }
  map.fitBounds(metadata.bounds, { duration: 0 });
  map.on("sourcedata", () => {
    map.getContainer().classList.remove("hidden");
  });
});

const style: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#222",
      },
    },
  ],
};

const mapPromise = pEvent(window, "load")
  .then(() => import("maplibre-gl"))
  .then(({ default: maplibre }) => {
    maplibre.addProtocol(
      "mbtiles",
      createProtocolHandler(api.getTile.bind(api))
    );
    return new maplibre.Map({
      container: "map",
      center: [0, 0],
      style,
      zoom: 2,
      attributionControl: false,
      dragRotate: false,
      dragPan: false,
    });
  });

// --- Streaming download ---
// Creates a MessageChannel whose ports connect the web worker directly to the
// service worker. Data flows worker → MessagePort → SW → browser download,
// without passing through the main thread. Based on the pattern from
// native-file-system-adapter by jimmywarting.

/** Start SMP generation in the worker, streaming result to a download */
async function startSmpDownload(fileName: string) {
  const sw = await navigator.serviceWorker?.getRegistration();
  if (!sw?.active) {
    throw new Error("Service worker not available for download");
  }

  const channel = new MessageChannel();
  // port1 → service worker (readable side)
  // port2 → web worker (writable side, uses MessagePortSink with backpressure)

  const encodedName = encodeURIComponent(fileName)
    .replace(/['()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/\*/g, "%2A");

  const headers = {
    "content-disposition": "attachment; filename*=UTF-8''" + encodedName,
    "content-type": "application/octet-stream; charset=utf-8",
  };

  // Send readable port to the SW so it can respond to a fetch with the stream
  sw.active.postMessage(
    { url: sw.scope + encodedName, headers, readablePort: channel.port1 },
    [channel.port1],
  );

  // Send writable port to the worker so it can pipe SMP chunks directly to SW
  worker.postMessage(
    { type: "generateSmp", port: channel.port2 },
    [channel.port2],
  );

  // Trigger the download with a hidden iframe
  const iframe = document.createElement("iframe");
  iframe.hidden = true;
  iframe.src = sw.scope + encodedName;
  document.body.appendChild(iframe);
}

class CloseControl implements IControl {
  #container: HTMLDivElement | undefined;
  #onClick: (ev: MouseEvent) => void;

  constructor(onClick: (ev: MouseEvent) => void) {
    this.#onClick = onClick;
  }
  onAdd() {
    this.#container = document.createElement("div");
    this.#container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const button = document.createElement("button");
    button.className = "maplibregl-ctrl-icon";
    button.title = "Close";
    button.textContent = "\u2716\uFE0F";
    button.onclick = this.#onClick;
    this.#container.appendChild(button);
    return this.#container;
  }

  onRemove() {
    this.#container?.parentNode?.removeChild(this.#container);
  }
}

class SaveControl implements IControl {
  #container: HTMLDivElement | undefined;
  #fileName: string;

  constructor({ fileName }: { fileName: string }) {
    this.#fileName = fileName;
  }

  onAdd() {
    this.#container = document.createElement("div");
    this.#container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const btn = document.createElement("button");
    btn.id = "download-smp";
    btn.className =
      "maplibregl-ctrl-icon block w-[29px] h-[29px] cursor-pointer border-0 bg-transparent p-0";
    btn.title = "Download as SMP";
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-[19px] h-[19px] m-[5px]"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const smpFileName =
          this.#fileName.replace(/\.[^.]+$/, "") + ".smp";
        await startSmpDownload(smpFileName);
      } catch (err) {
        console.error("SMP download failed:", err);
      } finally {
        btn.disabled = false;
      }
    });
    this.#container.appendChild(btn);
    return this.#container;
  }

  onRemove() {
    this.#container?.parentNode?.removeChild(this.#container);
  }
}
