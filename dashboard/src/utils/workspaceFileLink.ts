/** Resolve only local sandbox references; never turn them into host paths. */
export function sandboxWorkspacePath(href: string): string | null {
  const match = /^sandbox:\/(?!\/)([^?#]+)$/i.exec(href.trim());
  if (!match) return null;
  try {
    const path = decodeURIComponent(match[1]);
    if (
      /[\\:]/.test(path) ||
      [...path].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      return null;
    if (
      path.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      return null;
    }
    return path;
  } catch {
    return null;
  }
}
