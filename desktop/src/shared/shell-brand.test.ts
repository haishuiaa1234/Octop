import assert from "node:assert/strict";
import test from "node:test";
import { normalizeShellBrand, shellBrandName } from "./shell-brand";

test("uses the configured brand and defaults unknown values to the workbench", () => {
  assert.equal(shellBrandName(normalizeShellBrand("dinfectome")), "Dinfectome");
  assert.equal(shellBrandName(normalizeShellBrand(undefined)), "智能工作台");
  assert.equal(normalizeShellBrand("unsupported"), "default");
});
