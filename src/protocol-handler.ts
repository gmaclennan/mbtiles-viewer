import { type AddProtocolAction } from "maplibre-gl";

export default function createProtocolHandler(
  getTile: ({
    z,
    x,
    y,
  }: {
    z: number;
    x: number;
    y: number;
  }) => Promise<ArrayBuffer>
): AddProtocolAction {
  return async ({ url, type }) => {
    if (type === "json") {
      return { data: null };
    } else if (type === "string") {
      return { data: "" };
    }
    const [z, x, y] = new URL(url).pathname
      // For Firefox URL parsing
      .replace(/^\/\/\./, "")
      .split("/")
      .slice(1)
      .map(Number);
    try {
      return {
        data: await getTile({ z, x, y }),
        cacheControl: "max-age=300", // 5 mins
      };
    } catch (error) {
      console.error(error);
      return { data: undefined };
    }
  };
}
