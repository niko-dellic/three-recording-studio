import {
  Scan,
  Proportions,
  Moon,
  Sun,
  Plus,
  Download,
  Trash2,
  Activity,
  Video,
  Link2,
  Square,
  PanelTop,
  PanelLeft,
  Search,
  Keyboard,
  Box,
  Layers,
  SlidersHorizontal,
  Settings,
  Timer,
  Maximize,
  Minimize,
} from "lucide";
import type { IconNode } from "lucide";
const icons: Record<string, IconNode> = {
  moon: Moon,
  sun: Sun,
  github: [
    [
      "path",
      {
        fill: "currentColor",
        stroke: "none",
        d: "M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.09c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.73 1.16 1.73 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.09 1.16a10.76 10.76 0 0 1 5.62 0c2.14-1.46 3.08-1.16 3.08-1.16.62 1.55.23 2.7.12 2.98.72.79 1.15 1.79 1.15 3.02 0 4.32-2.63 5.28-5.14 5.56.4.35.76 1.03.76 2.08v3.09c0 .3.2.65.77.54A11.25 11.25 0 0 0 12 .75Z",
      },
    ],
  ],
  fit: Scan,
  actualSize: Proportions,
  search: Search,
  newChannel: Plus,
  download: Download,
  delete: Trash2,
  "camera-helper": Video,
  "camera-sync": Link2,
  "camera-perspective": Box,
  "camera-top": PanelTop,
  "camera-front": Square,
  "camera-side": PanelLeft,
  fullscreen: Maximize,
  exitFullscreen: Minimize,
  activity: Activity,
  hotkeys: Keyboard,
  settings: Settings,
  canvas: Box,
  tools: Layers,
  notes: Search,
  theming: SlidersHorizontal,
  timeline: Timer,
};
/** An application-owned registry; only these Lucide icons enter the demo bundle. */
export function renderIcon(key: string, doc: Document): Element | undefined {
  if (!Object.hasOwn(icons, key)) return;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.7",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }))
    svg.setAttribute(key, value);
  for (const [tag, attrs] of icons[key]!) {
    const node = doc.createElementNS(svg.namespaceURI, tag);
    for (const [name, value] of Object.entries(attrs))
      node.setAttribute(name, String(value));
    svg.append(node);
  }
  return svg;
}
