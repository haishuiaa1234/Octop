import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../../locales/zh.json";
import Brand from ".";

const branding = vi.hoisted(() => ({ brand: "default" }));
vi.mock("../../hooks/useServerBrand", () => ({
  useServerBrand: () => branding.brand,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const app = zh.app as Record<string, string>;
      return app[key.replace("app.", "")] ?? key;
    },
  }),
}));

describe("Brand", () => {
  beforeEach(() => {
    branding.brand = "default";
  });

  it.each(["navigation", "auth", "compact"] as const)(
    "uses the supplied artwork for dinfectome in %s",
    (variant) => {
      branding.brand = "dinfectome";
      render(<Brand variant={variant} />);
      expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        "/dinfectome-logo.webp",
      );
      expect(screen.getByRole("img")).toHaveAttribute("alt", "智能工作台");
    },
  );

  it("shows the corporate logo and product name in navigation", () => {
    render(<Brand />);
    expect(screen.getByText("智能工作台")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "世和基因" })).toHaveAttribute(
      "src",
      "/geneseeq-logo.png",
    );
  });

  it("uses the same official artwork for authentication pages", () => {
    render(<Brand variant="auth" />);
    expect(screen.getByText("智能工作台")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "世和基因" })).toHaveAttribute(
      "src",
      "/geneseeq-logo.png",
    );
  });

  it("uses the corporate icon without overflowing collapsed navigation", () => {
    render(<Brand variant="compact" />);
    expect(screen.queryByText("智能工作台")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "智能工作台" })).toHaveAttribute(
      "src",
      "/geneseeq-icon-192.png",
    );
  });
});
