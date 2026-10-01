import { useCallback, useEffect, useId, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { subscribeToTables } from "@/lib/realtime";
import { casesService } from "@/services/cases.service";
import { documentsService } from "@/services/documents.service";
import { requirementsService } from "@/services/requirements.service";
import type {
  Case,
  CaseRequirement,
  CaseTimelineEntry,
  DocumentRecord,
} from "@/types/models";

interface ClientPortalState {
  cases: Case[];
  activeCase: Case | null;
  documents: DocumentRecord[];
  /** Checklist items across all of the client's open cases. */
  requirements: CaseRequirement[];
  timeline: CaseTimelineEntry[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  toggleRequirement: (id: string, fulfilled: boolean) => Promise<void>;
  cancelCase: (id: string, reason: string) => Promise<void>;
}

/**
 * Loads everything the client portal needs for the signed-in user: their
 * cases, uploaded documents, the checklist and status timeline for the most
 * recent case. Realtime keeps progress tracking live without a page reload.
 */
export function useClientPortal(): ClientPortalState {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const channelId = useId();

  const [cases, setCases] = useState<Case[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [requirements, setRequirements] = useState<CaseRequirement[]>([]);
  const [timeline, setTimeline] = useState<CaseTimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const [caseList, docs] = await Promise.all([
        casesService.listForClient(userId),
        documentsService.listForOwner(userId),
      ]);
      setCases(caseList);
      setDocuments(docs);

      // Pending documents span every open request, not only the newest one,
      // so two cases under review never collapse into a single pending list.
      const open = caseList.filter(
        (c) => !["done", "cancelled"].includes(String(c.db_status ?? c.status)),
      );
      const active = caseList[0] ?? null;
      if (active) {
        const [reqLists, history] = await Promise.all([
          Promise.all(open.map((c) => requirementsService.listForCase(c.id))),
          casesService.timeline(active.id),
        ]);
        setRequirements(reqLists.flat());
        setTimeline(history);
      } else {
        setRequirements([]);
        setTimeline([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load your portal data.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    return subscribeToTables(
      `client-portal:${channelId}`,
      ["cases", "documents", "case_requirements"],
      () => {
        void load();
      },
    );
  }, [userId, channelId, load]);

  const toggleRequirement = useCallback(
    async (id: string, fulfilled: boolean) => {
      setRequirements((prev) =>
        prev.map((r) => (r.id === id ? { ...r, fulfilled } : r)),
      );
      try {
        await requirementsService.setFulfilled(id, fulfilled);
      } catch (e) {
        // The database rejects ticking an item that has no document attached.
        setRequirements((prev) =>
          prev.map((r) => (r.id === id ? { ...r, fulfilled: !fulfilled } : r)),
        );
        setError(
          e instanceof Error
            ? e.message
            : "Upload the supporting document before marking this requirement as complete.",
        );
      }
    },
    [],
  );

  const cancelCase = useCallback(
    async (id: string, reason: string) => {
      try {
        await casesService.cancel(id, reason);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to cancel the request.");
      }
    },
    [load],
  );

  return {
    cases,
    activeCase: cases[0] ?? null,
    documents,
    requirements,
    timeline,
    loading,
    error,
    reload: load,
    toggleRequirement,
    cancelCase,
  };
}
