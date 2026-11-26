"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * جلسة المستخدم على العميل — من /api/auth/me.
 */
export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  labId: string | null;
  locale: string;
}

interface SessionCtx {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (u: SessionUser | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionCtx>({ user: null, loading: true, refresh: async () => {}, setUser: () => {}, logout: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" });
      const data = await res.json().catch(() => null);
      setUser(data?.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch {
      /* ignore */
    }
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, refresh, setUser, logout }), [user, loading, refresh, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  return useContext(Ctx);
}

/** الصفحة الرئيسية للدور */
export function roleHome(role: string | undefined | null): string {
  switch (role) {
    case "DOCTOR": return "/doctor";
    case "LAB":
    case "LAB_SUPERVISOR": return "/lab";
    case "ADMIN": return "/admin";
    case "MEDICAL_OFFICER": return "/officer";
    default: return "/app";
  }
}
