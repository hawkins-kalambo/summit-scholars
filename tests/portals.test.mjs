import test from "node:test";
import assert from "node:assert/strict";
import { canEnterPortal, defaultPortal, isPortal } from "../lib/auth/portals.ts";

test("portal access requires the correct assigned role and account status", () => {
  assert.equal(canEnterPortal(["student"], "active", "admin"), false);
  assert.equal(canEnterPortal(["student"], "active", "staff"), false);
  assert.equal(canEnterPortal(["tutor"], "active", "staff"), true);
  assert.equal(canEnterPortal(["tutor"], "active", "admin"), false);
  assert.equal(canEnterPortal(["admissions_officer"], "active", "staff"), true);
  assert.equal(canEnterPortal(["academic_admin"], "active", "admin"), true);
  assert.equal(canEnterPortal(["super_admin"], "suspended", "admin"), false);
  assert.equal(canEnterPortal(["super_admin"], "pending", "admin"), false);
  assert.equal(canEnterPortal(["student"], "pending", "student"), true);
  assert.equal(canEnterPortal(["student"], "suspended", "student"), false);
  assert.equal(canEnterPortal([], "active", "student"), false);
});
test("default landing prioritizes assigned staff responsibilities over the signup student role", () => {
  assert.equal(defaultPortal(["student", "super_admin"], "active"), "admin");
  assert.equal(defaultPortal(["student", "tutor"], "active"), "staff");
  assert.equal(defaultPortal(["student"], "pending"), "student");
  assert.equal(defaultPortal(["super_admin"], "suspended"), null);
  assert.equal(isPortal("https://example.test"), false);
  assert.equal(isPortal(null), false);
});
