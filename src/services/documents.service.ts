import { DOCUMENTS_BUCKET, supabase } from "@/lib/supabase";
import {
  toUiStatus,
  type DbCaseStatus,
  type DocumentRecord,
  type StatusKey,
} from "@/types/models";

export interface UploadDocumentInput {
  file: File;
  caseId: string;
  ownerId: string;
  /** Links the upload to the checklist item it satisfies. */
  requirementId?: string | null;
}

const MAX_BYTES = 10 * 1024 * 1024; // must match the bucket limit in 0005
const ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
];

function mapDocument<T extends { status: DbCaseStatus }>(row: T): T & {
  status: StatusKey;
  db_status: DbCaseStatus;
} {
  return { ...row, status: toUiStatus(row.status), db_status: row.status };
}

export const documentsService = {
  async listForOwner(ownerId: string): Promise<DocumentRecord[]> {
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .eq("owner_id", ownerId)
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapDocument) as DocumentRecord[];
  },

  async listForCase(caseId: string): Promise<DocumentRecord[]> {
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .eq("case_id", caseId)
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapDocument) as DocumentRecord[];
  },

  /**
   * Uploads the file into the owner's private storage folder, then records the
   * metadata row. Storage RLS requires the first path segment to be the
   * owner's user id. When `requirementId` is provided the database trigger
   * marks that checklist item fulfilled and links the document to it.
   */
  async upload({
    file,
    caseId,
    ownerId,
    requirementId,
  }: UploadDocumentInput): Promise<DocumentRecord> {
    if (file.size > MAX_BYTES) {
      throw new Error("File is larger than the 10 MB limit.");
    }
    if (file.type && !ALLOWED_MIME.includes(file.type)) {
      throw new Error("Only PDF, JPG, PNG, HEIC or WEBP files are accepted.");
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${ownerId}/${caseId}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(storagePath, file, { upsert: false });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from("documents")
      .insert({
        case_id: caseId,
        owner_id: ownerId,
        name: file.name,
        storage_path: storagePath,
        size_bytes: file.size,
        mime_type: file.type || null,
        requirement_id: requirementId ?? null,
      })
      .select("*")
      .single();

    if (error) {
      // Do not leave an orphaned object behind if the metadata insert fails.
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
      throw error;
    }
    return mapDocument(data) as DocumentRecord;
  },

  /** Time-limited signed URL for viewing a private document. */
  async getSignedUrl(storagePath: string, expiresInSeconds = 300): Promise<string> {
    const { data, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(storagePath, expiresInSeconds);
    if (error) throw error;
    return data.signedUrl;
  },

  async updateStatus(documentId: string, status: StatusKey | DbCaseStatus): Promise<void> {
    const { error } = await supabase
      .from("documents")
      .update({ status })
      .eq("id", documentId);
    if (error) throw error;
  },

  /** Staff accepts a submitted document. */
  async verify(documentId: string): Promise<void> {
    const { error } = await supabase
      .from("documents")
      .update({ status: "done", rejection_reason: null })
      .eq("id", documentId);
    if (error) throw error;
  },

  /** Staff rejects a document; the client is notified with the reason. */
  async reject(documentId: string, reason: string): Promise<void> {
    const { error } = await supabase
      .from("documents")
      .update({ status: "waiting", rejection_reason: reason })
      .eq("id", documentId);
    if (error) throw error;
  },
};
