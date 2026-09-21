import "server-only";

export type CalendarFetch = typeof fetch;
export type MeetEvent = { meetingLink: string; eventId: string };

export function isGoogleCalendarConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

async function getAccessToken(fetchImpl: CalendarFetch): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google Calendar is not configured.");
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const data = await response.json().catch(() => null) as { access_token?: string } | null;
  if (!response.ok || !data?.access_token) throw new Error("Could not authenticate with Google Calendar.");
  return data.access_token;
}

// One institution Google account creates every event; conferenceData.createRequest
// asks Google to attach a Meet link, returned in conferenceData.entryPoints.
export async function createMeetEvent(
  input: { topic: string; startsAt: string; endsAt: string },
  fetchImpl: CalendarFetch = fetch,
): Promise<MeetEvent> {
  const accessToken = await getAccessToken(fetchImpl);
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
  const response = await fetchImpl(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary: input.topic,
        start: { dateTime: input.startsAt },
        end: { dateTime: input.endsAt },
        conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
      }),
    },
  );
  const data = await response.json().catch(() => null) as { id?: string; conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] } } | null;
  const meetingLink = data?.conferenceData?.entryPoints?.find(entry => entry.entryPointType === "video")?.uri;
  if (!response.ok || !data?.id || !meetingLink) throw new Error("Google Calendar did not return a meeting link.");
  return { meetingLink, eventId: data.id };
}

export async function cancelMeetEvent(eventId: string, fetchImpl: CalendarFetch = fetch): Promise<void> {
  const accessToken = await getAccessToken(fetchImpl);
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
  const response = await fetchImpl(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } },
  );
  // 404/410 means the event is already gone on Google's side; treat cancellation as done.
  if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error("Could not cancel the Google Calendar event.");
}
