"use client";
import { useState } from "react";
import type { Application, Catalogue } from "@/lib/admissions/validation";
import { ManagedForm } from "./managed-form";
import { saveApplication } from "@/app/portal/applications/actions";

export function ApplicationForm({ catalogue, application, selectedCourses = [] }: { catalogue: Catalogue; application?: Application; selectedCourses?: string[] }) {
  const [university, setUniversity] = useState(application?.university_id ?? "");
  const programmes = catalogue.programmes.filter(row => row.active && row.university_id === university);
  const periods = catalogue.periods.filter(row => row.active && row.university_id === university);
  const courses = catalogue.courses.filter(row => row.published && row.university_id === university);
  return <ManagedForm action={saveApplication} label="Save draft and continue">
    <input type="hidden" name="applicationId" value={application?.id ?? ""} />
    <input type="hidden" name="revision" value={application?.revision ?? 0} />
    <label>University<select name="universityId" value={university} onChange={event => setUniversity(event.target.value)} required>
      <option value="">Choose a university</option>{catalogue.universities.filter(row => row.active).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select></label>
    <label>Programme<select key={"programme-" + university} name="programmeId" defaultValue={application?.university_id === university ? application.programme_id : ""} required>
      <option value="">Choose a programme</option>{programmes.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select></label>
    <label>Intake<select key={"period-" + university} name="periodId" defaultValue={application?.university_id === university ? application.period_id : ""} required>
      <option value="">Choose an intake</option>{periods.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select></label>
    <label>Year of study<input name="year" type="number" min={1} max={10} defaultValue={application?.year_of_study ?? 1} required /></label>
    <label>Contact phone<input name="phone" type="tel" autoComplete="tel" maxLength={25} defaultValue={application?.phone ?? ""} required /></label>
    <label>Learning mode<select name="mode" defaultValue={application?.learning_mode ?? "online"}><option value="online">Online</option><option value="face_to_face">Face-to-face</option></select></label>
    <div><h3>Requested courses</h3>{courses.length === 0 && <p>No published courses are available for this university.</p>}
      {courses.map(course => <label className="check-label" key={course.id}><input type="checkbox" name="courseIds" value={course.id} defaultChecked={selectedCourses.includes(course.id)} />{course.name}</label>)}
    </div>
    <p>Your name is taken from your account. Saving a draft does not submit it for review.</p>
  </ManagedForm>;
}
