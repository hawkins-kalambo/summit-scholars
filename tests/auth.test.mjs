import test from "node:test";
import assert from "node:assert/strict";
import { isRole, canEnterWorkspace } from "../lib/auth/roles.ts";
import { registrationSchema } from "../lib/auth/validation.ts";
import { sendTransactionalEmail } from "../lib/email/resend.ts";

test("students and staff cannot acquire unrelated workspaces", () => {
  assert.equal(canEnterWorkspace(["student"], "finance_officer"), false);
  assert.equal(canEnterWorkspace(["system_admin"], "academic_admin"), false);
  assert.equal(canEnterWorkspace(["tutor"], "tutor"), true);
  assert.equal(canEnterWorkspace(["super_admin"], "academic_admin"), true);
  assert.equal(isRole("admin"), false);
  assert.equal(isRole("finance_administrator"), false);
});

test("registration validates inputs and discards client-supplied privileges", () => {
  const parsed = registrationSchema.parse({
    email: "student@example.test", password: "a long password here", fullName: " Test Student ",
    role: "super_admin", account_status: "active",
  });
  assert.equal(parsed.fullName, "Test Student");
  assert.equal("role" in parsed, false);
  assert.equal("account_status" in parsed, false);
  assert.equal(registrationSchema.safeParse({ ...parsed, password: "short" }).success, false);
  assert.equal(registrationSchema.safeParse({ ...parsed, email: "invalid" }).success, false);
});

test("Resend adapter preserves retry keys and sanitizes failures without sending mail", async () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM_EMAIL;
  process.env.RESEND_API_KEY = "test-only";
  process.env.RESEND_FROM_EMAIL = "portal@example.test";
  const message = { to: "student@example.test", subject: "Application received", text: "Test notification", idempotencyKey: "application/test-123/submitted" };
  try {
    const calls = [];
    const fake = async (payload, options) => {
      calls.push({ payload, options });
      return { data: { id: "test-email" }, error: null };
    };
    assert.deepEqual(await sendTransactionalEmail(message, fake), { id: "test-email" });
    await sendTransactionalEmail(message, fake);
    assert.equal(calls[0].options.idempotencyKey, calls[1].options.idempotencyKey);
    await assert.rejects(sendTransactionalEmail(message, async () => { throw new Error("secret provider data"); }), /Email delivery failed/);
    await assert.rejects(sendTransactionalEmail({ ...message, to: "invalid" }, fake));
    assert.equal(calls.length, 2);
    delete process.env.RESEND_API_KEY;
    await assert.rejects(sendTransactionalEmail(message, fake), /not configured/);
  } finally {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = originalFrom;
  }
});
