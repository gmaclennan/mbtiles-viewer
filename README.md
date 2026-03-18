# MBTiles Viewer

MBTiles Viewer is an offline-first web app for viewing
[MBTiles files](https://github.com/mapbox/mbtiles-spec). The MBTiles file is
copied to
[OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
and queried with [sqlite-wasm](https://github.com/sqlite/sqlite-wasm). Vector
tiles are rendered with random colours, borrowing ideas from
[mbview](https://github.com/mapbox/mbview). The app is written in vanilla
javascript and built with [vite](https://vite.dev). The website can be installed
as a PWA on desktop and mobile and works offline.

## SMP Export

Once a map is loaded, click the download button (arrow icon, top-right) to
export the MBTiles file as a
[Styled Map Package](https://github.com/digidem/styled-map-package) (.smp)
file. The SMP is generated in a web worker using
[styled-map-package-api](https://github.com/digidem/styled-map-package) and
streamed as a download via a service worker, so even large files don't need to
be held entirely in memory.

## Caveats

The MBTiles file is copied into
[OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
so that it can be queried by sqlite-wasm. This copy should be removed when you
leave the web page, or you re-open the page/app. Browsers do not currently
provide a way to browse files in OPFS.

## Development

To install the dependencies, run:

```bash
npm install
```

To start the application, run:

```bash
npm run dev
```

## Deployment

To build the app for deployment, run:

```bash
npm run build
```

To preview locally, run:

```bash
npm run preview
```

Upload the contents of the `dist` directory to your web server.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file
for details.
