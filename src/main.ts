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
// @ts-expect-error
import { registerSW } from "virtual:pwa-register";

// Reload page when service worker updates
registerSW({ immediate: true });

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
    button.textContent = "✖️";
    button.onclick = this.#onClick;
    this.#container.appendChild(button);
    return this.#container;
  }

  onRemove() {
    this.#container?.parentNode?.removeChild(this.#container);
  }
}
