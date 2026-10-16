export function setupTooltips(
  root: HTMLElement,
  selector: string,
  signal?: AbortSignal,
) {
  let tooltip: HTMLElement | undefined;
  let anchor: HTMLElement | undefined;
  const hide = () => {
    anchor?.removeAttribute("aria-describedby");
    tooltip?.remove();
    tooltip = undefined;
    anchor = undefined;
  };
  const show = (event: Event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>(selector);
    if (!button || anchor === button) return;
    hide();
    anchor = button;
    const doc = button.ownerDocument;
    const win = doc.defaultView!;
    tooltip = doc.createElement("div");
    tooltip.className = "trs-tooltip";
    tooltip.id = `trs-tooltip-${Math.random().toString(36).slice(2)}`;
    tooltip.setAttribute("role", "tooltip");
    tooltip.setAttribute("popover", "manual");
    tooltip.textContent =
      button.dataset.tooltip ??
      (button.getAttribute("aria-label") === "100%"
        ? "Actual size (100%)"
        : button.getAttribute("aria-label"));
    button.removeAttribute("title");
    button.setAttribute("aria-describedby", tooltip.id);
    const colors = win.getComputedStyle(root);
    for (const key of ["surface", "text", "border"])
      tooltip.style.setProperty(
        `--trs-${key}`,
        colors.getPropertyValue(`--trs-${key}`) ||
          colors.getPropertyValue(`--${key === "border" ? "line" : key}`),
      );
    doc.body.append(tooltip);
    tooltip.showPopover?.();
    const rect = button.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(rect.left + (rect.width - box.width) / 2, win.innerWidth - box.width - 8))}px`;
    tooltip.style.top = `${rect.bottom + box.height + 8 < win.innerHeight ? rect.bottom + 6 : rect.top - box.height - 6}px`;
  };
  const options = { signal: signal };
  root.addEventListener("pointerover", show, options);
  root.addEventListener("focusin", show, options);
  root.addEventListener("pointerout", hide, options);
  root.addEventListener("focusout", hide, options);
  root.addEventListener("pointerdown", hide, options);
  root.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") hide();
    },
    options,
  );
  return hide;
}
