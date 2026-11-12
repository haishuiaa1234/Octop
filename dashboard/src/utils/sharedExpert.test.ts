import { describe, expect, it } from "vitest";
import { isSharedExpertViewer, ownedExperts } from "./sharedExpert";

describe("targeted expert grants", () => {
  it("keeps an explicit non-owner read-only without a global visibility grant", () => {
    const shared = { is_shared: false, is_owner: false, user_id: 7 };
    expect(isSharedExpertViewer(shared, { id: 12 })).toBe(true);
    expect(ownedExperts([shared])).toEqual([]);
  });

  it("recognizes the owner when a stale is_owner flag disagrees with the user id", () => {
    expect(
      isSharedExpertViewer(
        { is_shared: false, is_owner: false, user_id: 7 },
        { id: 7 },
      ),
    ).toBe(false);
  });
});
