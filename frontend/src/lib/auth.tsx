"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SESSION_EXPIRED, type PublicUser, type Session, api, loadSession, saveSession } from "./http";

export type AuthStatus = { signup: boolean; admin_console: boolean; needs_setup: boolean };
export type Profile = PublicUser & { avatar: string };

type AuthCtx = {
  /** null = signed out; undefined = still checking the saved session. */
  user: PublicUser | null | undefined;
  avatar: string;
  status: AuthStatus | null;
  isStaff: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<PublicUser>;
  register: (username: string, password: string, displayName: string) => Promise<PublicUser>;
  setup: (setupKey: string, username: string, password: string) => Promise<PublicUser>;
  logout: () => void;
  updateProfile: (patch: { display_name?: string; avatar?: string }) => Promise<Profile>;
  /** After a password change the server issues a fresh token (old ones are revoked). */
  replaceToken: (token: string) => void;
  refreshStatus: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside <AuthProvider>");
  return c;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined);
  const [avatar, setAvatar] = useState("");
  const [status, setStatus] = useState<AuthStatus | null>(null);

  const start = useCallback(async (s: Session | null) => {
    saveSession(s);
    setUser(s?.user ?? null);
    setAvatar("");
    if (s?.user.has_avatar)
      api<Profile>("/auth/profile")
        .then((p) => setAvatar(p.avatar))
        .catch(() => undefined);
  }, []);

  const refreshStatus = useCallback(async () => {
    for (const wait of [0, 1500, 4000]) {
      await new Promise((resolve) => setTimeout(resolve, wait)); // the API may be restarting
      const next = await api<AuthStatus>("/auth/status", { auth: false }).catch(() => null);
      if (next) return setStatus(next);
    }
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    void refreshStatus();
    const saved = loadSession();
    if (!saved) return setUser(null);
    setUser(saved.user); // optimistic; verified with the server below
    api<PublicUser>("/auth/me")
      .then((me) => start({ token: saved.token, user: { ...saved.user, ...me } }))
      .catch((e) => {
        if (e?.status === 401) void start(null); // token no longer valid
      });
    /* eslint-enable react-hooks/set-state-in-effect */
    const expired = () => void start(null);
    window.addEventListener(SESSION_EXPIRED, expired);
    return () => window.removeEventListener(SESSION_EXPIRED, expired);
  }, [start, refreshStatus]);

  const enter = useCallback(
    async (path: string, json: unknown) => {
      const s = await api<Session>(path, { method: "POST", json, auth: false });
      await start(s);
      return s.user;
    },
    [start],
  );

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      avatar,
      status,
      isStaff: user?.role === "staff" || user?.role === "admin",
      isAdmin: user?.role === "admin",
      login: (username, password) => enter("/auth/login", { username, password }),
      register: (username, password, display_name) => enter("/auth/register", { username, password, display_name }),
      setup: (setup_key, username, password) => enter("/auth/setup", { setup_key, username, password }),
      logout: () => void start(null),
      updateProfile: async (patch) => {
        const p = await api<Profile>("/auth/profile", { method: "PATCH", json: patch });
        const { avatar: a, ...pub } = p;
        setUser((u) => (u ? { ...u, ...pub } : u));
        setAvatar(a);
        const s = loadSession();
        if (s) saveSession({ ...s, user: { ...s.user, ...pub } });
        return p;
      },
      replaceToken: (token) => {
        const s = loadSession();
        if (s) saveSession({ ...s, token });
      },
      refreshStatus,
    }),
    [user, avatar, status, enter, start, refreshStatus],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
