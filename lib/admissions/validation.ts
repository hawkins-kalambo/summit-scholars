import { z } from "zod";
export const applicationSchema = z.object({
  applicationId: z.union([z.literal(""), z.string().uuid()]),
  revision: z.coerce.number().int().min(0),
  universityId: z.string().uuid("Choose a university."),
  programmeId: z.string().uuid("Choose a programme."),
  periodId: z.string().uuid("Choose an intake."),
  year: z.coerce.number().int().min(1).max(10),
  phone: z.string().trim().regex(/^[+0-9 ()-]{7,25}$/, "Enter a valid contact phone number."),
  mode: z.enum(["online", "face_to_face"]),
  courseIds: z.array(z.string().uuid()).min(1, "Choose at least one course.").max(12),
});
export const recordId = z.string().uuid();
export type FormResult = { error?: string; success?: string };
export type University = { id: string; name: string; code: string; active: boolean };
export type Programme = University & { university_id: string };
export type Period = { id: string; university_id: string; name: string; registration_opens: string; registration_closes: string; active: boolean };
export type Course = { id: string; university_id: string; name: string; code: string; description: string; level: number; published: boolean };
export type Catalogue = { universities: University[]; programmes: Programme[]; periods: Period[]; courses: Course[] };
export type Application = {
 id: string; applicant_id: string; full_name: string; university_id: string; programme_id: string; period_id: string;
 year_of_study: number; phone: string; learning_mode: "online" | "face_to_face"; status: string; revision: number;
 recommendation: string | null; reviewed_by: string | null; created_at: string; consent_notice: string | null;
};
