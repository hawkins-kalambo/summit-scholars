import { AlertTriangle } from "lucide-react";
import { requireAcademicManager } from "@/lib/admissions/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
type RiskRow = { student_id: string; full_name: string; course_id: string; course_name: string; attended_count: number; total_count: number; attendance_rate: number };
const thresholds = [50, 60, 65, 70, 75, 80, 90];

export default async function AttendanceRiskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAcademicManager();
  const params = await searchParams;
  const threshold = thresholds.includes(Number(params.threshold)) ? Number(params.threshold) : 75;
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("attendance_risk_report", { p_threshold: threshold });
  if (error) throw new Error("Unable to load the attendance risk report. Apply the attendance risk migration first.");
  const rows = (data ?? []) as RiskRow[];
  return <div className="dash">
    <div className="dash-title"><div><span className="eyebrow">Academics</span><h1>Attendance risk</h1><p>Students below the attendance threshold across completed classes. Generated on request — not a scheduled alert.</p></div></div>
    <form className="admin-search"><label>Threshold<select name="threshold" defaultValue={threshold}>{thresholds.map(value => <option key={value} value={value}>{value}%</option>)}</select></label><button className="btn teal">Update</button></form>
    {!rows.length ? <p>No students are below {threshold}% attendance right now.</p> : <div className="panel"><header><h2>{rows.length} at risk</h2></header>
      <div className="rows">{rows.map((row, index) => <div key={index}><span><AlertTriangle size={16}/> {row.full_name}</span><span>{row.course_name}</span><span>{row.attended_count}/{row.total_count} sessions</span><span>{row.attendance_rate}%</span></div>)}</div>
    </div>}
  </div>;
}
