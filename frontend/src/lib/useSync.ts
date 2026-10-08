"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { PublicUser } from "./http";
import type { Conversation } from "./history";
import { merge, pull, push, removeAllRemote, removeRemote } from "./sync";

export type SyncState = "off" | "syncing" | "synced" | "error";

/** Keeps signed-in users' chats in step with their account: pull + merge on sign-in, then debounced push. */
export function useSync(
  user: PublicUser | null | undefined,
  ready: boolean,
  busy: boolean,
  convs: Conversation[],
  setConvs: Dispatch<SetStateAction<Conversation[]>>,
) {
  const [state, setState] = useState<SyncState>("off");
  const pushed = useRef(new Map<string, number>()); // id -> updatedAt last known to be on the server
  const convsRef = useRef(convs);
  useEffect(() => void (convsRef.current = convs), [convs]);
  const username = user?.username;

  useEffect(() => {
    pushed.current = new Map();
    if (!username || !ready) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setState("off");
      return;
    }
    let cancelled = false;
    setState("syncing");
    (async () => {
      try {
        const remote = await pull();
        const { merged, toPush } = merge(convsRef.current, remote);
        remote.forEach((r) => pushed.current.set(r.id, r.updatedAt));
        if (cancelled) return;
        setConvs(merged);
        await push(toPush);
        toPush.forEach((c) => pushed.current.set(c.id, c.updatedAt));
        if (!cancelled) setState("synced");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, ready, setConvs]);

  useEffect(() => {
    if (!username || !ready || busy || state === "off" || state === "syncing") return;
    const dirty = convs.filter((c) => c.messages.length && c.updatedAt > (pushed.current.get(c.id) ?? -1));
    if (!dirty.length) return;
    const t = setTimeout(async () => {
      setState("syncing");
      try {
        await push(dirty);
        dirty.forEach((c) => pushed.current.set(c.id, c.updatedAt));
        setState("synced");
      } catch {
        setState("error");
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [convs, username, ready, busy, state]);

  const forget = useCallback(
    (id: string) => {
      pushed.current.delete(id);
      if (username) void removeRemote(id);
    },
    [username],
  );
  const forgetAll = useCallback(() => {
    pushed.current.clear();
    if (username) void removeAllRemote();
  }, [username]);

  return { syncState: state, forget, forgetAll };
}
