"use client";

import { Check, Copy, Eye, EyeOff, KeyRound, Search, Shield, Sparkles, Trash2, UserPlus, Users } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import Avatar from "@/components/ui/Avatar";
import Modal from "@/components/ui/Modal";
import { useAuth } from "@/lib/auth";
import {
  createUser,
  deleteUser,
  errMsg,
  fmtInt,
  fullTime,
  getUsers,
  patchUser,
  relTime,
  type AdminUser,
  type UsersResponse,
} from "@/lib/admin";
import {
  Card,
  Chip,
  EmptyState,
  Note,
  SectionTitle,
  Skeleton,
  Spinner,
  Switch,
  TableWrap,
  btnIcon,
  btnPrimary,
  btnSecondary,
  inputCls,
  labelCls,
  td,
  th,
  useResource,
  useToast,
} from "./ui";

const ROLE_INFO: Record<AdminUser["role"], { label: string; blurb: string }> = {
  user: { label: "Student", blurb: "Regular account. Chats sync across devices." },
  staff: { label: "Staff", blurb: "Can see statistics, review questions and add knowledge." },
  admin: { label: "Admin", blurb: "Full control: settings, users, snapshots and audit log." },
};
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function PasswordField({
  id,
  value,
  onChange,
  label = "Password",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const short = value.length > 0 && value.length < 10;
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label} <span className="font-normal text-slate-400">(10-128 characters)</span>
      </label>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          spellCheck={false}
          data-1p-ignore
          className={`${inputCls} font-mono`}
          aria-invalid={short || undefined}
          required
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className={btnIcon}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => onChange(generatePassword())}
          aria-label="Generate a strong password"
          className={btnIcon}
          title="Generate"
        >
          <Sparkles className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={!value}
          onClick={async () => {
            await navigator.clipboard.writeText(value).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          aria-label="Copy password"
          className={btnIcon}
        >
          {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      {short && <p className="mt-1 text-xs text-red-600 dark:text-red-300">Use at least 10 characters.</p>}
    </div>
  );
}

function CreateUserModal({
  roles,
  onClose,
  onCreated,
}: {
  roles: string[];
  onClose: () => void;
  onCreated: (u: AdminUser) => void;
}) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminUser["role"]>("staff");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const u = username.trim().toLowerCase();
  const bad = u.length > 0 && !USERNAME_RE.test(u);
  const ok = USERNAME_RE.test(u) && password.length >= 10 && password.length <= 128;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      onCreated(await createUser({ username: u, password, role, display_name: name.trim() }));
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };
  return (
    <Modal title="Create user" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3.5">
        <div>
          <label htmlFor="nu-user" className={labelCls}>
            Username
          </label>
          <input
            id="nu-user"
            className={`${inputCls} mt-1`}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            maxLength={32}
            aria-invalid={bad || undefined}
            required
          />
          <p
            className={`mt-1 text-xs ${bad ? "text-red-600 dark:text-red-300" : "text-slate-500 dark:text-slate-400"}`}
          >
            3-32 characters: letters, numbers, dots, dashes or underscores.
          </p>
        </div>
        <div>
          <label htmlFor="nu-name" className={labelCls}>
            Display name <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="nu-name"
            className={`${inputCls} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoComplete="off"
          />
        </div>
        <PasswordField id="nu-pass" value={password} onChange={setPassword} label="Temporary password" />
        <div>
          <label htmlFor="nu-role" className={labelCls}>
            Role
          </label>
          <select
            id="nu-role"
            className={`${inputCls} mt-1`}
            value={role}
            onChange={(e) => setRole(e.target.value as AdminUser["role"])}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_INFO[r as AdminUser["role"]]?.label ?? r}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{ROLE_INFO[role].blurb}</p>
        </div>
        {error && <Note kind="error">{error}</Note>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button className={btnPrimary} disabled={!ok || busy}>
            {busy ? <Spinner /> : <UserPlus aria-hidden className="h-4 w-4" />} Create user
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return;
    setBusy(true);
    setError("");
    try {
      await patchUser(user.username, { new_password: password });
      onDone();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };
  return (
    <Modal title={`Reset password for ${user.display_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3.5">
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Choose a new password and share it securely. <b>@{user.username}</b> will be signed out on every device.
        </p>
        <PasswordField id="rp-pass" value={password} onChange={setPassword} label="New password" />
        {error && <Note kind="error">{error}</Note>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button className={btnPrimary} disabled={password.length < 10 || busy}>
            {busy ? <Spinner /> : <KeyRound aria-hidden className="h-4 w-4" />} Set password
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function UsersTab() {
  const toast = useToast();
  const { user: me, logout } = useAuth();
  const res = useResource<UsersResponse>(getUsers);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);
  const [delFor, setDelFor] = useState<AdminUser | null>(null);
  const [selfChange, setSelfChange] = useState<{
    user: AdminUser;
    patch: { role?: string; disabled?: boolean };
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const users = res.data?.users;
  const roles = res.data?.roles ?? ["user", "staff", "admin"];
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (users ?? []).filter(
      (u) => !n || u.username.includes(n) || u.display_name.toLowerCase().includes(n) || u.role.includes(n),
    );
  }, [users, q]);
  const admins = (users ?? []).filter((u) => u.role === "admin" && !u.disabled).length;

  const setBusyFor = (name: string, on: boolean) =>
    setBusy((b) => {
      const n = new Set(b);
      if (on) n.add(name);
      else n.delete(name);
      return n;
    });

  const apply = async (u: AdminUser, patch: { role?: string; disabled?: boolean }) => {
    setBusyFor(u.username, true);
    try {
      const next = await patchUser(u.username, patch);
      res.mutate((cur) =>
        cur ? { ...cur, users: cur.users.map((x) => (x.username === u.username ? next : x)) } : cur!,
      );
      toast.success(
        patch.role
          ? `${next.display_name} is now ${ROLE_INFO[next.role].label.toLowerCase()}.`
          : next.disabled
            ? `${next.display_name} was disabled and signed out.`
            : `${next.display_name} can sign in again.`,
      );
      if (u.username === me?.username) logout(); // our own token was revoked by the change
    } catch (e) {
      toast.error(errMsg(e)); // e.g. the server's "You can't remove the last admin."
    } finally {
      setBusyFor(u.username, false);
    }
  };
  const change = (u: AdminUser, patch: { role?: string; disabled?: boolean }) => {
    if (u.username === me?.username && (patch.disabled || (patch.role && patch.role !== "admin"))) {
      setSelfChange({
        user: u,
        patch,
        text: patch.disabled
          ? "You are about to disable your own account. You will be signed out immediately and cannot sign back in."
          : "You are about to remove your own admin access. You will be signed out and lose access to this console.",
      });
    } else void apply(u, patch);
  };

  const remove = async () => {
    const u = delFor;
    if (!u) return;
    setDelFor(null);
    setBusyFor(u.username, true);
    try {
      await deleteUser(u.username);
      res.mutate((cur) => (cur ? { ...cur, users: cur.users.filter((x) => x.username !== u.username) } : cur!));
      toast.success(`${u.display_name} was deleted.`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyFor(u.username, false);
    }
  };

  const roleSelect = (u: AdminUser) => (
    <select
      aria-label={`Role for ${u.display_name}`}
      value={u.role}
      disabled={busy.has(u.username)}
      onChange={(e) => change(u, { role: e.target.value })}
      className={`${inputCls} !w-auto !py-1.5 md:!py-1.5`}
    >
      {roles.map((r) => (
        <option key={r} value={r}>
          {ROLE_INFO[r as AdminUser["role"]]?.label ?? r}
        </option>
      ))}
    </select>
  );
  const actions = (u: AdminUser) => {
    const self = u.username === me?.username;
    return (
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setResetFor(u)}
          disabled={busy.has(u.username)}
          aria-label={`Reset password for ${u.display_name}`}
          title="Reset password"
          className={btnIcon}
        >
          <KeyRound className="h-4 w-4" />
        </button>
        <button
          onClick={() => setDelFor(u)}
          disabled={busy.has(u.username) || self}
          aria-label={self ? "You can't delete your own account here" : `Delete ${u.display_name}`}
          title={self ? "Use your profile to delete your own account" : "Delete user"}
          className={`${btnIcon} hover:!bg-red-50 hover:!text-red-600 dark:hover:!bg-red-950/50`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    );
  };
  const statusSwitch = (u: AdminUser) => (
    <div className="flex items-center gap-2">
      <Switch
        checked={!u.disabled}
        disabled={busy.has(u.username)}
        onChange={(on) => change(u, { disabled: !on })}
        label={`${u.display_name} account ${u.disabled ? "disabled" : "active"}. Toggle to ${u.disabled ? "enable" : "disable"}`}
      />
      <span
        className={`text-xs ${u.disabled ? "text-red-600 dark:text-red-300" : "text-slate-600 dark:text-slate-300"}`}
      >
        {u.disabled ? "Disabled" : "Active"}
      </span>
    </div>
  );
  const identity = (u: AdminUser) => (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar user={u} size={36} />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate font-medium">
          {u.display_name}
          {u.username === me?.username && <Chip tone="brand">You</Chip>}
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">@{u.username}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card aria-labelledby="users-title">
        <SectionTitle
          id="users-title"
          icon={<Users aria-hidden className="h-4 w-4" />}
          title="Accounts"
          hint={
            users
              ? `${fmtInt(users.length)} account${users.length === 1 ? "" : "s"} - ${admins} active admin${admins === 1 ? "" : "s"}`
              : "Manage who can sign in and what they can do"
          }
          actions={
            <button onClick={() => setCreating(true)} className={btnPrimary}>
              <UserPlus aria-hidden className="h-4 w-4" /> Create user
            </button>
          }
        />
        <div className="relative mb-3">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            aria-label="Search users"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, username or role"
            className={`${inputCls} pl-10`}
          />
        </div>

        {res.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : res.error && !users ? (
          <Note
            kind="error"
            title="Couldn't load users"
            action={
              <button className={btnSecondary} onClick={() => void res.reload()}>
                Try again
              </button>
            }
          >
            {res.error.message}
          </Note>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="No users match">
            Try a different search.
          </EmptyState>
        ) : (
          <>
            <div className="hidden md:block">
              <TableWrap label="Accounts">
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">User accounts</caption>
                  <thead className="border-b border-uoc-100 dark:border-white/10">
                    <tr>
                      <th scope="col" className={th}>
                        User
                      </th>
                      <th scope="col" className={th}>
                        Role
                      </th>
                      <th scope="col" className={th}>
                        Status
                      </th>
                      <th scope="col" className={th}>
                        Created
                      </th>
                      <th scope="col" className={`${th} w-24`}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-uoc-100/70 dark:divide-white/10">
                    {filtered.map((u) => (
                      <tr
                        key={u.username}
                        className={`hover:bg-white/40 dark:hover:bg-white/5 ${busy.has(u.username) ? "opacity-60" : ""}`}
                      >
                        <th scope="row" className={`${td} max-w-xs font-normal`}>
                          {identity(u)}
                        </th>
                        <td className={td}>{roleSelect(u)}</td>
                        <td className={td}>{statusSwitch(u)}</td>
                        <td
                          className={`${td} whitespace-nowrap text-xs text-slate-500 dark:text-slate-400`}
                          title={fullTime(u.created_at)}
                        >
                          {relTime(u.created_at)}
                        </td>
                        <td className={td}>{actions(u)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
            <ul className="space-y-3 md:hidden" aria-label="Accounts">
              {filtered.map((u) => (
                <li
                  key={u.username}
                  className={`rounded-2xl bg-white/50 p-3.5 dark:bg-white/5 ${busy.has(u.username) ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    {identity(u)}
                    {actions(u)}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    {roleSelect(u)}
                    {statusSwitch(u)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          <Shield aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Role, status and password changes sign that person out everywhere. The last active admin can&apos;t be
          demoted, disabled or deleted. Passwords are stored as salted hashes and are never shown.
        </p>
      </Card>

      {creating && (
        <CreateUserModal
          roles={roles}
          onClose={() => setCreating(false)}
          onCreated={(u) => {
            setCreating(false);
            res.mutate((cur) => (cur ? { ...cur, users: [...cur.users, u] } : cur!));
            toast.success(`${u.display_name} was created. Share their password securely.`);
          }}
        />
      )}
      {resetFor && (
        <ResetPasswordModal
          user={resetFor}
          onClose={() => setResetFor(null)}
          onDone={() => {
            toast.success(`Password changed. ${resetFor.display_name} was signed out everywhere.`);
            setResetFor(null);
          }}
        />
      )}
      {delFor && (
        <ConfirmDialog
          title={`Delete ${delFor.display_name}?`}
          body={`@${delFor.username} will lose access and their synced chats are deleted. This can't be undone.`}
          confirmLabel="Delete user"
          onConfirm={() => void remove()}
          onCancel={() => setDelFor(null)}
        />
      )}
      {selfChange && (
        <ConfirmDialog
          title="Change your own access?"
          body={selfChange.text}
          confirmLabel="Yes, continue"
          onConfirm={() => {
            const c = selfChange;
            setSelfChange(null);
            void apply(c.user, c.patch);
          }}
          onCancel={() => setSelfChange(null)}
        />
      )}
    </div>
  );
}
