import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { advancedSetup } from "./advanced-methods-fixture";
import { emotionInterview } from "./emotion-fixture";
import { base, client } from "./harness";
import {
  TremendousProviderError,
  type TremendousTransport,
} from "../src/lib/tremendous-provider";
export async function tremendousSetup(
  existing?: Omit<Awaited<ReturnType<typeof advancedSetup>>, "ask">,
) {
  const c = existing || (await advancedSetup()),
    study = await c.create(
      emotionInterview().guide,
      "Synthetic sandbox incentives",
    ),
    person = await client();
  await c.owner(`studies/${study.id}/fielding`, "POST", { state: "active" });
  const invites = await c.owner(`studies/${study.id}/invitations`, "POST", {
    requestId: randomUUID(),
    secret: randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    recipients: [{ reference: "Synthetic sandbox invitee" }],
  });
  assert.equal(invites.status, 201);
  const inviteToken = invites.links[0].path.split("#invite=")[1],
    joined = await person(`public/${study.id}`, "POST", {
      consent: true,
      invitationToken: inviteToken,
    });
  assert.equal(joined.status, 201);
  const source = joined.interview.id,
    token = joined.token;
  assert.equal(
    (
      await person(
        `interviews/${source}/answer`,
        "POST",
        {
          requestId: randomUUID(),
          version: 0,
          value: ["happy", "", ""],
          answer: "",
        },
        { "x-interview-token": token },
      )
    ).status,
    200,
  );
  const incentives = `studies/${study.id}/incentives`;
  assert.equal(
    (
      await c.owner(incentives, "PUT", {
        version: 0,
        enabled: true,
        amountMinor: 2500,
        currency: "USD",
        description: "Synthetic completion incentive",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await c.owner(incentives + "/" + source, "POST", {
        requestId: randomUUID(),
        version: 0,
        termsVersion: 1,
        action: "approve",
        reason: "Reviewed synthetic completion",
      })
    ).status,
    200,
  );
  const { dispatchTremendous } = await import("../src/lib/tremendous-server");
  const calls: { path: string; method: string; data?: any }[] = [],
    orders = new Map<string, any>();
  let enabled = true,
    organization = "ORG123456789",
    bindingHash = "marked-sandbox-binding",
    failure: number | "lost" | undefined,
    status = "EXECUTED",
    hook: (() => Promise<void>) | undefined;
  const provider: TremendousTransport = {
    binding: (workspaceId) =>
      enabled && workspaceId === c.actor.workspaceId
        ? { hash: bindingHash, organizationId: "ORG123456789" }
        : null,
    async request(_workspaceId, path, method = "GET", data?: any) {
      calls.push({ path, method, data: structuredClone(data) });
      if (path === "organizations")
        return { organizations: [{ id: organization }] };
      if (path.startsWith("products/"))
        return {
          product: {
            id: path.split("/")[1],
            category: "merchant_card",
            currency_codes: ["USD"],
            countries: [{ abbr: "US" }],
            skus: [{ min: 1, max: 100, currency_code: "USD" }],
          },
        };
      if (path === "orders" && method === "POST") {
        if (typeof failure === "number")
          throw new TremendousProviderError(failure);
        const existing = orders.get(data.external_id);
        const result = existing || {
          order: {
            id: "ORDER1234567",
            external_id: data.external_id,
            status,
            payment: {
              total: data.reward.value.denomination,
              currency_code: "USD",
            },
            rewards: [
              {
                id: "REWARD123456",
                order_id: "ORDER1234567",
                value: data.reward.value,
                recipient: { email: "do-not-store@example.test" },
                delivery: {
                  method: "LINK",
                  status: "SUCCEEDED",
                  link: "https://testflight.tremendous.com/rewards/payout/initial-secret",
                },
              },
            ],
          },
        };
        orders.set(data.external_id, result);
        if (hook) {
          const fn = hook;
          hook = undefined;
          await fn();
        }
        if (failure === "lost") throw Error("Marked lost response");
        return structuredClone(result);
      }
      if (path.startsWith("orders/")) {
        const result = orders.get(path.split("/")[1]);
        if (!result) throw new TremendousProviderError(404);
        const value = structuredClone(result);
        if (hook) {
          const fn = hook;
          hook = undefined;
          await fn();
        }
        return value;
      }
      if (/^rewards\/.*\/generate_link$/.test(path))
        return {
          reward: {
            id: path.split("/")[1],
            link: "https://testflight.tremendous.com/rewards/payout/marked-claim-secret",
          },
        };
      throw Error("Unexpected marked sandbox request");
    },
  };
  const root = `studies/${study.id}/tremendous`;
  async function ask(action = "", method = "GET", data?: unknown) {
    const path = root + (action ? "/" + action : "");
    return dispatchTremendous(
      new Request(base + "/api/" + path, {
        method,
        headers: { "content-type": "application/json" },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }),
      path.split("/"),
      provider,
      c.actor,
    );
  }
  async function claim(method = "GET", data?: unknown, suppliedToken = token) {
    const path = `interviews/${source}/sandbox-reward`;
    return dispatchTremendous(
      new Request(base + "/api/" + path, {
        method,
        headers: {
          "content-type": "application/json",
          "x-interview-token": suppliedToken,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }),
      path.split("/"),
      provider,
    );
  }
  const plan = {
    productId: "OKMHM2X2OHYV",
    maxValueMinor: 10000,
    note: "Reviewed synthetic US merchant gift-card sandbox plan.",
  };
  await ask("", "PUT", { version: 0, plan, reviewed: true });
  const input = {
    interviewId: source,
    incentiveVersion: 1,
    planVersion: 1,
    reviewed: true,
  };
  const view = async () => await (await ask())!.json();
  return {
    ...c,
    study,
    source,
    token,
    inviteToken,
    invitePath: invites.links[0].path,
    person,
    root,
    ask,
    claim,
    input,
    plan,
    view,
    calls,
    orders,
    provider,
    setEnabled(v: boolean) {
      enabled = v;
    },
    setFailure(v: typeof failure) {
      failure = v;
    },
    setStatus(v: string) {
      status = v;
    },
    setOrganization(v: string) {
      organization = v;
    },
    setBinding(v: string) {
      bindingHash = v;
    },
    setHook(v: () => Promise<void>) {
      hook = v;
    },
  };
}
