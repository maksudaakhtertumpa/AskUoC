"use client";

import {
  ArrowLeft,
  Camera,
  CloudUpload,
  Download,
  KeyRound,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { API_URL, ApiError, api, authToken } from "@/lib/http";
import { imageToAvatar } from "@/lib/image";
import AuthDialog from "./AuthDialog";
import ConfirmDialog from "./ConfirmDialog";
import Avatar from "./ui/Avatar";

const input =
  "w-full rounded-xl border border-uoc-100 bg-white/70 px-3.5 py-2.5 text-base outline-none transition focus:border-uoc-400 focus:ring-2 focus:ring-uoc-300/50 dark:border-uoc-700 dark:bg-white/5 sm:text-sm";
const primary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-uoc-600 to-magenta-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-uoc-600/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60";
const ghost =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-uoc-200/80 px-4 py-2.5 text-sm font-medium transition hover:bg-uoc-50 active:scale-[0.98] disabled:opacity-60 dark:border-white/15 dark:hover:bg-white/5";

const ROLE_LABEL = { user: "Member", staff: "Staff", admin: "Administrator" } as const;

function Card({
  title,
  icon,
  children,
  tone = "",
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  tone?: string;
}) {
  return (
    <section className={`glass animate-rise rounded-3xl p-5 sm:p-6 ${tone}`}>
      <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-uoc-900 dark:text-uoc-50">
        <span className="text-uoc-500">{icon}</span> {title}
      </h2>
      {children}
    </section>
  );
}

function Msg({ ok, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <p
      role={ok ? "status" : "alert"}
      className={`rounded-xl px-3 py-2 text-xs ${ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200"}`}
    >
      {children}
    </p>
  );
}

export default function ProfileView() {
  const { user, avatar, updateProfile, replaceToken, logout } = useAuth();
  const router = useRouter();
  const [signIn, setSignIn] = useState(false);
  const [name, setName] = useState("");
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [avatarMsg, setAvatarMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [synced, setSynced] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deleteMsg, setDeleteMsg] = useState("");
  const [dataMsg, setDataMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (user) setName(user.display_name);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [user]);
  useEffect(() => {
    if (!user) return;
    api<{ conversations: unknown[] }>("/me/conversations")
      .then((r) => setSynced(r.conversations.length))
      .catch(() => setSynced(null));
  }, [user]);

  const toggleTheme = () => {
    const dark = document.documentElement.classList.toggle("dark");
    localStorage.setItem("askuoc_theme", dark ? "dark" : "light");
  };

  const shell = (children: ReactNode) => (
    <div className="app-bg min-h-dvh text-slate-900 dark:text-slate-100">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-4 pb-2 pt-[calc(env(safe-area-inset-top)_+_1rem)]">
        <Link
          href="/"
          className="flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-uoc-700 transition hover:bg-uoc-100/80 dark:text-uoc-200 dark:hover:bg-uoc-800/70"
        >
          <ArrowLeft className="h-4 w-4" /> Back to chat
        </Link>
        <button
          onClick={toggleTheme}
          aria-label="Toggle dark mode"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-uoc-700 transition hover:bg-uoc-100/80 dark:text-uoc-200 dark:hover:bg-uoc-800/70"
        >
          <Sun className="hidden h-5 w-5 dark:block" />
          <Moon className="h-5 w-5 dark:hidden" />
        </button>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 pb-16 pt-2">{children}</main>
    </div>
  );

  if (user === undefined) return shell(<div className="glass h-48 animate-pulse rounded-3xl" aria-busy />);
  if (!user) {
    return shell(
      <>
        <Card title="Your profile" icon={<UserRound className="h-5 w-5" />}>
          <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
            Sign in to manage your account, picture and synced chats.
          </p>
          <button className={primary} onClick={() => setSignIn(true)}>
            Sign in
          </button>
        </Card>
        {signIn && <AuthDialog onClose={() => setSignIn(false)} />}
      </>,
    );
  }

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    setAvatarMsg(null);
    setBusy("avatar");
    try {
      await updateProfile({ avatar: await imageToAvatar(file) });
      setAvatarMsg({ ok: true, text: "Profile picture updated." });
    } catch (e) {
      setAvatarMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't update the picture." });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const removeAvatar = async () => {
    setBusy("avatar");
    try {
      await updateProfile({ avatar: "" });
      setAvatarMsg({ ok: true, text: "Picture removed - your initial is shown instead." });
    } catch (e) {
      setAvatarMsg({ ok: false, text: e instanceof ApiError ? e.message : "Couldn't remove the picture." });
    } finally {
      setBusy(null);
    }
  };
  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("name");
    setNameMsg(null);
    try {
      await updateProfile({ display_name: name.trim() });
      setNameMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setNameMsg({ ok: false, text: err instanceof ApiError ? err.message : "Couldn't save." });
    } finally {
      setBusy(null);
    }
  };
  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("pw");
    setPwMsg(null);
    try {
      const r = await api<{ token: string }>("/auth/password", {
        method: "POST",
        json: { current_password: cur, new_password: next },
      });
      replaceToken(r.token); // other devices are signed out; this one continues with the fresh token
      setCur("");
      setNext("");
      setPwMsg({ ok: true, text: "Password changed. Other devices have been signed out." });
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof ApiError ? err.message : "Couldn't change the password." });
    } finally {
      setBusy(null);
    }
  };
  const exportData = async () => {
    setBusy("export");
    setDataMsg(null);
    try {
      const res = await fetch(`${API_URL}/auth/export`, { headers: { Authorization: `Bearer ${authToken()}` } });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), {
        href: url,
        download: `askuoc-${user.username}-data.json`,
      });
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setDataMsg({ ok: false, text: "Couldn't export your data right now." });
    } finally {
      setBusy(null);
    }
  };
  const deleteSynced = async () => {
    setBusy("synced");
    try {
      await api("/me/conversations", { method: "DELETE" });
      setSynced(0);
      setDataMsg({ ok: true, text: "Synced chats deleted from your account. Copies on your devices are untouched." });
    } catch {
      setDataMsg({ ok: false, text: "Couldn't delete them right now." });
    } finally {
      setBusy(null);
    }
  };
  const deleteAccount = async () => {
    setDeleteMsg("");
    try {
      await api("/auth/me", { method: "DELETE", json: { password: deletePw } });
      localStorage.removeItem("askuoc_history_v1");
      logout();
      router.push("/");
    } catch (e) {
      setDeleteMsg(e instanceof ApiError ? e.message : "Couldn't delete the account.");
      setConfirmDelete(false);
    }
  };

  const since = user.created_at
    ? new Date(user.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null;
  return shell(
    <>
      <section className="glass animate-rise flex flex-col items-center gap-4 rounded-3xl p-6 text-center sm:flex-row sm:text-left">
        <div className="relative">
          <Avatar user={user} src={avatar} size={88} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy === "avatar"}
            aria-label="Change profile picture"
            className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-uoc-600 text-white shadow-lg transition hover:bg-uoc-700 active:scale-90 disabled:opacity-60"
          >
            <Camera className="h-4 w-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => void onPickFile(e.target.files?.[0])}
          />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{user.display_name}</h1>
          <p className="text-sm text-slate-500">@{user.username}</p>
          <p className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs sm:justify-start">
            <span className="inline-flex items-center gap-1 rounded-full bg-uoc-100 px-2.5 py-1 font-medium text-uoc-700 dark:bg-uoc-800 dark:text-uoc-100">
              <ShieldCheck className="h-3 w-3" /> {ROLE_LABEL[user.role]}
            </span>
            {since && <span className="text-slate-500">Member since {since}</span>}
          </p>
        </div>
        {avatar && (
          <button
            onClick={() => void removeAvatar()}
            className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-magenta-600"
          >
            Remove picture
          </button>
        )}
      </section>
      {avatarMsg && <Msg ok={avatarMsg.ok}>{avatarMsg.text}</Msg>}

      <Card title="Display name" icon={<UserRound className="h-5 w-5" />}>
        <form onSubmit={saveName} className="flex flex-col gap-3 sm:flex-row">
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            aria-label="Display name"
            required
          />
          <button className={primary} disabled={busy === "name" || name.trim() === user.display_name}>
            Save
          </button>
        </form>
        {nameMsg && (
          <div className="mt-3">
            <Msg ok={nameMsg.ok}>{nameMsg.text}</Msg>
          </div>
        )}
      </Card>

      <Card title="Password" icon={<KeyRound className="h-5 w-5" />}>
        <form onSubmit={changePassword} className="space-y-3">
          <input
            className={input}
            type="password"
            placeholder="Current password"
            value={cur}
            onChange={(e) => setCur(e.target.value)}
            autoComplete="current-password"
            required
          />
          <input
            className={input}
            type="password"
            placeholder="New password (at least 10 characters)"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
          />
          <button className={primary} disabled={busy === "pw"}>
            Change password
          </button>
        </form>
        {pwMsg && (
          <div className="mt-3">
            <Msg ok={pwMsg.ok}>{pwMsg.text}</Msg>
          </div>
        )}
      </Card>

      <Card title="Your data" icon={<CloudUpload className="h-5 w-5" />}>
        <p className="mb-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {synced === null
            ? "Chats you have while signed in are synced to your account so you can continue on another device."
            : `${synced} chat${synced === 1 ? "" : "s"} synced to your account.`}{" "}
          Uploaded images and PDF pages are never stored. See the{" "}
          <Link href="/privacy" className="font-medium text-uoc-600 underline underline-offset-2 dark:text-uoc-300">
            privacy policy
          </Link>
          .
        </p>
        <div className="flex flex-wrap gap-2">
          <button className={ghost} onClick={() => void exportData()} disabled={busy === "export"}>
            <Download className="h-4 w-4" /> Download my data
          </button>
          <button className={ghost} onClick={() => void deleteSynced()} disabled={busy === "synced" || !synced}>
            <Trash2 className="h-4 w-4" /> Delete synced chats
          </button>
        </div>
        {dataMsg && (
          <div className="mt-3">
            <Msg ok={dataMsg.ok}>{dataMsg.text}</Msg>
          </div>
        )}
      </Card>

      <Card title="Session" icon={<LogOut className="h-5 w-5" />}>
        <div className="flex flex-wrap gap-2">
          <button
            className={ghost}
            onClick={() => {
              logout();
              router.push("/");
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </Card>

      <Card
        title="Delete account"
        icon={<Trash2 className="h-5 w-5 !text-red-500" />}
        tone="!border-red-200/70 dark:!border-red-900/60"
      >
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          Permanently deletes your account and every chat synced to it. This can&apos;t be undone.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            className={input}
            type="password"
            placeholder="Confirm with your password"
            value={deletePw}
            onChange={(e) => setDeletePw(e.target.value)}
            autoComplete="current-password"
            aria-label="Password to confirm deletion"
          />
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            disabled={!deletePw}
            onClick={() => setConfirmDelete(true)}
          >
            Delete account
          </button>
        </div>
        {deleteMsg && (
          <div className="mt-3">
            <Msg>{deleteMsg}</Msg>
          </div>
        )}
      </Card>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete your account?"
          body="Your account and synced chats will be removed for good."
          confirmLabel="Delete forever"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void deleteAccount()}
        />
      )}
    </>,
  );
}
