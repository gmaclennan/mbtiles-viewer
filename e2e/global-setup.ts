import { type PreviewServer, preview } from "vite";

const PORT = 4174;
let server: PreviewServer;

export async function setup() {
  server = await preview({
    preview: {
      port: PORT,
      strictPort: true,
    },
    plugins: [
      {
        name: "cross-origin-isolation",
        configurePreviewServer(server) {
          // Set COOP/COEP headers on ALL responses, including internal
          // ones, so that OPFS and SharedArrayBuffer are available.
          server.httpServer.prependListener("request", (_req, res) => {
            res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
            res.setHeader(
              "Cross-Origin-Embedder-Policy",
              "credentialless",
            );
          });
        },
      },
    ],
  });
  console.log(`Preview server started at http://localhost:${PORT}`);
}

export async function teardown() {
  server?.httpServer.close();
}
