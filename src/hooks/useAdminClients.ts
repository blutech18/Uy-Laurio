import { useCallback, useEffect, useState } from "react";

import {
  adminService,
  type ClientFilters,
  type CreateClientInput,
} from "@/services/admin.service";
import type { ClientSummary } from "@/types/models";

interface AdminClientsState {
  clients: ClientSummary[];
  total: number;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createClient: (input: CreateClientInput) => Promise<void>;
  updateClient: (
    id: string,
    patch: { full_name?: string; phone?: string | null; notes?: string | null },
  ) => Promise<void>;
  setActive: (id: string, isActive: boolean) => Promise<void>;
}

/** Staff-side client account management (list, search, add, edit, deactivate). */
export function useAdminClients(filters: ClientFilters = {}): AdminClientsState {
  const filterKey = JSON.stringify(filters);

  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await adminService.listClients(JSON.parse(filterKey) as ClientFilters);
      setClients(page.rows);
      setTotal(page.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load client accounts.");
    } finally {
      setLoading(false);
    }
  }, [filterKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const createClient = useCallback(
    async (input: CreateClientInput) => {
      await adminService.createClient(input);
      await load();
    },
    [load],
  );

  const updateClient = useCallback(
    async (
      id: string,
      patch: { full_name?: string; phone?: string | null; notes?: string | null },
    ) => {
      await adminService.updateClient(id, patch);
      await load();
    },
    [load],
  );

  const setActive = useCallback(
    async (id: string, isActive: boolean) => {
      await adminService.setActive(id, isActive);
      await load();
    },
    [load],
  );

  return { clients, total, loading, error, reload: load, createClient, updateClient, setActive };
}
