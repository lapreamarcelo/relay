import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import path from "node:path";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
await build({entryPoints:[path.join(root,"lib/gpu-export-browser.ts")],bundle:true,format:"iife",platform:"browser",minify:true,outfile:path.join(root,"public/renderer/scene.js"),legalComments:"eof",define:{"import.meta.url":"location.href"}});
