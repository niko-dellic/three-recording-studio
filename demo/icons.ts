import {
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
