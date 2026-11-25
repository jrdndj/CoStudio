"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AudioLines, BookOpen, ChevronDown, CircleHelp, ClipboardList, Command, GitBranch, LayoutGrid,
  LogOut, Moon, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Sun, Telescope,
} from "lucide-react";
import { DiaryModule, FutureModule, QuestionnaireModule, WorkflowModule } from "./Modules";
import { Workspace } from "./Workspace";
import { PROFILE_FIELDS, ROLES, type Role, type StudyState } from "@/lib/study-types";
import { backendNames, errorMessage, type StudyAction } from "@/lib/study-client";

type Page = "workspace" | "workflow" | "future" | "diary" | "questionnaires";
const tabs = [
  { id: "workspace", label: "Workspace", title: "My Creative Workspace", icon: LayoutGrid },
  { id: "workflow", label: "Workflow", title: "My Creative Workflow", icon: GitBranch },
  { id: "future", label: "Future Studio", title: "Future Studio", icon: Telescope },
  { id: "diary", label: "Creative Diary", title: "Creative Diary", icon: BookOpen },
  { id: "questionnaires", label: "Questionnaires", title: "Questionnaires", icon: ClipboardList },
] as const;

function StatusLabel({ children, tone = "" }: { children: ReactNode; tone?: string }) {
  return <span className={`status-label ${tone}`}><span className="status-dot" />{children}</span>;
}

