/**
 * Domain models shared across services, hooks, and UI.
 * These mirror the database schema in `supabase/migrations`.
 */

export type Role = "user" | "admin";

/**
 * Presentation status keys the UI renders (see `statusConfig` in App.tsx).
 * Kept deliberately narrow so the delivered UI stays untouched.
 */
export type StatusKey = "pending" | "progress" | "waiting" | "done";

/**
 * The full status vocabulary stored in Postgres (`case_status`), matching the
 * client requirement: Pending, Under Review, In Progress, Waiting for
 * Requirements, Completed, Cancelled.
 */
export type DbCaseStatus =
  | "pending"
  | "review"
  | "progress"
  | "waiting"
  | "done"
  | "cancelled";

/** Maps a database status onto the four presentation keys the UI knows. */
export function toUiStatus(status: DbCaseStatus | StatusKey): StatusKey {
  switch (status) {
    case "review":
      return "pending";
    case "cancelled":
      return "waiting";
    case "pending":
    case "progress":
    case "waiting":
    case "done":
      return status;
    default:
      return "pending";
  }
}

/** Full-text label for a database status, used in reports and exports. */
export const DB_STATUS_LABEL: Record<DbCaseStatus, string> = {
  pending: "Pending",
  review: "Under Review",
  progress: "In Progress",
  waiting: "Waiting for Requirements",
  done: "Completed",
  cancelled: "Cancelled",
};

export type CasePhase =
  | "Submitted"
  | "Under Review"
  | "In Progress"
  | "Requirement Verification"
  | "Final Sign-off / Execution";

export type ServiceModule = "notarization" | "deed" | "ejs";

export type NotificationChannel = "email" | "sms";
export type NotificationStatus = "pending" | "confirmed";
export type DeliveryStatus = "queued" | "sending" | "sent" | "failed" | "skipped";

export type NotificationKind =
  | "manual"
  | "case_created"
  | "status_update"
  | "phase_update"
  | "requirement_request"
  | "document_verified"
  | "document_rejected"
  | "case_completed"
  | "case_cancelled"
  | "appointment_reminder"
  | "appointment_booked"
  | "announcement";

export type AppointmentStatus = "booked" | "cancelled" | "completed";

export type OverrideType = "closed" | "halfday" | "custom";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: Role;
  avatar_initials: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Case {
  id: string;
  reference: string;
  client_id: string;
  module: ServiceModule;
  module_detail: string | null;
  /** Presentation status (mapped). Use `db_status` for the real DB value. */
  status: StatusKey;
  db_status: DbCaseStatus;
  phase: CasePhase;
  assigned_to: string | null;
  assigned_at: string | null;
  cancelled_reason: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A case joined with its client's display fields (admin views). */
export interface CaseWithClient extends Case {
  client: Pick<Profile, "id" | "full_name" | "email" | "phone"> | null;
  assignee_name?: string | null;
  open_requirements?: number;
}

export interface DocumentRecord {
  id: string;
  case_id: string;
  owner_id: string;
  name: string;
  storage_path: string;
  size_bytes: number;
  mime_type: string | null;
  /** Presentation status (mapped). */
  status: StatusKey;
  db_status: DbCaseStatus;
  requirement_id: string | null;
  verified_by: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
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
  verified_by: string | null;
  verified_at: string | null;
  sort_order: number;
  created_at: string;
}

export interface RequirementTemplate {
  id: string;
  module: ServiceModule | null;
  name: string;
  note: string | null;
  urgent: boolean;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationRecord {
  id: string;
  case_id: string | null;
  recipient: string;
  recipient_id: string | null;
  channel: NotificationChannel;
  message: string;
  /** Legacy delivery flag kept for the UI ("confirmed" = delivered). */
  status: NotificationStatus;
  kind: NotificationKind;
  delivery_status: DeliveryStatus;
  attempts: number;
  sent_at: string | null;
  provider_message_id: string | null;
  error: string | null;
  read_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Appointment {
  id: string;
  client_id: string;
  case_id: string | null;
  appointment_date: string; // ISO date (YYYY-MM-DD)
  time_slot: string;
  status: AppointmentStatus;
  purpose: string | null;
  cancelled_reason: string | null;
  reminder_sent_at: string | null;
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

export interface OfficeHours {
  day_of_week: number; // 0 = Sunday
  is_open: boolean;
  open_time: string;
  close_time: string;
  updated_at: string;
}

export interface OfficeTimeSlot {
  id: string;
  slot_label: string;
  ordinal: number;
  halfday: boolean;
  active: boolean;
  created_at: string;
}

export interface CaseTimelineEntry {
  created_at: string;
  from_status: DbCaseStatus | null;
  to_status: DbCaseStatus;
  from_phase: CasePhase | null;
  to_phase: CasePhase;
  note: string | null;
  changed_by_name: string | null;
}

export interface ClientSummary {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: Role;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  case_count: number;
  open_cases: number;
  last_activity: string | null;
}

export interface DashboardStats {
  total_open: number;
  pending_verification: number;
  missing_requirements: number;
  daily_completed: number;
  cancelled: number;
  unverified_documents: number;
  upcoming_appointments: number;
  clients_total: number;
  notifications_queued: number;
}

export interface ActivityEntry {
  created_at: string;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
}

export interface ServiceSummaryRow {
  module: ServiceModule;
  status: DbCaseStatus;
  case_count: number;
  avg_days_to_complete: number | null;
}

export interface TransactionLogRow {
  reference: string;
  client_name: string | null;
  client_email: string | null;
  module: ServiceModule;
  module_detail: string | null;
  status: DbCaseStatus;
  phase: CasePhase;
  assignee_name: string | null;
  documents: number;
  requirements_open: number;
  filed_at: string;
  completed_at: string | null;
}

export interface NotificationLogRow {
  created_at: string;
  channel: NotificationChannel;
  recipient: string;
  kind: NotificationKind;
  delivery_status: DeliveryStatus;
  attempts: number;
  sent_at: string | null;
  case_reference: string | null;
  message: string;
  error: string | null;
}
