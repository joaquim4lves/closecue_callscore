"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/components/api-client";
import { roleLabel } from "@/lib/format";

type Me = {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgName: string;
  role: "seller" | "manager";
  auth: "mock";
};

type DevUser = {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgName: string;
  role: "seller" | "manager";
};

type SessionValue = {
  ready: boolean;
  me: Me | null;
  users: DevUser[];
  switchUser: (userId: string) => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Session missing");
  return value;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<DevUser[]>([]);

  const load = useCallback(async () => {
    const directory = await api<{ users: DevUser[] }>("/api/dev/users").catch(() => ({ users: [] }));
    setUsers(directory.users);
    try {
      setMe(await api<Me>("/api/me"));
    } catch {
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function switchUser(userId: string) {
    if (!userId) return;
    await api("/api/dev/session", { method: "POST", body: JSON.stringify({ userId }) });
    window.location.assign("/");
  }

  return (
    <SessionContext.Provider value={{ ready, me, users, switchUser }}>
      <div className="shell">
        <header className="topbar">
          <a className="brand" href="/">
            CloseCue
          </a>
          <nav className="nav">
            <a href="/">Playbooks</a>
            <a href="/calls">Calls</a>
            <a href="/overlay">Overlay</a>
          </nav>
          <div className="session">
            <span className="mock-flag">Auth mock</span>
            {me ? (
              <span className="who">
                {me.orgName} · {roleLabel(me.role)}
              </span>
            ) : null}
            <label className="user-switch">
              <span className="sr-only">Usuário mock</span>
              <select
                aria-label="Usuário mock"
                value={me?.userId ?? ""}
                onChange={(event) => {
                  void switchUser(event.target.value);
                }}
              >
                <option value="" disabled>
                  Escolher usuário
                </option>
                {users.map((user) => (
                  <option key={user.userId} value={user.userId}>
                    {user.name} · {roleLabel(user.role)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </SessionContext.Provider>
  );
}
