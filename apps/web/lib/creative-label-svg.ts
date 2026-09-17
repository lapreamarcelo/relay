import "server-only";
import type { CreativeLabel } from "@relay/core";
import { creativeLabelsMarkup } from "./creative-label-markup";
export function creativeLabelsSvg(labels: CreativeLabel[], width=1080, height=1920):Buffer { return Buffer.from(creativeLabelsMarkup(labels,width,height)); }
