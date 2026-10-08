"use client";

import { ArrowDown, GraduationCap, Menu, MoreHorizontal, Moon, Share2, SquarePen, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type TouchEvent } from "react";
import { type ChatNotice, deleteShare, fetchDataDate, sendFeedback, streamChat } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type Attachment, MAX_ATTACHMENTS, filesToAttachments } from "@/lib/attachments";
import { type Conversation, type Msg, loadHistory, saveHistory, titleFrom, uid } from "@/lib/history";
import { type Dictation, dictationSupported, speak, startDictation, stopSpeaking } from "@/lib/speech";
import { loadShares, saveShare } from "@/lib/share";
import { plainText } from "@/lib/text";
import { useSync } from "@/lib/useSync";
import ArchivedDialog from "./ArchivedDialog";
import AuthDialog from "./AuthDialog";
import ChatMenu from "./ChatMenu";
import ChatTitle from "./ChatTitle";
import Composer from "./Composer";
import ConfirmDialog from "./ConfirmDialog";
import MessageItem from "./MessageItem";
import NoticeToast, { type Notice } from "./NoticeToast";
import SearchDialog from "./SearchDialog";
import ShareDialog from "./ShareDialog";
import Sidebar from "./Sidebar";
import Tip from "./Tip";
import { Greeting, Suggestions, WelcomeFooter } from "./Welcome";

const SIDEBAR_KEY = "askuoc_sidebar_v1";
const NO_MESSAGES: Msg[] = [];
const ATTACHMENTS_ONLY_QUESTION =
  "What do these images show, and how are they relevant to the University of Cyberjaya?";
const MAX_INPUT = 600;
const SWIPE_MIN = 70; // px
const EDGE = 28; // px from the left edge where a swipe opens the drawer

const noopSubscribe = () => () => undefined;

/** 45 -> "45 seconds", 300 -> "5 minutes" */
const waitText = (sec: number) =>
  sec < 90 ? `${Math.max(1, Math.round(sec))} seconds` : `${Math.round(sec / 60)} minutes`;
const degradedText = (n: ChatNotice) => {
  if (n.mode === "partial") return "The AI service was interrupted, so this answer may be incomplete.";
  if (n.where && n.where !== "llm") return n.message;
  const back = n.retry_after ? `; it should be back in about ${waitText(n.retry_after)}` : "";
  return `Answered from the university's pages only - the AI model is unavailable${back}.`;
};
const iconBtn =
  "flex h-11 w-11 items-center justify-center rounded-xl text-uoc-700 transition hover:bg-uoc-100/80 active:scale-95 dark:text-uoc-200 dark:hover:bg-uoc-800/70 md:h-10 md:w-10";

