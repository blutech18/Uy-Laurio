/**
 * Domain models shared across services, hooks, and UI.
 * These mirror the database schema in `supabase/migrations`.
 */

export type Role = "user" | "admin";

export type StatusKey = "pending" | "progress" | "waiting" | "done";

export type CasePhase =
  | "Submitted"
  | "Under Review"
  | "In Progress"
  | "Requirement Verification"
  | "Final Sign-off / Execution";

export type ServiceModule = "notarization" | "deed" | "ejs";

export type NotificationChannel = "email" | "sms";
export type NotificationStatus = "pending" | "confirmed";

export type AppointmentStatus = "booked" | "cancelled" | "completed";

export type OverrideType = "closed" | "halfday" | "custom";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: Role;
  avatar_initials: string;
  created_at: string;
  updated_at: string;
}

export interface Case {
  id: string;
  reference: string;
  client_id: string;
  module: ServiceModule;
  module_detail: string | null;
  status: StatusKey;
  phase: CasePhase;
  created_at: string;
  updated_at: string;
}

/** A case joined with its client's display fields (admin views). */
export interface CaseWithClient extends Case {
  client: Pick<Profile, "id" | "full_name" | "email" | "phone"> | null;
}

export interface DocumentRecord {
  id: string;
  case_id: string;
  owner_id: string;
  name: string;
  storage_path: string;
  size_bytes: number;
  mime_type: string | null;
  status: StatusKey;
  submitted_at: string;
}

export interface CaseRequirement {
  id: string;
  case_id: string;
  name: string;
  note: string | null;
  urgent: boolean;
  fulfilled: boolean;
  document_id: string | null;
  sort_order: number;
  created_at: string;
}

export interface NotificationRecord {
  id: string;
  case_id: string | null;
  recipient: string;
  channel: NotificationChannel;
  message: string;
  status: NotificationStatus;
  created_by: string | null;
  created_at: string;
}

export interface Appointment {
  id: string;
  client_id: string;
  appointment_date: string; // ISO date (YYYY-MM-DD)
  time_slot: string;
  status: AppointmentStatus;
  created_at: string;
}

export interface ScheduleOverride {
  id: string;
  override_date: string; // ISO date (YYYY-MM-DD)
  type: OverrideType;
  open_time: string | null;
  close_time: string | null;
  created_by: string | null;
  created_at: string;
}
