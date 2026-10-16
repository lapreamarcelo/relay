# GPU rendering deployment

The Docker `runner` and dedicated `renderer` targets include the browser renderer bundle, device GLBs, Draco decoder assets, Chromium, and Chromium's Linux libraries. The web build runs `scripts/build-gpu-renderer.mjs` before Next.js, and both targets copy **the generated builder public directory** to `/app/apps/web/public`. This also preserves the models' public attribution files. No CDN model download is needed at render time.

Both targets inherit a shared `browser-runtime` stage. It installs Chromium through the **locked application Playwright package**, using `install --with-deps chromium`; the browser version therefore matches the runtime dependency. `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` is set during installation and inherited at runtime. The browser directory is readable/executable by all runtime users, including the web image's existing `nextjs` UID 1001. Temporary browser profiles use the container's writable `/tmp`; they do not need to write to the browser installation.

The dedicated renderer retains its existing root user, command, database configuration, and resource limits. The web image retains its existing `nextjs` user, ports, command, and standalone build. Existing Compose/Coolify services need no additional browser volume or privileged mode. GPU export uses Chromium's SwiftShader software backend and does not require a host GPU device. Playwright launches Chromium with its default sandbox setting; these images do not introduce a custom OS sandbox policy. Export navigates only the renderer's internally intercepted origin and bundled/library media bytes.

Building a renderer target now includes the web builder stage, because that is the authoritative producer of the generated browser bundle. The browser runtime adds browser/system-library image size and build-time downloads. Build infrastructure therefore needs access to the configured Debian repositories and Playwright browser distribution. Publishing, migrations, and MCP targets retain their prior dependency stages.

## Packaging verification

From the repository root, build the browser bundle and verify its deployment inventory:

```sh
node apps/web/scripts/build-gpu-renderer.mjs
node apps/web/scripts/check-gpu-deployment.mjs
```

The inventory check validates actual glTF binary headers and lengths, the Draco WebAssembly header and wrappers, JavaScript bundle syntax, and asset/browser inheritance in both Docker targets. It does not build or start containers.

When validating a container build in deployment infrastructure, a browser-only smoke check can run without starting the render worker or connecting to the database:

```sh
docker compose run --rm --no-deps renderer node --input-type=module -e 'import {chromium} from "./apps/web/node_modules/playwright/index.mjs"; const browser=await chromium.launch({headless:true,args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]}); const page=await browser.newPage(); console.log(await page.evaluate(()=>Boolean(document.createElement("canvas").getContext("webgl2")))); await browser.close();'
```

Expect `true`. The standard integrated GPU render test exercises model loading and video encoding separately. Docker was checked statically in this workspace; no image was rebuilt, pushed, or deployed as part of this packaging change.

Reference: [Playwright Docker installation and runtime requirements](https://playwright.dev/docs/docker).
