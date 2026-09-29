/** Third-party content must not share Octop's token-bearing origin. */
export function externalWebsiteTarget(
  value: string,
  dashboardOrigin: string,
): URL | null {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.origin === dashboardOrigin ||
      /[\\\s]/.test(value) ||
      Array.from(value).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      return null;
    return url;
  } catch {
    return null;
  }
}
