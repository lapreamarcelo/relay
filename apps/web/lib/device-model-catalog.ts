import type { DeviceFrame } from "@relay/core";

export const deviceModels = [
  { id: "watch-ultra-2", device: "watch", name: "Watch Ultra 2", file: "watch-ultra-2.glb", author: "polyman", source: "https://sketchfab.com/3d-models/apple-watch-ultra-2-f33263c457664b43909200c5ed5e6fa2", license: "CC BY 4.0" },
  { id: "iphone-15-pro-max", device: "iphone", name: "iPhone 15 Pro Max", file: "iphone-15-pro-max.glb", author: "MpPower™", source: "https://sketchfab.com/3d-models/iphone-15-pro-max-5b7b35513a154ac69619dc2b2fe15686", license: "CC BY 4.0" },
  { id: "galaxy-s25-ultra", device: "android", name: "Galaxy S25 Ultra", file: "galaxy-s25-ultra.glb", author: "mistJS", source: "https://sketchfab.com/mistjs", license: "CC BY 4.0" },
  { id: "relay-phone", device: "phone", name: "Relay phone", author: "Relay", license: "Original geometry" },
  { id: "relay-tablet", device: "tablet", name: "Relay tablet", author: "Relay", license: "Original geometry" },
  { id: "relay-duo", device: "iphone-duo", name: "Relay folding phone", author: "Relay", license: "Original geometry" },
  { id: "relay-laptop", device: "mac", name: "Relay laptop", author: "Relay", license: "Original geometry" },
  { id: "relay-browser", device: "browser", name: "Browser card", author: "Relay", license: "Original geometry" },
] as const;

export function deviceModel(frame: Pick<DeviceFrame,"device"|"modelId">) {
  return deviceModels.find(model=>model.id===frame.modelId && model.device===frame.device)
    ?? deviceModels.find(model=>model.device===frame.device)!;
}
export const modelAssetPath = (file:string) => `/devices/${file}`;
export const isGpuFrame = (frame?:DeviceFrame) => frame?.renderMode === "gpu";
