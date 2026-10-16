/**
 * Docking bridge for the pinned Theatre Studio 0.7.2 dependency.
 * Theatre has no public panel-position or theme API. Keep its internal geometry
 * in sync (CSS sizing alone breaks timeline hit testing), and disable only the
 * panel move/resize handles. Keyframe and timeline gestures remain enabled.
 * Recheck these selectors and the private transaction API when upgrading Theatre.
 */
export async function dockTheatre() {
  type Edge = { from: string; distance: number };
  type Position = { edges: Record<string, Edge> };
  const internal = (
    window as unknown as {
      __TheatreJS_StudioBundle: {
        _studio: {
          transaction(
            fn: (api: {
              drafts: { ahistoric: { pinNotifications?: boolean } };
              stateEditors: {
                studio: {
                  historic: {
                    panelPositions: {
                      setPanelPosition(opts: {
                        panelId: string;
                        position: Position;
                      }): void;
                    };
                  };
                };
              };
            }) => void,
          ): void;
        };
      };
    }
  ).__TheatreJS_StudioBundle._studio;
  internal.transaction(({ stateEditors, drafts }) => {
    drafts.ahistoric.pinNotifications = false;
    stateEditors.studio.historic.panelPositions.setPanelPosition({
      panelId: "sequenceEditor",
      position: {
        edges: {
          left: { from: "screenLeft", distance: 0.22 },
          right: { from: "screenRight", distance: 0 },
          top: { from: "screenTop", distance: 0 },
          bottom: { from: "screenBottom", distance: 0 },
        },
      },
    });
  });

  // Production loads Theatre's UI asynchronously after project.ready.
  let host: HTMLElement | null = null;
  const deadline = performance.now() + 5000;
  while (!host?.shadowRoot && performance.now() < deadline) {
    host = document.querySelector<HTMLElement>("#theatrejs-studio-root");
    if (!host?.shadowRoot) await new Promise(requestAnimationFrame);
  }
  if (!host?.shadowRoot)
    throw new Error("Theatre 0.7.2 docking host is missing");
  const style = document.createElement("style");
  style.textContent = `
    :host { --studio-panel: #171717; --studio-surface: #262626;
      --studio-line: #525252; --studio-text: #fafafa; --studio-muted: #a3a3a3;
      --studio-accent: #e5e5e5; filter: grayscale(1); }
    /* Invert Theatre's dark-only palette for the light workspace. */
    :host-context(html.light) {
      filter: grayscale(1) invert(1);
      /* These invert to the demo's light theme tokens. */
      --studio-panel: #000; --studio-surface: #0a0a0a;
      --studio-line: #2b2b2b; --studio-text: #e8e8e8;
      --studio-muted: #adadad; --studio-accent: #d9d9d9;
    }
    /* Layer list and property editor share the left column; timeline fills the right. */
    .sc-cHMHOW { width: 22%; box-sizing: border-box; }
    .sc-djVXDX { width: calc(22% - 16px); max-height: calc(50% - 52px); }
    [data-testid^="DetailPanel"] {
      left: 8px !important; right: auto !important;
      top: 50% !important; bottom: 8px;
      width: calc(22% - 16px) !important; overflow: auto;
    }
    .sc-bOhtcR { box-shadow: none !important; border-left: 1px solid var(--studio-line); background: var(--studio-panel); }
    .sc-bOhtcR > [style*="cursor:"][style*="resize"] { display: none !important; }
    .sc-dJiZtA { pointer-events: none !important; cursor: default !important; }
    .sc-fFlnrN { background: var(--studio-surface) !important; }
    [data-testid^="DetailPanel"] { box-shadow: none !important; background: var(--studio-surface) !important; border: 1px solid var(--studio-line); }
    [data-pi-key] { color: var(--studio-text) !important; }

    /* Override Theatre's square, shaded toolbar and tree controls. */
    .sc-cHMHOW button, .sc-djVXDX [data-header],
    [data-testid^="DetailPanel"] button {
      box-sizing: border-box;
      background: var(--studio-panel) !important;
      color: var(--studio-text) !important;
      border: 1px solid var(--studio-line) !important;
      border-radius: 6px !important;
      box-shadow: none !important;
      font: 12px/1.4 Inter, ui-sans-serif, system-ui, sans-serif !important;
      font-weight: 400 !important;
    }
    .sc-cHMHOW button {
      display: inline-flex; align-items: center; justify-content: center;
      width: 32px !important; height: 32px !important; padding: 7px !important;
    }
    .sc-cHMHOW { padding: 12px 8px; height: 44px; }
    /* Theatre 0.7.2: omit notifications and external links from the embedded editor. */
    .sc-cHMHOW > .sc-kuVLHQ:last-child > button:nth-of-type(-n + 2) {
      display: none !important;
    }
    .sc-cHMHOW button svg { width: 16px; height: 16px; }
    .sc-djVXDX [data-header] {
      min-height: 28px; padding: 3px 6px; margin-bottom: 4px;
      max-width: 100%; cursor: pointer;
    }
    .sc-djVXDX [data-header] > span,
    .sc-djVXDX [data-header] > span > span {
      background: transparent !important; box-shadow: none !important;
      color: inherit !important; font: inherit !important;
    }
    .sc-djVXDX [data-header].selected {
      background: var(--studio-surface) !important;
      border-color: var(--studio-accent) !important;
    }
    .sc-cHMHOW button:hover, .sc-djVXDX [data-header]:hover,
    [data-testid^="DetailPanel"] button:hover {
      background: var(--studio-surface) !important;
      border-color: var(--studio-accent) !important;
    }
    .sc-cHMHOW button:focus-visible,
    .sc-djVXDX [data-header]:focus-visible,
    [data-testid^="DetailPanel"] button:focus-visible {
      outline: 2px solid var(--studio-accent) !important;
      outline-offset: 2px;
    }
    [data-testid^="DetailPanel"] { border-radius: 6px; }

  `;
  host.shadowRoot.append(style);
}
