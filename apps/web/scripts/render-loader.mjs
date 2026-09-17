// Next resolves the server-only marker at build time. Standalone server workers
// use its empty server implementation; application client boundaries stay intact.
import { registerHooks } from "node:module";
const marker = import.meta.resolve("next/dist/compiled/server-only/empty.js");
registerHooks({ resolve(specifier,context,next) { return specifier === "server-only" ? { url:marker,shortCircuit:true } : next(specifier,context); } });
