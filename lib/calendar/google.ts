import "server-only";
import { google, type calendar_v3 } from "googleapis";

const TIMEZONE = "Africa/Blantyre";

// googleapis throws gaxios errors shaped like { response: { status } }; avoid
// importing the gaxios package directly (it is only a transitive dependency).
function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const response = (error as { response?: { status?: unknown } }).response;
  if (response && typeof response.status === "number") return response.status;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

// Narrow interface (rather than the full googleapis client) so tests can pass
// a fake without constructing a real OAuth2 client or hitting the network.
export type CalendarClient = {
  events: {
    insert: (params: calendar_v3.Params$Resource$Events$Insert) => Promise<{ data: calendar_v3.Schema$Event }>;
    patch: (params: calendar_v3.Params$Resource$Events$Patch) => Promise<{ data: calendar_v3.Schema$Event }>;
    delete: (params: calendar_v3.Params$Resource$Events$Delete) => Promise<unknown>;
  };
};

export type MeetEventInput = {
  topic: string;
  courseName: string;
  tutorName: string;
  sessionId: string;
  startsAt: string;
  endsAt: string;
  notes?: string;
  attendeeEmails?: string[];
};

export type MeetEventResult = { meetingLink: string; eventId: string; htmlLink: string | null };

export function isGoogleCalendarConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

function calendarId() {
  return process.env.GOOGLE_CALENDAR_ID || "primary";
}

function defaultClient(): CalendarClient {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google Calendar is not configured.");
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth });
}

function eventBody(input: MeetEventInput): calendar_v3.Schema$Event {
  return {
    summary: `${input.courseName} · ${input.topic}`,
    description: [
      `Course: ${input.courseName}`,
      `Tutor: ${input.tutorName}`,
      input.notes ? `Notes: ${input.notes}` : null,
      `Summit ScholarsBridge session ID: ${input.sessionId}`,
    ].filter((line): line is string => Boolean(line)).join("\n"),
    start: { dateTime: input.startsAt, timeZone: TIMEZONE },
    end: { dateTime: input.endsAt, timeZone: TIMEZONE },
    attendees: input.attendeeEmails?.map(email => ({ email })),
    guestsCanSeeOtherGuests: false,
    guestsCanInviteOthers: false,
    extendedProperties: { private: { summitSessionId: input.sessionId } },
  };
}

// Log only the HTTP status, never the provider's raw error message: gaxios
// errors can echo back request details, and this must never include tokens,
// attendee lists, or other private event data.
function toCalendarError(error: unknown, fallback: string): Error {
  const status = statusOf(error);
  console.error("Google Calendar API error", { status: status ?? "unknown" });
  if (status === 401) return new Error("Google Calendar authorization has expired. Reconnect the institution Google account.");
  if (status === 403) return new Error("The Google account does not have permission for this calendar.");
  return new Error(fallback);
}

// One institution Google account creates every event; conferenceData.createRequest
// asks Google to attach a Meet link, returned in conferenceData.entryPoints.
export async function createMeetEvent(input: MeetEventInput, client: CalendarClient = defaultClient()): Promise<MeetEventResult> {
  let response;
  try {
    response = await client.events.insert({
      calendarId: calendarId(),
      conferenceDataVersion: 1,
      requestBody: {
        ...eventBody(input),
        conferenceData: { createRequest: { requestId: input.sessionId, conferenceSolutionKey: { type: "hangoutsMeet" } } },
      },
    });
  } catch (error) {
    throw toCalendarError(error, "Could not create the Google Calendar event.");
  }
  const event = response.data;
  const meetingLink = event.conferenceData?.entryPoints?.find(entry => entry.entryPointType === "video")?.uri;
  if (!event.id || !meetingLink) throw new Error("Google Calendar did not return a meeting link.");
  return { meetingLink, eventId: event.id, htmlLink: event.htmlLink ?? null };
}

// Not yet called from any action: there is no "edit a scheduled class" feature
// in the app today. Kept here, tested in isolation, for when that feature exists.
export async function updateMeetEvent(eventId: string, input: MeetEventInput, client: CalendarClient = defaultClient()): Promise<MeetEventResult> {
  let response;
  try {
    response = await client.events.patch({ calendarId: calendarId(), eventId, requestBody: eventBody(input) });
  } catch (error) {
    throw toCalendarError(error, "Could not update the Google Calendar event.");
  }
  const event = response.data;
  const meetingLink = event.conferenceData?.entryPoints?.find(entry => entry.entryPointType === "video")?.uri;
  if (!event.id || !meetingLink) throw new Error("Google Calendar did not return a meeting link.");
  return { meetingLink, eventId: event.id, htmlLink: event.htmlLink ?? null };
}

export async function cancelMeetEvent(eventId: string, client: CalendarClient = defaultClient()): Promise<void> {
  try {
    await client.events.delete({ calendarId: calendarId(), eventId });
  } catch (error) {
    // Already-deleted events are treated as successfully cancelled, not an error.
    const status = statusOf(error);
    if (status === 404 || status === 410) return;
    throw toCalendarError(error, "Could not cancel the Google Calendar event.");
  }
}
