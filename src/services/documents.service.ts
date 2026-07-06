import { DOCUMENTS_BUCKET, supabase } from "@/lib/supabase";
import type { DocumentRecord, StatusKey } from "@/types/models";

export interface UploadDocumentInput {
  file: File;
  caseId: string;
  ownerId: string;
}

export const documentsService = {
  async listForOwner(ownerId: string): Promise<DocumentRecord[]> {
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .eq("owner_id", ownerId)
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async listForCase(caseId: string): Promise<DocumentRecord[]> {
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .eq("case_id", caseId)
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  /**
   * Uploads the file into the owner's private storage folder, then records the
   * metadata row. Storage RLS requires the first path segment to be the
   * owner's user id.
   */
  async upload({ file, caseId, ownerId }: UploadDocumentInput): Promise<DocumentRecord> {
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
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  /** Time-limited signed URL for viewing a private document. */
  async getSignedUrl(storagePath: string, expiresInSeconds = 300): Promise<string> {
    const { data, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(storagePath, expiresInSeconds);
    if (error) throw error;
    return data.signedUrl;
  },

  async updateStatus(documentId: string, status: StatusKey): Promise<void> {
    const { error } = await supabase
      .from("documents")
      .update({ status })
      .eq("id", documentId);
    if (error) throw error;
  },
};
