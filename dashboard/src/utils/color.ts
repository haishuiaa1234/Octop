export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function contrastingTextColor(hexColor: string): "#111827" | "#ffffff" {
  const rgb = hexColor.slice(1).match(/.{2}/g);
  if (!rgb || rgb.length !== 3) return "#111827";

  const channels = rgb.map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];

  return luminance > 0.179 ? "#111827" : "#ffffff";
}
