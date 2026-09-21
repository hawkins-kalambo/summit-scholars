import test from "node:test";
import assert from "node:assert/strict";
import { isGoogleCalendarConfigured, createMeetEvent, cancelMeetEvent } from "../lib/calendar/google.ts";

function fakeFetch(overrides = {}) {
  return async (url, init = {}) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com/token")) {
      if (overrides.token) return overrides.token;
      return { ok: true, status: 200, json: async () => ({ access_token: "test-access-token" }) };
    }
    if (target.includes("/events?conferenceDataVersion=1")) {
      if (overrides.create) return overrides.create;
      return {
        ok: true, status: 200,
        json: async () => ({ id: "evt-1", conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }] } }),
      };
    }
    if (init.method === "DELETE") {
      if (overrides.delete) return overrides.delete;
      return { ok: true, status: 200, json: async () => ({}) };
    }
    throw new Error("Unexpected fetch call in test: " + target);
  };
}

test("Google Calendar adapter is inert until configured, then creates and cancels Meet events", async () => {
  const originalId = process.env.GOOGLE_CLIENT_ID;
  const originalSecret = process.env.GOOGLE_CLIENT_SECRET;
  const originalToken = process.env.GOOGLE_REFRESH_TOKEN;
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.GOOGLE_REFRESH_TOKEN;
  try {
    assert.equal(isGoogleCalendarConfigured(), false);
    await assert.rejects(createMeetEvent({ topic: "Test", startsAt: "2030-01-01T10:00:00Z", endsAt: "2030-01-01T11:00:00Z" }, fakeFetch()), /not configured/);

    process.env.GOOGLE_CLIENT_ID = "test-client"; process.env.GOOGLE_CLIENT_SECRET = "test-secret"; process.env.GOOGLE_REFRESH_TOKEN = "test-refresh";
    assert.equal(isGoogleCalendarConfigured(), true);

    const event = await createMeetEvent({ topic: "Precalculus", startsAt: "2030-01-01T10:00:00Z", endsAt: "2030-01-01T11:00:00Z" }, fakeFetch());
    assert.deepEqual(event, { meetingLink: "https://meet.google.com/abc-defg-hij", eventId: "evt-1" });

    await assert.rejects(
      createMeetEvent({ topic: "No link", startsAt: "2030-01-01T10:00:00Z", endsAt: "2030-01-01T11:00:00Z" },
        fakeFetch({ create: { ok: true, status: 200, json: async () => ({ id: "evt-2", conferenceData: { entryPoints: [] } }) } })),
      /did not return a meeting link/,
    );

    await cancelMeetEvent("evt-1", fakeFetch());
    // Already-deleted events are treated as successfully cancelled, not an error.
    await cancelMeetEvent("evt-1", fakeFetch({ delete: { ok: false, status: 404, json: async () => ({}) } }));
    await assert.rejects(cancelMeetEvent("evt-1", fakeFetch({ delete: { ok: false, status: 500, json: async () => ({}) } })), /Could not cancel/);
  } finally {
    if (originalId === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = originalId;
    if (originalSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = originalSecret;
    if (originalToken === undefined) delete process.env.GOOGLE_REFRESH_TOKEN; else process.env.GOOGLE_REFRESH_TOKEN = originalToken;
  }
});