export default function Chat() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [input, setInput] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pending, setPending] = useState(0);
  const [limitHit, setLimitHit] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [listening, setListening] = useState(false);
  const [speech, setSpeech] = useState<{ id: string; phase: "loading" | "playing" } | null>(null);
  const [dataDate, setDataDate] = useState<string | null>(null);
  const [topMenu, setTopMenu] = useState<DOMRect | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: "delete"; id: string } | { kind: "clear" } | { kind: "signout" } | null
  >(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [micBroken, setMicBroken] = useState(false); // dictation failed for good: stop offering it

  const { user, logout } = useAuth();
  const micSupported = useSyncExternalStore(noopSubscribe, dictationSupported, () => false);

  const abortRef = useRef<AbortController | null>(null);
  const dictRef = useRef<Dictation | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true); // follow the stream only while near the bottom
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  // Last text the user highlighted inside an answer. On phones, tapping "Reply" can clear the selection first.
  const lastSelection = useRef<{ text: string; node: Node | null; at: number } | null>(null);

  const { syncState, forget, forgetAll } = useSync(user, ready, busy, convs, setConvs);
  const cooldownUntil = useRef(0); // client-side slow-down window after a rate limit

  const active = convs.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? NO_MESSAGES;
  const empty = messages.length === 0;

  // client-only restore (no localStorage during SSR); always opens on a new chat
  useEffect(() => {
    const saved = loadHistory();
    const desktop = matchMedia("(min-width: 768px)").matches;
    /* eslint-disable react-hooks/set-state-in-effect */
    setConvs(saved);
    setSidebarOpen(desktop && localStorage.getItem(SIDEBAR_KEY) !== "0");
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void fetchDataDate().then(setDataDate);
  }, []);

  // persist after each finished turn, not every streamed token
  useEffect(() => {
    if (!ready || busy) return;
    saveHistory(convs);
  }, [convs, ready, busy]);

  useEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Ctrl/Cmd+K opens chat search; remember highlighted answer text; stop audio when leaving the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    const onSelection = () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
        lastSelection.current = { text: sel.toString(), node: sel.anchorNode, at: Date.now() };
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("selectionchange", onSelection);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("selectionchange", onSelection);
      stopSpeaking();
      dictRef.current?.stop();
    };
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = fromBottom < 160;
    setShowJump(fromBottom > 320);
  };
  const jumpToBottom = () => {
    stickRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  const setSidebar = (open: boolean) => {
    setSidebarOpen(open);
    localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0");
  };
  // phones: close the drawer after choosing a chat; desktop: leave the sidebar as it was
  const closeIfMobile = () => {
    if (matchMedia("(max-width: 767px)").matches) setSidebarOpen(false);
  };
  const toggleTheme = () => {
    const next = document.documentElement.classList.toggle("dark");
    localStorage.setItem("askuoc_theme", next ? "dark" : "light");
  };

  // phones only: swipe right from the left edge opens the drawer, swipe left closes it
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s || !matchMedia("(max-width: 767px)").matches) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return; // mostly-horizontal swipes only
    if (dx > 0 && s.x <= EDGE && !sidebarOpen) setSidebarOpen(true);
    else if (dx < 0 && sidebarOpen) setSidebarOpen(false);
  };

  const updateConv = useCallback(
    (id: string, fn: (c: Conversation) => Conversation) =>
      setConvs((prev) => prev.map((c) => (c.id === id ? fn(c) : c))),
    [],
  );
  const patchLast = useCallback(
    (id: string, fn: (m: Msg) => Msg) =>
      updateConv(id, (c) => ({
        ...c,
        updatedAt: Date.now(),
        messages: c.messages.map((m, i) => (i === c.messages.length - 1 ? fn(m) : m)),
      })),
    [updateConv],
  );

  const showNotice = (kind: Notice["kind"], text: string, action?: Notice["action"]) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ kind, text, key: Date.now(), action });
    noticeTimer.current = setTimeout(() => setNotice(null), 8000);
  };

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setLimitHit((n) => n + 1);
      showNotice(
        "warn",
        `Attachment limit reached - up to ${MAX_ATTACHMENTS} images or PDF pages per message. Remove one to add another.`,
      );
      return;
    }
    const { items, notices } = await filesToAttachments(files, room, setPending);
    setAttachments((prev) => [...prev, ...items].slice(0, MAX_ATTACHMENTS));
    if (notices.length) {
      if (notices.some((n) => n.startsWith("Attachment limit"))) setLimitHit((n) => n + 1);
      showNotice(items.length ? "info" : "warn", notices.join(" "));
    }
  };

  const stopAudio = () => {
    stopSpeaking();
    setSpeech(null);
    dictRef.current?.stop();
  };
  const toggleMic = () => {
    if (listening) return dictRef.current?.stop();
    stopSpeaking();
    setSpeech(null);
    const base = input.trim();
    const d = startDictation({
      onText: (t) => setInput(((base ? base + " " : "") + t).slice(0, MAX_INPUT)),
      onEnd: () => {
        setListening(false);
        dictRef.current = null;
      },
      onError: (m, code) => {
        showNotice("warn", m);
        if (code !== "no-speech") setMicBroken(true);
      },
    });
    if (d) {
      dictRef.current = d;
      setListening(true);
    }
  };
  const toggleSpeak = (m: Msg) => {
    if (speech?.id === m.id) return stopAudio();
    dictRef.current?.stop();
    setSpeech({ id: m.id, phase: "loading" });
    void speak(m.content.slice(0, 6500), {
      onStart: () => setSpeech((cur) => (cur?.id === m.id ? { id: m.id, phase: "playing" } : cur)),
      onEnd: () => setSpeech((cur) => (cur?.id === m.id ? null : cur)),
    });
  };

  /** `redo` re-asks a question on a fresh server thread (Regenerate). */
  const send = useCallback(
    async (text: string, redo?: { messages: Msg[]; quote: string | null }) => {
      const typed = text.trim();
      const files = redo ? [] : attachments;
      if ((!typed && files.length === 0 && !redo) || busy || pending > 0) return;
      if (Date.now() < cooldownUntil.current) {
        showNotice(
          "warn",
          `You're going a bit fast - please wait ${waitText((cooldownUntil.current - Date.now()) / 1000)} before asking again.`,
        );
        return;
      }
      dictRef.current?.stop();
      stopSpeaking();
      setSpeech(null);
      const q = typed || ATTACHMENTS_ONLY_QUESTION;
      const replyQuote = redo ? redo.quote : quote;

      let id = activeId;
      const existing = convs.find((c) => c.id === id);
      if (!id || !existing) {
        id = uid();
        const fresh: Conversation = {
          id,
          title: titleFrom(typed || "Attachment question"),
          threadId: null,
          messages: [],
          updatedAt: Date.now(),
        };
        setConvs((p) => [fresh, ...p]);
        setActiveId(id);
      }
      const convId = id;
      const baseMessages = redo ? redo.messages : (existing?.messages ?? []);
      const history = baseMessages
        .filter((m) => m.content && !m.error)
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));

      stickRef.current = true;
      setInput("");
      setQuote(null);
      setAttachments([]);
      setNotice(null);
      setBusy(true);
      const label = files.length > 1 ? `📎 ${files.length} attachments` : "📎 Attachment";
      const userMsg: Msg = {
        id: uid(),
        role: "user",
        content: typed || label,
        quote: replyQuote ?? undefined,
        images: files.length ? files.map((f) => ({ thumb: f.thumb, label: f.label })) : undefined,
        sources: [],
        at: Date.now(),
      };
      const asstMsg: Msg = { id: uid(), role: "assistant", content: "", sources: [], at: Date.now() };
      updateConv(convId, (c) => ({
        ...c,
        updatedAt: Date.now(),
        threadId: redo ? null : c.threadId,
        messages: [...(redo ? redo.messages : c.messages), userMsg, asstMsg],
      }));

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      await streamChat(
        {
          message: typed ? q : "",
          threadId: redo ? null : (existing?.threadId ?? null),
          history,
          quote: replyQuote,
          wantTitle: baseMessages.length === 0,
          images: files.map((f) => ({ mime: f.mime, data: f.data })),
        },
        {
          onToken: (t) => {
            patchLast(convId, (m) => ({ ...m, content: m.content + t }));
          },
          onSources: (sources) => patchLast(convId, (m) => ({ ...m, sources })),
          onSuggestions: (suggestions) => patchLast(convId, (m) => ({ ...m, suggestions })),
          onTrace: (trace) => patchLast(convId, (m) => ({ ...m, trace })),
          onNotice: (n) => {
            if (n.kind !== "degraded" || n.mode === "message") return; // "message": the bubble already says it
            patchLast(convId, (m) => ({ ...m, degraded: { message: degradedText(n), issue: n.issue } }));
            if (n.where && n.where !== "llm") showNotice("info", n.message);
          },
          onTitle: (title) => updateConv(convId, (c) => (c.titleLocked ? c : { ...c, title })),
          onDone: (d) => {
            updateConv(convId, (c) => ({ ...c, threadId: d.thread_id }));
            patchLast(convId, (m) => ({ ...m, chatId: d.chat_id, at: Date.now() }));
          },
          onError: ({ message, code, retryAfter }) => {
            if (code === "rate_limited" && retryAfter) cooldownUntil.current = Date.now() + retryAfter * 1000;
            const wait =
              retryAfter && (code === "rate_limited" || code?.startsWith("provider_"))
                ? ` Please try again in ${waitText(retryAfter)}.`
                : "";
            patchLast(convId, (m) => ({ ...m, content: m.content || message + wait, error: true }));
          },
        },
        ctrl.signal,
      );
      patchLast(convId, (m) => (m.content ? m : { ...m, content: "*Stopped.*" }));
      setBusy(false);
      if (matchMedia("(hover: hover)").matches) inputRef.current?.focus(); // don't bring the phone keyboard back up
    },
    [busy, pending, activeId, convs, quote, attachments, updateConv, patchLast],
  );

  const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
  const lastUser = lastUserIdx >= 0 ? messages[lastUserIdx] : null;
  const canRegenerate = !!lastUser && !lastUser.images?.length && !lastUser.image && !busy;
  const regenerate = () => {
    if (!lastUser || !canRegenerate) return;
    void send(lastUser.content, { messages: messages.slice(0, lastUserIdx), quote: lastUser.quote ?? null });
  };

  const resetComposer = () => {
    setInput("");
    setQuote(null);
    setAttachments([]);
    setNotice(null);
    stopAudio();
  };
  const newChat = () => {
    abortRef.current?.abort();
    setActiveId(null);
    resetComposer();
    if (matchMedia("(hover: hover)").matches) inputRef.current?.focus();
  };
  const selectConv = (id: string) => {
    abortRef.current?.abort();
    resetComposer();
    setActiveId(id);
  };
  const dropShare = (convId: string) => {
    const rec = loadShares()[convId];
    if (rec) {
      void deleteShare(rec.id, rec.token); // best effort
      saveShare(convId, null);
    }
  };
  const deleteConv = (id: string) => {
    if (id === activeId) {
      abortRef.current?.abort();
      setActiveId(null);
    }
    dropShare(id);
    forget(id);
    setConvs((p) => p.filter((c) => c.id !== id));
  };
  const clearAll = () => {
    abortRef.current?.abort();
    convs.forEach((c) => dropShare(c.id));
    forgetAll();
    setConvs([]);
    setActiveId(null);
  };
  // sign-out keeps chats in the account but wipes them from this browser (shared computers)
  const signOut = () => {
    abortRef.current?.abort();
    logout();
    setConvs([]);
    setActiveId(null);
    resetComposer();
    showNotice("info", "Signed out. Your chats are still in your account.");
  };
  const renameConv = (id: string, title: string) =>
    updateConv(id, (c) => ({ ...c, title: title.slice(0, 60), titleLocked: true })); // user-chosen title is never overwritten
  const pinConv = (id: string) => updateConv(id, (c) => ({ ...c, pinned: !c.pinned })); // pinning doesn't reorder by recency
  const archiveConv = (id: string) => {
    const c = convs.find((x) => x.id === id);
    if (!c) return;
    const archiving = !c.archived;
    updateConv(id, (x) => ({ ...x, archived: archiving, pinned: archiving ? false : x.pinned }));
    if (archiving && id === activeId) {
      abortRef.current?.abort();
      setActiveId(null);
    }
    showNotice(
      "info",
      archiving ? "Chat archived." : "Chat restored.",
      archiving ? { label: "Undo", onClick: () => updateConv(id, (x) => ({ ...x, archived: false })) } : undefined,
    );
  };

  const rate = (m: Msg, rating: 1 | -1) => {
    if (!m.chatId || !activeId) return;
    updateConv(activeId, (c) => ({ ...c, messages: c.messages.map((x) => (x.id === m.id ? { ...x, rating } : x)) }));
    void sendFeedback(m.chatId, rating);
  };

  // quote the recently highlighted text in this answer, else the whole answer as plain text
  const replyTo = (m: Msg, container: Element | null) => {
    const sel = window.getSelection();
    const live = sel && !sel.isCollapsed && container?.contains(sel.anchorNode) ? sel.toString() : "";
    const last = lastSelection.current;
    const remembered = last && container?.contains(last.node) && Date.now() - last.at < 15000 ? last.text : "";
    lastSelection.current = null;
    setQuote((live || remembered || plainText(m.content)).replace(/\s+/g, " ").trim().slice(0, 1200));
    if (matchMedia("(hover: hover)").matches) inputRef.current?.focus();
  };

  const composer = (variant: "center" | "dock") => (
    <Composer
      variant={variant}
      value={input}
      onChange={setInput}
      busy={busy}
      onSend={() => void send(input)}
      onStop={() => abortRef.current?.abort()}
      quote={quote}
      onClearQuote={() => setQuote(null)}
      attachments={attachments}
      pending={pending}
      onAddFiles={(f) => void addFiles(f)}
      onRemoveAttachment={(id) => setAttachments((a) => a.filter((x) => x.id !== id))}
      limitHit={limitHit}
      listening={listening}
      micSupported={micSupported && !micBroken}
      onToggleMic={toggleMic}
      dataDate={dataDate}
      inputRef={inputRef}
    />
  );

  return (
    <div
      className="app-bg relative isolate flex h-dvh overflow-hidden text-slate-900 dark:text-slate-100"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* ambient brand glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-96 w-96 animate-float rounded-full bg-uoc-400/25 blur-3xl dark:bg-uoc-500/20" />
        <div className="absolute -bottom-32 -right-24 h-[28rem] w-[28rem] animate-float-slow rounded-full bg-magenta-300/20 blur-3xl dark:bg-magenta-500/12" />
        <div className="absolute right-1/4 top-1/3 h-64 w-64 animate-drift rounded-full bg-teal-300/15 blur-3xl dark:bg-teal-400/10" />
      </div>

      <Sidebar
        convs={convs}
        activeId={activeId}
        open={sidebarOpen}
        onOpen={() => setSidebar(true)}
        onClose={() => setSidebar(false)}
        onNavigate={closeIfMobile}
        onSelect={selectConv}
        onNew={newChat}
        onDelete={(id) => setConfirm({ kind: "delete", id })}
        onClearAll={() => setConfirm({ kind: "clear" })}
        onSearch={() => {
          closeIfMobile();
          setSearchOpen(true);
        }}
        onRename={renameConv}
        onPin={pinConv}
        onArchive={archiveConv}
        onOpenArchived={() => {
          closeIfMobile();
          setArchivedOpen(true);
        }}
        syncState={syncState}
        onSignIn={() => {
          closeIfMobile();
          setAuthOpen(true);
        }}
        onSignOut={() => setConfirm({ kind: "signout" })}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <NoticeToast notice={notice} onDismiss={() => setNotice(null)} />
        {/* no navbar: floating controls, theme toggle top-right, menu and New chat on phones */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between p-2 pt-[calc(env(safe-area-inset-top)_+_0.5rem)] sm:px-3">
          <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-1">
            <button onClick={() => setSidebar(true)} aria-label="Open chat history" className={`${iconBtn} md:hidden`}>
              <Menu className="h-5 w-5" />
            </button>
            {active && !empty ? (
              <ChatTitle
                title={active.title}
                editing={renaming}
                onEditingChange={setRenaming}
                onCommit={(t) => renameConv(active.id, t)}
              />
            ) : (
              <span className="flex items-center gap-2 text-base font-semibold text-uoc-800 dark:text-uoc-100 md:hidden">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-uoc-600 to-magenta-500 text-white shadow-md shadow-uoc-600/25">
                  <GraduationCap className="h-4 w-4" />
                </span>
                AskUoC
              </span>
            )}
          </div>
          <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-1">
            <button onClick={newChat} aria-label="New chat" className={`${iconBtn} md:hidden`}>
              <SquarePen className="h-5 w-5" />
            </button>
            {active && !empty && (
              <>
                <button
                  onClick={() => setShareOpen(true)}
                  disabled={busy}
                  aria-label="Share conversation"
                  className="flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-uoc-700 transition hover:bg-uoc-100/80 active:scale-95 disabled:opacity-40 dark:text-uoc-200 dark:hover:bg-uoc-800/70 md:h-10"
                >
                  <Share2 className="h-[18px] w-[18px]" />
                  <span className="hidden sm:inline">Share</span>
                </button>
                <button
                  onClick={(e) => setTopMenu(e.currentTarget.getBoundingClientRect())}
                  aria-label="Chat options"
                  aria-haspopup="menu"
                  className={iconBtn}
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </>
            )}
            <Tip label="Toggle theme" side="bottomEnd">
              <button onClick={toggleTheme} aria-label="Toggle dark mode" className={iconBtn}>
                <Sun className="hidden h-5 w-5 dark:block" />
                <Moon className="h-5 w-5 dark:hidden" />
              </button>
            </Tip>
          </div>
        </div>

        {empty ? (
          <main className="relative flex flex-1 flex-col items-center justify-center overflow-y-auto px-3 pb-16 pt-4 sm:px-4">
            <Greeting />
            {composer("center")}
            <Suggestions onPick={(q) => void send(q)} />
            <WelcomeFooter dataDate={dataDate} />
          </main>
        ) : (
          <>
            <main
              ref={scrollRef}
              onScroll={onScroll}
              className="fade-y relative flex-1 scroll-smooth overflow-y-auto px-3 sm:px-4"
              aria-live="polite"
            >
              <ul className="mx-auto max-w-3xl space-y-6 pb-4 pt-16">
                {messages.map((m, i) => (
                  <MessageItem
                    key={m.id}
                    m={m}
                    last={i === messages.length - 1}
                    busy={busy}
                    speech={speech?.id === m.id ? speech.phase : "idle"}
                    canRegenerate={canRegenerate}
                    onReply={replyTo}
                    onRate={rate}
                    onSpeak={toggleSpeak}
                    onRegenerate={regenerate}
                    onFollowUp={(q) => void send(q)}
                  />
                ))}
                <div ref={bottomRef} />
              </ul>
              {showJump && (
                <button
                  onClick={jumpToBottom}
                  aria-label="Scroll to latest"
                  className="glass-strong sticky bottom-6 left-1/2 z-10 mx-auto flex h-10 w-10 -translate-x-1/2 animate-pop items-center justify-center rounded-full text-uoc-600 transition hover:scale-110 dark:text-uoc-100"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              )}
            </main>
            {composer("dock")}
          </>
        )}
      </div>

      {topMenu && active && (
        <ChatMenu
          conv={active}
          anchor={{ rect: topMenu, align: "right" }}
          onClose={() => setTopMenu(null)}
          onRename={() => setRenaming(true)}
          onPin={() => pinConv(active.id)}
          onArchive={() => archiveConv(active.id)}
          onDelete={() => setConfirm({ kind: "delete", id: active.id })}
        />
      )}
      {shareOpen && active && <ShareDialog conv={active} onClose={() => setShareOpen(false)} />}
      {archivedOpen && (
        <ArchivedDialog
          convs={convs.filter((c) => c.archived)}
          onOpen={selectConv}
          onRestore={archiveConv}
          onDelete={(id) => setConfirm({ kind: "delete", id })}
          onClose={() => setArchivedOpen(false)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={
            confirm.kind === "signout" ? "Sign out?" : confirm.kind === "clear" ? "Delete all chats?" : "Delete chat?"
          }
          body={
            confirm.kind === "signout"
              ? "Your chats stay safe in your account and come back when you sign in. They'll be removed from this browser now, so the next person using it can't read them."
              : confirm.kind === "clear"
                ? `This removes every saved conversation (archived ones too) from ${user ? "this browser and your account" : "this browser"} and deletes any shared links you created. This can't be undone.`
                : `This will delete "${convs.find((c) => c.id === confirm.id)?.title ?? "this chat"}"${loadShares()[confirm.id] ? " and its shared link" : ""}. This can't be undone.`
          }
          confirmLabel={confirm.kind === "signout" ? "Sign out" : confirm.kind === "clear" ? "Delete all" : "Delete"}
          danger={confirm.kind !== "signout"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm.kind === "signout") signOut();
            else if (confirm.kind === "clear") clearAll();
            else deleteConv(confirm.id);
            setConfirm(null);
          }}
        />
      )}
      {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} />}
      {searchOpen && (
        <SearchDialog convs={convs} onClose={() => setSearchOpen(false)} onSelect={selectConv} onNew={newChat} />
      )}
    </div>
  );
}
