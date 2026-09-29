import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";
register();
const { createRelayMcpServer } = await import("./server.ts");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

test("remote MCP advertises timeline tools, isolates client keys and excludes host filesystem access",async()=>{
 const original=globalThis.fetch;const calls=[];globalThis.fetch=async(url,init)=>{calls.push({url,init});return Response.json({data:{ok:true}});};
 const sessions=[];
 try{
  for(const key of ["relay_sk_first","relay_sk_second"]){const server=createRelayMcpServer("https://relay.example",key,true);const client=new Client({name:"test-agent",version:"1.0"});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);sessions.push({server,client});}
  const listed=await sessions[0].client.listTools();assert.ok(listed.tools.some(t=>t.name==="save_video"));assert.ok(listed.tools.some(t=>t.name==="prepare_media_upload"));assert.ok(!listed.tools.some(t=>t.name==="upload_media"));
  const video=listed.tools.find(t=>t.name==="save_video");assert.ok(video.inputSchema.properties.timeline);
  await Promise.all(sessions.map(({client})=>client.callTool({name:"list_videos",arguments:{}})));
  assert.deepEqual(new Set(calls.map(c=>c.init.headers.Authorization)),new Set(["Bearer relay_sk_first","Bearer relay_sk_second"]));
  const deviceFrame={device:"phone",background:"#E8E4DF",color:"#20242A"};
  await sessions[0].client.callTool({name:"save_video",arguments:{name:"Framed demo",timeline:{version:1,aspectRatio:"9:16",clips:[{id:"screen",name:"Screen",sourceUrl:"https://media.example/screen.mp4",kind:"video",inMs:0,outMs:1000,deviceFrame}],labels:[],music:{url:""},coverMs:0}}});
  assert.deepEqual(JSON.parse(calls.at(-1).init.body).timeline.clips[0].deviceFrame,deviceFrame);
  const slideTool=listed.tools.find(t=>t.name==="save_slideshow");assert.ok(slideTool);
  await sessions[0].client.callTool({name:"save_slideshow",arguments:{name:"Framed screenshot",slides:[{mediaUrl:"https://media.example/screen.png",deviceFrame}]}});
  assert.deepEqual(JSON.parse(calls.at(-1).init.body).slides[0].deviceFrame,deviceFrame);
  await sessions[0].client.callTool({name:"fill_queue",arguments:{accountId:"account",postIds:["post"]}});assert.equal(JSON.parse(calls.at(-1).init.body).preview,true);
 }finally{globalThis.fetch=original;await Promise.all(sessions.flatMap(s=>[s.client.close(),s.server.close()]));}
});
