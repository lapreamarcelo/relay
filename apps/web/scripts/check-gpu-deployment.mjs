import {readFile,stat} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import {Script} from "node:vm";

const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),repo=path.resolve(web,"../..");
const docker=await readFile(path.join(repo,"Dockerfile"),"utf8");
const stages=new Map([...docker.matchAll(/^FROM (\S+) AS (\S+)\n([\s\S]*?)(?=^FROM |$(?![\s\S]))/gm)].map(match=>[match[2],{parent:match[1],body:match[3]}]));
const browser=stages.get("browser-runtime");
assert.ok(browser,"A browser runtime is required for GPU exports.");
assert.match(browser.body,/ENV PLAYWRIGHT_BROWSERS_PATH=\/ms-playwright/);
assert.match(browser.body,/\/app\/apps\/web\/node_modules\/playwright\/cli\.js install --with-deps chromium/);
assert.match(browser.body,/chmod -R a\+rX \/ms-playwright/);
for(const name of ["runner","renderer"]){
  const stage=stages.get(name);assert.equal(stage?.parent,"browser-runtime",`${name} must inherit Chromium and its system libraries.`);
  assert.match(stage.body,/COPY --from=builder(?: --chown=nextjs:nodejs)? \/app\/apps\/web\/public \.\/apps\/web\/public/,`${name} needs generated scene assets and device files.`);
}
assert.match(stages.get("runner").body,/USER nextjs/);
assert.equal(stages.get("production").parent,"runner","Preserve the default web target.");

const catalog=await readFile(path.join(web,"lib/device-model-catalog.ts"),"utf8");
const models=[...catalog.matchAll(/file: "([^"]+\.glb)"/g)].map(match=>match[1]);
assert.ok(models.length>=3,"Expected licensed device models in the release catalog.");
for(const model of models){
  const file=await readFile(path.join(web,"public/devices",model));
  assert.equal(file.subarray(0,4).toString(),"glTF",`${model} must contain actual glTF binary data.`);
  assert.equal(file.readUInt32LE(4),2);assert.equal(file.readUInt32LE(8),file.length);
}
const wasm=await readFile(path.join(web,"public/devices/draco/draco_decoder.wasm"));
assert.deepEqual([...wasm.subarray(0,4)],[0,97,115,109]);
for(const file of ["draco_wasm_wrapper.js","draco_decoder.js"])assert.ok((await stat(path.join(web,"public/devices/draco",file))).size>1000);
const scene=await readFile(path.join(web,"public/renderer/scene.js"),"utf8");
assert.ok(scene.length>100000 && scene.includes("relayGpu"),"Build the browser renderer bundle before packaging.");
new Script(scene,{filename:"renderer/scene.js"}); // Parse the browser bundle without executing DOM code.
process.stdout.write(`GPU deployment inventory verified: ${models.length} GLBs, Draco, browser bundle, and both Docker runtime targets.\n`);
