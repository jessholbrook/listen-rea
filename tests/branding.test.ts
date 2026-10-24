import test from "node:test";
import assert from "node:assert/strict";
import {
  brandingInput,
  brandingSettingsInput,
  brandingSnapshot,
  brandingStyle,
  contrast,
  defaultBranding,
} from "../src/lib/branding";
test("Branding validates bounded fields, six-digit colors and readable text; disabled snapshots omit logo data", () => {
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(contrast("#ffffff", "#000000"), 21);
  assert.equal(contrast("#123456", "#123456"), 1);
  assert.ok(brandingInput.safeParse(defaultBranding).success);
  for (const patch of [
    { text: "#f7f8f2" },
    { accent: "red" },
    { background: "url(x)" },
    { name: "x".repeat(81) },
    { logoDataUrl: "data:image/png;base64,eA==", logoAlt: "" },
    { unknown: true },
  ])
    assert.equal(
      brandingInput.safeParse({ ...defaultBranding, ...patch }).success,
      false,
    );
  assert.equal(brandingSettingsInput.safeParse(null).success, false);
  const snapshot = brandingSnapshot({
    ...defaultBranding,
    id: "s",
    studyId: "s",
    workspaceId: "private",
    version: 3,
    updatedBy: "owner",
    logoDataUrl: "private-image",
    logoAlt: "Logo",
  });
  assert.equal(snapshot.logoDataUrl, null);
  assert.equal(snapshot.logoAlt, "");
  assert.equal("workspaceId" in snapshot, false);
  assert.equal("updatedBy" in snapshot, false);
});
test("Participant styles choose readable button text and highlights for light and dark palettes; neutral branding has no overrides", () => {
  assert.equal(brandingStyle(defaultBranding), undefined);
  for (const accent of [
    "#000000",
    "#ffffff",
    "#ffcc00",
    "#ff0000",
    "#385a40",
    "#777777",
  ])
    for (const background of ["#ffffff", "#000000"]) {
      const b = {
          ...defaultBranding,
          enabled: true,
          accent,
          background,
          text: background === "#ffffff" ? "#000000" : "#ffffff",
        },
        style = brandingStyle(b)!;
      assert.ok(contrast(accent, style["--brand-button-text"]) >= 4.5);
      assert.ok(contrast(background, style["--brand-highlight"]) >= 4.5);
    }
});
