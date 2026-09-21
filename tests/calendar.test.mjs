import test from "node:test";
import assert from "node:assert/strict";
import { isGoogleCalendarConfigured, createMeetEvent, updateMeetEvent, cancelMeetEvent } from "../lib/calendar/google.ts";

const baseInput = {
  topic: "Precalculus", courseName: "SSB-PRECALC", tutorName: "Test Tutor", sessionId: "session-1",
  startsAt: "2030-01-01T10:00:00Z", endsAt: "2030-01-01T11:00:00Z",
};

function fakeClient(overrides = {}) {
  const calls = { insert: [], patch: [], delete: [] };
  const event = { id: "evt-1", htmlLink: "https://calendar.google.com/event?eid=evt-1", conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }] } };
  return {
    calls,
    events: {
      insert: async params => { calls.insert.push(params); if (overrides.insertError) throw overrides.insertError; return { data: overrides.insertData ?? event }; },
      patch: async params => { calls.patch.push(params); if (overrides.patchError) throw overrides.patchError; return { data: overrides.patchData ?? event }; },
      delete: async params => { calls.delete.push(params); if (overrides.deleteError) throw overrides.deleteError; return {}; },
    },
  };
}

test("Google Calendar adapter is inert until configured", async () => {
  const originalId = process.env.GOOGLE_CLIENT_ID;
  const originalSecret = process.env.GOOGLE_CLIENT_SECRET;
  const originalToken = process.env.GOOGLE_REFRESH_TOKEN;
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.GOOGLE_REFRESH_TOKEN;
  try {
    assert.equal(isGoogleCalendarConfigured(), false);
    await assert.rejects(createMeetEvent(baseInput), /not configured/);
  } finally {
    if (originalId === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = originalId;
    if (originalSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = originalSecret;
    if (originalToken === undefined) delete process.env.GOOGLE_REFRESH_TOKEN; else process.env.GOOGLE_REFRESH_TOKEN = originalToken;
    assert.equal(isGoogleCalendarConfigured(), Boolean(originalId && originalSecret && originalToken));
  }
});

test("createMeetEvent builds a rich, timezoned event with a stable requestId and returns the Meet link", async () => {
  const client = fakeClient();
  const result = await createMeetEvent({ ...baseInput, notes: "Bring a calculator", attendeeEmails: ["student@example.test"] }, client);
  assert.deepEqual(result, { meetingLink: "https://meet.google.com/abc-defg-hij", eventId: "evt-1", htmlLink: "https://calendar.google.com/event?eid=evt-1" });
  assert.equal(client.calls.insert.length, 1);
  const [call] = client.calls.insert;
  assert.equal(call.conferenceDataVersion, 1);
  assert.equal(call.requestBody.start.timeZone, "Africa/Blantyre");
  assert.equal(call.requestBody.end.timeZone, "Africa/Blantyre");
  assert.equal(call.requestBody.conferenceData.createRequest.requestId, "session-1");
  assert.deepEqual(call.requestBody.attendees, [{ email: "student@example.test" }]);
  assert.equal(call.requestBody.guestsCanSeeOtherGuests, false);
  assert.match(call.requestBody.description, /Course: SSB-PRECALC/);
  assert.match(call.requestBody.description, /Tutor: Test Tutor/);
  assert.match(call.requestBody.description, /Notes: Bring a calculator/);
  assert.match(call.requestBody.description, /session-1/);
});

test("createMeetEvent rejects when Google does not return a Meet link", async () => {
  const client = fakeClient({ insertData: { id: "evt-2", conferenceData: { entryPoints: [] } } });
  await assert.rejects(createMeetEvent(baseInput, client), /did not return a meeting link/);
});

test("createMeetEvent maps Google API failures to safe, non-leaking errors", async () => {
  const authError = Object.assign(new Error("invalid_grant: token expired and secret abc123"), { response: { status: 401 } });
  await assert.rejects(createMeetEvent(baseInput, fakeClient({ insertError: authError })), /authorization has expired/);
  const permissionError = Object.assign(new Error("insufficient permission"), { response: { status: 403 } });
  await assert.rejects(createMeetEvent(baseInput, fakeClient({ insertError: permissionError })), /does not have permission/);
  const genericError = Object.assign(new Error("secret internal payload"), { response: { status: 500 } });
  await assert.rejects(createMeetEvent(baseInput, fakeClient({ insertError: genericError })), /Could not create the Google Calendar event/);
});

test("updateMeetEvent patches the existing event instead of creating a new one", async () => {
  const client = fakeClient();
  const result = await updateMeetEvent("evt-1", { ...baseInput, topic: "Precalculus (rescheduled)" }, client);
  assert.equal(client.calls.patch.length, 1);
  assert.equal(client.calls.patch[0].eventId, "evt-1");
  assert.equal(client.calls.insert.length, 0);
  assert.equal(result.eventId, "evt-1");
});

test("cancelMeetEvent treats an already-deleted event as success but surfaces other failures", async () => {
  const client = fakeClient();
  await cancelMeetEvent("evt-1", client);
  assert.equal(client.calls.delete.length, 1);

  const alreadyGone = Object.assign(new Error("not found"), { response: { status: 404 } });
  await cancelMeetEvent("evt-1", fakeClient({ deleteError: alreadyGone }));

  const serverError = Object.assign(new Error("secret internal payload"), { response: { status: 500 } });
  await assert.rejects(cancelMeetEvent("evt-1", fakeClient({ deleteError: serverError })), /Could not cancel the Google Calendar event/);
});
