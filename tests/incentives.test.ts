import test from "node:test";
import assert from "node:assert/strict";
import {
  incentiveEligibility,
  incentiveStatus,
  incentiveTermsInput,
  money,
} from "../src/lib/incentives";
import { emotionInterview } from "./emotion-fixture";
test("Incentives require completed included native responses and valid minor-unit terms", () => {
  const i = emotionInterview();
  assert.ok(incentiveEligibility(i));
  i.status = "complete";
  assert.equal(incentiveEligibility(i), null);
  assert.equal(incentiveStatus(i), "needs_review");
  i.excluded = true;
  assert.equal(incentiveStatus(i), "ineligible");
  i.excluded = false;
  i.preview = true;
  assert.ok(incentiveEligibility(i));
  const terms = {
    enabled: true,
    amountMinor: 2500,
    currency: "USD",
    description: "Complete and included",
  };
  assert.equal(incentiveTermsInput.safeParse(terms).success, true);
  for (const amountMinor of [0, 1.2, 10000001])
    assert.equal(
      incentiveTermsInput.safeParse({ ...terms, amountMinor }).success,
      false,
    );
  assert.equal(money(2501, "USD"), "$25.01");
});
