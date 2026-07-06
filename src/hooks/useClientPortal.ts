import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { casesService } from "@/services/cases.service";
import { documentsService } from "@/services/documents.service";
import { requirementsService } from "@/services/requirements.service";
import type { Case, CaseRequirement, DocumentRecord } from "@/types/models";

interface ClientPortalState {
  cases: Case[];
  activeCase: Case | null;
  documents: DocumentRecord[];
  requirements: CaseRequirement[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  toggleRequirement: (id: string, fulfilled: boolean) => Promise<void>;
}

/**
 * Loads everything the client portal needs for the signed-in user: their
 * cases, uploaded documents, and the checklist for their most recent case.
 */
export function useClientPortal(): ClientPortalState {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [cases, setCases] = useState<Case[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [requirements, setRequirements] = useState<CaseRequirement[]>([]);
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
      const active = caseList[0] ?? null;
      setRequirements(active ? await requirementsService.listForCase(active.id) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load your portal data.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleRequirement = useCallback(
    async (id: string, fulfilled: boolean) => {
      setRequirements((prev) =>
        prev.map((r) => (r.id === id ? { ...r, fulfilled } : r)),
      );
      try {
        await requirementsService.setFulfilled(id, fulfilled);
      } catch {
        // revert on failure
        setRequirements((prev) =>
          prev.map((r) => (r.id === id ? { ...r, fulfilled: !fulfilled } : r)),
        );
      }
    },
    [],
  );

  return {
    cases,
    activeCase: cases[0] ?? null,
    documents,
    requirements,
    loading,
    error,
    reload: load,
    toggleRequirement,
  };
}
