"use client";

import { GraduationCap, KeyRound, LogIn, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/http";
import Modal from "./ui/Modal";

type Mode = "signin" | "signup" | "setup";
const field =
  "w-full rounded-xl border border-uoc-100 bg-white/70 px-3.5 py-2.5 text-base outline-none transition focus:border-uoc-400 focus:ring-2 focus:ring-uoc-300/50 dark:border-uoc-700 dark:bg-white/5 sm:text-sm";
const primary =
  "flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-uoc-600 to-magenta-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-uoc-600/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60";

/** One form for everybody; the server decides the role. The first admin uses "setup" with the ADMIN_TOKEN key. */
export default function AuthDialog({
  onClose,
  reason,
  initialMode = "signin",
}: {
  onClose: () => void;
  reason?: string;
  initialMode?: Mode;
}) {
  const { login, register, setup, status, refreshStatus } = useAuth();

  useEffect(() => {
    void refreshStatus(); // the page may have loaded while the API was restarting
  }, [refreshStatus]);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signin") await login(username, password);
      else if (mode === "signup") await register(username, password, name);
      else await setup(key, username, password);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Set up the first admin";
  return (
    <Modal title={title} onClose={onClose}>
      <div className="mb-4 flex items-center gap-3 rounded-2xl bg-uoc-50/70 p-3 text-xs leading-relaxed text-slate-600 dark:bg-white/5 dark:text-slate-300">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-uoc-600 to-magenta-500 text-white">
          <GraduationCap className="h-5 w-5" />
        </span>
        <p>
          {reason ??
            (mode === "setup"
              ? "Use the ADMIN_TOKEN configured on the server as the setup key. This only works until an admin exists."
              : "Optional: an account syncs your chats across devices. You can always chat without one.")}
        </p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        {mode === "setup" && (
          <label className="block text-xs font-medium">
            Setup key
            <input
              className={`${field} mt-1`}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
        )}
        {mode === "signup" && (
          <label className="block text-xs font-medium">
            Name <span className="font-normal text-slate-400">(optional)</span>
            <input
              className={`${field} mt-1`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              autoComplete="name"
            />
          </label>
        )}
        <label className="block text-xs font-medium">
          Username
          <input
            className={`${field} mt-1`}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </label>
        <label className="block text-xs font-medium">
          Password {mode !== "signin" && <span className="font-normal text-slate-400">(at least 10 characters)</span>}
          <input
            className={`${field} mt-1`}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
          />
        </label>
        {mode === "signup" && (
          <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-uoc-600"
              required
            />
            <span>
              I agree to the{" "}
              <Link
                href="/terms"
                target="_blank"
                className="font-medium text-uoc-600 underline underline-offset-2 dark:text-uoc-300"
              >
                Terms
              </Link>{" "}
              and have read the{" "}
              <Link
                href="/privacy"
                target="_blank"
                className="font-medium text-uoc-600 underline underline-offset-2 dark:text-uoc-300"
              >
                Privacy Policy
              </Link>
              .
            </span>
          </label>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-200"
          >
            {error}
          </p>
        )}
        <button className={primary} disabled={busy || (mode === "signup" && !agree)}>
          {mode === "signin" ? (
            <LogIn className="h-4 w-4" />
          ) : mode === "signup" ? (
            <UserPlus className="h-4 w-4" />
          ) : (
            <KeyRound className="h-4 w-4" />
          )}
          {busy ? "Please wait…" : title}
        </button>
      </form>
      <div className="mt-4 flex flex-wrap justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        {mode === "signin" ? (
          <>
            {status?.signup !== false ? (
              <button
                className="font-medium text-uoc-600 hover:underline dark:text-uoc-300"
                onClick={() => setMode("signup")}
              >
                New here? Create an account
              </button>
            ) : (
              <span>Sign-ups are closed.</span>
            )}
            {status?.needs_setup === true && (
              <button
                className="font-medium text-magenta-600 hover:underline dark:text-magenta-300"
                onClick={() => setMode("setup")}
              >
                First-time admin setup
              </button>
            )}
          </>
        ) : (
          <button
            className="font-medium text-uoc-600 hover:underline dark:text-uoc-300"
            onClick={() => setMode("signin")}
          >
            Already have an account? Sign in
          </button>
        )}
      </div>
    </Modal>
  );
}
