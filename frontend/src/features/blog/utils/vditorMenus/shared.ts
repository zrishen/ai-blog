export function positionFloatingMenu(bodyPanel: HTMLElement, anchor: HTMLElement, spacing = 6) {
  const rect = anchor.getBoundingClientRect();
  bodyPanel.style.display = "block";
  bodyPanel.style.top = `${rect.bottom + spacing}px`;
  bodyPanel.style.left = `${rect.left}px`;

  const menuRect = bodyPanel.getBoundingClientRect();
  const viewportPadding = 8;
  if (menuRect.right > window.innerWidth - viewportPadding) {
    bodyPanel.style.left = `${Math.max(viewportPadding, rect.right - menuRect.width)}px`;
  }
  if (menuRect.bottom > window.innerHeight - viewportPadding) {
    bodyPanel.style.top = `${Math.max(viewportPadding, rect.top - menuRect.height - spacing)}px`;
  }
}