export function Studio() {
  const [state, setState] = useState<StudyState | null>(null);
  const [page, setPage] = useState<Page>("workspace");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [hideLeft, setHideLeft] = useState(false);
  const [hideRight, setHideRight] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [diaryArtefact, setDiaryArtefact] = useState<string | undefined>();
  const sequence = useRef(0);

  const invoke: StudyAction = useCallback(async (action, payload = {}) => {
    const order = ++sequence.current;
    const eventId = typeof payload.eventId === "string" ? payload.eventId : crypto.randomUUID();
    const response = await fetch("/api/study", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, action, eventId }),
    });
    const result = await response.json();
    if (result.settings && order === sequence.current) setState(result as StudyState);
    if (!response.ok) throw new Error(result.error || "The study server could not complete the request.");
    return result as StudyState;
  }, []);

  const refresh = useCallback(async () => {
    try { setError(""); return await invoke("state"); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }, [invoke]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const saved = localStorage.getItem("costudio-theme");
    if (saved === "light") { document.documentElement.dataset.theme = "light"; setTheme("light"); }
  }, []);
  useEffect(() => {
    if (!state?.artefacts.some((item) => item.status === "pending" && item.backend === "WIZARD")) return;
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [state?.artefacts, refresh]);

  function switchTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("costudio-theme", next);
  }

  const participant = state?.participant;
  const consented = Boolean(state?.settings.consentReady && participant?.consentAt && participant.consentVersion === state.settings.consentVersion);
  const active = Boolean(consented && participant?.role);
  const current = tabs.find((tab) => tab.id === page)!;
  const configured = state?.questionnaires.filter((instrument) => instrument.items.length) ?? [];
  const remaining = configured.filter((instrument) => !state?.responses.some((response) =>
    response.instrumentId === instrument.id && response.version === instrument.version)).length;
  const progress = [
    { label: "Join the study", done: active, page: "workspace" },
    { label: "Explore a creative idea", done: Boolean(state?.artefacts.some((item) => item.status === "completed") || state?.uploads.some((upload) => upload.purpose === "sketch")), page: "workspace" },
    { label: "Map your workflow", done: Boolean(state?.workflows.length), page: "workflow" },
    { label: "Save a Future Studio proposal", done: Boolean(state?.future?.finalized), page: "future" },
    { label: "Write a diary entry", done: Boolean(state?.diary.length), page: "diary" },
  ] as const;
  const completed = progress.filter((item) => item.done).length;

  async function leave() {
    try {
      await invoke("logout");
      setState(null); setPage("workspace"); setShowProgress(false);
      await refresh();
    } catch (cause) { setError(errorMessage(cause)); }
  }

  const gate = <Onboarding state={state} invoke={invoke} consented={consented} loading={loading} retry={refresh} />;
  const moduleProps = state ? { state, invoke } : null;

  return <div className="studio">
    <a className="skip-link" href="#main">Skip to workspace</a>
    <header className="studio-header">
      <Link className="brand" href="/" onClick={() => setPage("workspace")} aria-label="CoStudio home">
        <span className="brand-mark"><AudioLines size={23} strokeWidth={2.1} /></span>
        <span className="brand-type"><strong>CoStudio</strong><small>Your music. Your process.</small></span>
      </Link>
      <nav className="studio-nav" aria-label="Study activities">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button"
          aria-current={page === id ? "page" : undefined} className={page === id ? "selected" : ""}
          onClick={() => setPage(id)}><Icon size={16} strokeWidth={1.9} />{label}</button>)}
      </nav>
      <div className="header-tools">
        <button className="icon-button" type="button" onClick={switchTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        {participant
          ? <button className="icon-button participant-button" type="button" onClick={() => void leave()} aria-label="End study session" title="End study session"><LogOut size={17} /></button>
          : <Link className="icon-button participant-button" href="/research" aria-label="Researcher login" title="Researcher login"><Command size={17} /></Link>}
      </div>
    </header>
    <main id="main">
      <div className="workspace-heading">
        <div><div className="eyebrow heading-kicker"><span /> MUSIC-MAKING RESEARCH</div><h1>{current.title}</h1></div>
        <div className="heading-tools">
          {state && <StatusLabel tone={state.settings.backend === "LIVE" ? "teal-tone" : "accent-tone"}>{backendNames[state.settings.backend]}</StatusLabel>}
          <div className="progress-wrap">
            <button type="button" className="button progress-button" aria-expanded={showProgress} onClick={() => setShowProgress(!showProgress)}>
              <span className="progress-ring" style={{ "--progress": `${completed / progress.length * 100}%` } as React.CSSProperties} />
              <span>Study progress</span><ChevronDown size={14} />
            </button>
            {showProgress && <section className="progress-menu panel" aria-label="Study progress">
              <div className="progress-title"><strong>Study progress</strong><span>{completed}/{progress.length} activities</span></div>
              <progress aria-label="Activities completed" value={completed} max={progress.length} />
              {progress.map((item) => <button key={item.label} type="button" onClick={() => { setPage(item.page); setShowProgress(false); }}>
                <span className={item.done ? "progress-completed" : ""}>{item.done ? "✓" : "○"}</span>{item.label}
              </button>)}
              <button type="button" onClick={() => { setPage("questionnaires"); setShowProgress(false); }}>
                <ClipboardList size={15} /> {configured.length ? `${remaining} questionnaire${remaining === 1 ? "" : "s"} pending` : "No questionnaires configured"}
              </button>
            </section>}
          </div>
        </div>
      </div>
      {error && <div className="app-alert" role="alert">{error}</div>}

      {page === "workspace" && <>
        <div className="workspace-toggles">
          <button className="button quiet" type="button" aria-expanded={!hideLeft} onClick={() => setHideLeft(!hideLeft)}>
            {hideLeft ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}<span>Studio settings</span>
          </button>
          <button className="button quiet" type="button" aria-expanded={!hideRight} onClick={() => setHideRight(!hideRight)}>
            <span>Interaction history</span>{hideRight ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
          </button>
        </div>
        <Workspace state={state} invoke={invoke} active={active} gate={gate} hideLeft={hideLeft} hideRight={hideRight}
          openDiary={(id) => { setDiaryArtefact(id); setPage("diary"); }} />
      </>}
      {page !== "workspace" && <div className="module-wrap">
        {!active || !moduleProps ? <div className="module-gate panel">{gate}</div> : <>
          {page === "workflow" && <WorkflowModule {...moduleProps} />}
          {page === "future" && <FutureModule {...moduleProps} />}
          {page === "diary" && <DiaryModule key={diaryArtefact || "diary"} {...moduleProps} artefactId={diaryArtefact} />}
          {page === "questionnaires" && <QuestionnaireModule {...moduleProps} />}
        </>}
      </div>}
    </main>
    <footer className="studio-footer">
      <span><span className="footer-dot" /> CoStudio <span aria-hidden="true">·</span> Research prototype</span>
      <span>{participant ? <><span className="mono">{participant.publicId}</span><span aria-hidden="true"> · </span> Participant session</> : <Link href="/research">Researcher access</Link>}</span>
    </footer>
  </div>;
}

function Onboarding({ state, invoke, consented, loading, retry }: {
  state: StudyState | null; invoke: StudyAction; consented: boolean; loading: boolean;
  retry: () => Promise<StudyState | undefined>;
}) {
  const [code, setCode] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [roles, setRoles] = useState<Role[]>([]);
  const participant = state?.participant;
  const settings = state?.settings;
  const fields = settings?.profileFields ?? PROFILE_FIELDS;
  const step = !participant ? "join" : !consented ? "consent" : "profile";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      if (!participant) { await invoke("redeem", { code: code.trim() }); setCode(""); }
      else if (!consented) await invoke("consent", { accepted, version: settings?.consentVersion });
      else await invoke("profile", {
        role, roles: fields.includes("roles") ? roles.filter((item) => item !== role) : [],
        experience: data.get("experience") ? Number(data.get("experience")) : undefined,
        genres: data.get("genres") || undefined, status: data.get("status") || undefined,
        tools: data.get("tools") || undefined, aiExperience: data.get("aiExperience") || undefined,
      });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="gate-card" role="status"><h2>Opening CoStudio</h2><p>Connecting to the study server.</p></div>;

  return <div className={`gate-card ${step === "profile" ? "profile-card" : ""}`}>
    <div className="signal" aria-hidden="true">
      <div className="signal-ring outer" /><div className="signal-ring middle" /><div className="signal-ring inner" />
      <span className="signal-pin p1" /><span className="signal-pin p2" />
      <div className="signal-core"><AudioLines size={35} strokeWidth={1.55} /></div>
    </div>
    <div className="eyebrow accent-text">{step === "join" ? "PARTICIPANT ACCESS" : step === "consent" ? "STUDY INFORMATION" : "CREATIVE PROFILE"}</div>
    <h2>{step === "join" ? "Enter the studio" : step === "consent" ? "Review the study information" : "Set up your creative profile"}</h2>
    {step === "join" && <p>Enter your researcher-issued study code to open your private creative workspace.</p>}
    {step === "profile" && <p>Participant ID <strong className="mono">{participant?.publicId}</strong></p>}
    <form onSubmit={submit} className="onboarding-form">
      {!state && <button className="button" type="button" onClick={() => void retry()}>Reconnect to study server</button>}
      {step === "join" && state && <>
        <label className="form-field" htmlFor="study-code">Study code</label>
        <input id="study-code" className="study-code" autoComplete="off" autoCapitalize="characters" spellCheck={false}
          placeholder="Enter your code" value={code} onChange={(event) => setCode(event.target.value)} maxLength={96} required />
        <button className="button primary wide" type="submit" disabled={busy || !code.trim()}>{busy ? "Opening studio…" : "Continue"}</button>
      </>}
      {step === "consent" && <>
        <div className="consent-copy" tabIndex={0}>{settings?.consentText || "Your researcher will provide the study information and approved consent text here."}</div>
        {settings?.consentReady && <label className="checkbox-field"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> I have reviewed the study information and agree to participate.</label>}
        {settings?.consentReady && <button className="button primary wide" type="submit" disabled={!accepted || busy}>Continue to profile</button>}
      </>}
      {step === "profile" && <>
        <label className="form-field">Primary musical role<select value={role} onChange={(event) => setRole(event.target.value as Role)} required>
          <option value="">Choose a role</option>{ROLES.map((entry) => <option key={entry}>{entry}</option>)}
        </select></label>
        {fields.includes("roles") && <fieldset className="role-field"><legend>Additional musical roles</legend><div className="role-options">
          {ROLES.filter((entry) => entry !== role).map((entry) => <label key={entry} className="choice-chip">
            <input type="checkbox" checked={roles.includes(entry)} onChange={(event) => setRoles(event.target.checked ? [...roles, entry] : roles.filter((item) => item !== entry))} />{entry}
          </label>)}
        </div></fieldset>}
        {fields.some((field) => ["experience", "status", "genres", "tools"].includes(field)) && <div className="profile-grid">
          {fields.includes("experience") && <label className="form-field">Years of experience<input name="experience" type="number" min="0" max="100" /></label>}
          {fields.includes("status") && <label className="form-field">Musical status<select name="status"><option value="">Choose an option</option><option>Professional</option><option>Student</option><option>Hobbyist</option></select></label>}
          {fields.includes("genres") && <label className="form-field">Genres<input name="genres" maxLength={300} /></label>}
          {fields.includes("tools") && <label className="form-field">Existing creative tools<input name="tools" maxLength={500} /></label>}
        </div>}
        {fields.includes("aiExperience") && <label className="form-field">Prior generative AI experience<select name="aiExperience">
          <option value="">Choose an option</option><option>None</option><option>Occasional</option><option>Regular</option><option>Extensive</option>
        </select></label>}
        <button className="button primary wide" type="submit" disabled={busy || !role}>{busy ? "Saving profile…" : "Open creative workspace"}</button>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
    {step === "join" && <div className="gate-note"><CircleHelp size={14} /> Use the code provided by your study researcher.</div>}
  </div>;
}
