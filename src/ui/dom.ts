/**
 * Tiny DOM helper shared by the screens. Everything goes through
 * `textContent` / `setAttribute`, never innerHTML, so strings from
 * program.json or from storage can't inject markup.
 */

/** Creates an element with optional class name and text content. */
export function element<Tag extends keyof HTMLElementTagNameMap>(
  tagName: Tag,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[Tag] {
  const created = document.createElement(tagName);
  if (className) {
    created.className = className;
  }
  if (text !== undefined) {
    created.textContent = text;
  }
  return created;
}
