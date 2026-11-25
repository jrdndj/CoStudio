"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AudioLines, BookOpen, Check, ChevronDown, Circle, Clock3, Columns2, Compass, FileText, GitBranch, History,
  Image as ImageIcon, Layers, Lightbulb, MessageSquarePlus, Music2, NotebookPen, Pencil, Plus,
  RefreshCw, Save, Send, Sparkles, Upload as UploadIcon, UserRound, X,
} from "lucide-react";
import { SketchPad, WorkflowEditor, normalizeWorkflow } from "./Modules";
import { backendNames, errorMessage, type StudyAction } from "@/lib/study-client";
import {
  ROLES, STAGES, OUTPUT_TYPES, type Artefact, type Decision, type Mode, type OutputType,
  type PromptSource, type Role, type Stage, type StudyState, type Suggestion, type WorkflowGraph,
} from "@/lib/study-types";

const modeInfo = {
  guide: { name: "Guide me", detail: "Questions, hints, and creative constraints.", icon: Compass },
  collaborate: { name: "Collaborate with me", detail: "Explore and compare possible directions.", icon: Sparkles },
  lead: { name: "Take the lead", detail: "Start from a draft you can reshape.", icon: AudioLines },
  independent: { name: "Work independently", detail: "Create manually without AI generation.", icon: Music2 },
};

const outputInfo = {
  text: { name: "Text suggestion", icon: FileText },
  workflow: { name: "Workflow map", icon: GitBranch },
  storyboard: { name: "Storyboard", icon: Layers },
  moodboard: { name: "Moodboard", icon: ImageIcon },
  concept: { name: "Concept sketch", icon: Pencil },
};

const actions = [
  { id: "accept", label: "Accept", icon: Check },
  { id: "adapt", label: "Adapt", icon: Pencil },
  { id: "reject", label: "Reject", icon: X },
  { id: "alternatives", label: "Alternatives", icon: RefreshCw },
  { id: "save", label: "Save for later", icon: Save },
] as const;
const decisionLabel: Record<Decision, string> = {
  accept: "Accepted", adapt: "Adapted", reject: "Rejected", alternatives: "Alternatives requested", save: "Saved for later",
};

const alternativesPrompt = "Offer alternative directions for this idea that I can compare.";

const guestSuggestions = [
  "Explore a different direction for an unfinished idea.",
  "Try a creative constraint for a new arrangement.",
  "Map a workflow for a recording session.",
];

const historyNames: Record<string, string> = {
  ROLE_SELECTED: "Selected a musical role", CREATIVE_STAGE_SELECTED: "Changed creative stage",
  MODE_CHANGED: "Changed collaboration mode", PROMPT_SELECTED: "Selected a prompt",
  PROMPT_EDITED: "Edited a prompt", PROMPT_SUBMITTED: "Submitted a prompt",
  GENERATION_COMPLETED: "Generation completed", GENERATION_FAILED: "Generation failed",
  ARTEFACT_ACCEPTED: "Accepted an artefact", ARTEFACT_ADAPTED: "Adapted an artefact",
  ARTEFACT_REJECTED: "Rejected an artefact", ALTERNATIVES_REQUESTED: "Requested alternatives",
  ANNOTATION_CREATED: "Added an annotation", SKETCH_UPLOADED: "Added a sketch",
  WORKFLOW_UPDATED: "Updated workflow", DIARY_SUBMITTED: "Wrote a diary entry",
  QUESTIONNAIRE_COMPLETED: "Submitted a questionnaire",
};

function timestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function Workspace({ state, invoke, active, gate, hideLeft, hideRight, openDiary }: {
  state: StudyState | null; invoke: StudyAction; active: boolean; gate: ReactNode;
  hideLeft: boolean; hideRight: boolean; openDiary: (id?: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [type, setType] = useState<OutputType>("text");
  const [style, setStyle] = useState("");
  const [parentId, setParentId] = useState<string>();
  const [selectedId, setSelectedId] = useState("");
  const [compareId, setCompareId] = useState("");
  const [tab, setTab] = useState<"canvas" | "versions" | "sketch">("canvas");
  const [sketchId, setSketchId] = useState("");
  const [reflection, setReflection] = useState("");
  const [annotation, setAnnotation] = useState("");
  const [adaptText, setAdaptText] = useState("");
  const [adaptGraph, setAdaptGraph] = useState<WorkflowGraph>();
  const [adapting, setAdapting] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const participant = state?.participant;
  const artefacts = state?.artefacts ?? [];
  const current = artefacts.find((item) => item.id === selectedId) ?? artefacts[0];
  const compare = artefacts.find((item) => item.id === compareId);
  const sketches = state?.uploads.filter((item) => item.purpose === "sketch") ?? [];
  const uploaded = sketches.find((item) => item.id === sketchId) ?? sketches[0];
  const mode = participant?.mode;
  const isVisual = type === "storyboard" || type === "moodboard" || type === "concept";
  const suggestions = state?.settings.suggestions.filter((item) =>
    item.role === participant?.activeRole && item.stage === participant?.stage) ?? [];
  const activity = state?.events.filter((event) => historyNames[event.type]).slice(0, 12) ?? [];

  useEffect(() => {
    if (!active) {
      setPrompt(""); setSuggestion(null); setParentId(undefined); setSelectedId(""); setCompareId("");
      setTab("canvas"); setSketchId(""); setReflection(""); setAnnotation(""); setAdapting(false);
      setError(""); setNotice("");
    }
  }, [active]);

  async function perform<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
    setError(""); setNotice(""); setBusy(label);
    try { return await work(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(""); }
  }

  function changeRole(role: Role) {
    void perform("selection", () => invoke("select", { role }));
  }

  function changeStage(stage: Stage) {
    void perform("selection", () => invoke("select", { stage }));
  }

  async function useSuggestion(item: Suggestion) {
    if (!active) return;
    const saved = await perform("prompt", () => invoke("prompt", { kind: "selected", suggestionId: item.id, text: item.text }));
    if (saved) {
      setSuggestion(item); setPrompt(item.text); setParentId(undefined); setTab("canvas");
      promptInput.current?.focus();
    }
  }

  async function selectArtefact(id: string, comparison = false) {
    setError(""); setNotice("");
    if (comparison) setCompareId(id);
    else {
      setSelectedId(id); setReflection(""); setAnnotation(""); setAdapting(false); setTab("canvas");
      if (id === compareId) setCompareId("");
    }
    if (id) {
      try { await invoke("view", { artefactId: id }); }
      catch (cause) { setError(errorMessage(cause)); }
    }
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode || mode === "independent" || !prompt.trim()) return;
    const trimmed = prompt.trim();
    const promptSource: PromptSource = !suggestion ? "original" : trimmed === suggestion.text ? "suggested" : "modified";
    const result = await perform("generation", async () => {
      if (promptSource === "modified") await invoke("prompt", { kind: "edited", text: trimmed, suggestionId: suggestion?.id });
      return invoke("generate", {
        prompt: trimmed, promptSource, suggestionId: suggestion?.id, outputType: type, parentId, style: isVisual ? style : undefined,
        variations: Boolean(parentId && trimmed === alternativesPrompt),
      });
    });
    if (result) {
      const created = result.artefact ?? result.artefacts[0];
      if (created) await selectArtefact(created.id);
      setPrompt(""); setSuggestion(null); setParentId(undefined);
    }
  }

  function populateRevision(artefact: Artefact, alternatives = false) {
    setParentId(artefact.id); setSuggestion(null); setType(artefact.outputType);
    setTab("canvas");
    setPrompt(alternatives ? alternativesPrompt : "");
    requestAnimationFrame(() => promptInput.current?.focus());
  }

  async function decide(decision: Decision) {
    if (!current) return;
    if (decision === "adapt") {
      setAdapting(true); setAdaptText(current.text); setAdaptGraph(current.workflow ?? undefined);
      return;
    }
    const saved = await perform("decision", () => invoke("decision", { artefactId: current.id, decision, reflection }));
    if (saved) {
      setReflection(""); setNotice(decisionLabel[decision]);
      if (decision === "alternatives") populateRevision(current, true);
    }
  }

  async function saveAdaptation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    const contentChanged = adaptText.trim() !== current.text || adaptGraph !== (current.workflow ?? undefined);
    const saved = await perform("adaptation", () => invoke("decision", {
      artefactId: current.id, decision: "adapt", reflection,
      ...(contentChanged ? { text: adaptText.trim(), workflow: adaptGraph } : {}),
    }));
    if (saved) {
      setAdapting(false); setReflection("");
      if (saved.artefact && saved.artefact.id !== current.id) await selectArtefact(saved.artefact.id);
      setNotice("Adaptation saved");
    }
  }

  async function saveAnnotation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !annotation.trim()) return;
    const saved = await perform("annotation", () => invoke("annotate", { artefactId: current.id, text: annotation.trim() }));
    if (saved) { setAnnotation(""); setNotice("Annotation saved"); }
  }

  async function saveSketch(dataUrl: string, name = "Participant sketch.png") {
    const saved = await perform("sketch", () => invoke("upload", { name, dataUrl, purpose: "sketch" }));
    if (saved?.upload) { setSketchId(saved.upload.id); setNotice("Sketch saved"); }
  }

  async function uploadSketch(file: File) {
    const maximum = state?.settings.maxImageBytes ?? 3145728;
    if (file.size > maximum) { setError(`Choose an image smaller than ${Math.floor(maximum / 1048576 * 10) / 10} MB.`); return; }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("The selected file could not be read."));
        reader.readAsDataURL(file);
      });
      await saveSketch(data, file.name);
    } catch (cause) { setError(errorMessage(cause)); }
  }

  const OutputIcon = outputInfo[type].icon;
  return <div className={`workspace-grid ${hideLeft ? "left-closed" : ""} ${hideRight ? "right-closed" : ""}`}>
    {!hideLeft && <aside className="settings-panel" aria-label="Studio settings">
      <div className="pane-title"><div className="pane-icon"><Compass size={17} /></div><div><h2>Session setup</h2><p>Shape this creative activity</p></div></div>
      <fieldset disabled={!active || Boolean(busy)} className="settings-block">
        <label className="form-field small-label" htmlFor="active-role"><UserRound size={15} /> Active musical role</label>
        <div className="select-wrap"><select id="active-role" value={participant?.activeRole || ""} onChange={(event) => changeRole(event.target.value as Role)}>
          <option value="" disabled>Choose a role</option>
          {(participant?.role ? [...new Set([participant.role, ...participant.roles])] : ROLES).map((role) => <option key={role}>{role}</option>)}
        </select><ChevronDown size={15} aria-hidden="true" /></div>
      </fieldset>
      <fieldset disabled={!active || Boolean(busy)} className="settings-block">
        <legend className="form-field small-label"><Circle size={14} /> Creative stage</legend>
        <div className="stage-grid">{STAGES.map((stage) => <button key={stage} type="button" aria-pressed={active ? participant?.stage === stage : undefined}
          onClick={() => changeStage(stage)}>{stage}</button>)}</div>
      </fieldset>
      <div className="pane-separator" />
      <fieldset disabled={!active || Boolean(busy)} className="settings-block modes">
        <legend className="form-field small-label"><Sparkles size={15} /> AI collaboration</legend>
        {(state?.settings.allowedModes ?? Object.keys(modeInfo) as Mode[]).map((choice) => {
          const option = modeInfo[choice];
          return <label key={choice} className="mode-option" data-selected={mode === choice}>
            <input type="radio" name="collaboration" value={choice} checked={mode === choice}
              onChange={() => void perform("selection", () => invoke("select", { mode: choice }))} />
            <option.icon size={15} strokeWidth={1.9} /><span>{option.name}<small>{option.detail}</small></span>
          </label>;
        })}
      </fieldset>
      <div className="pane-separator" />
      <fieldset disabled={!active || Boolean(busy)} className="settings-block suggestions">
        <legend className="form-field small-label"><Lightbulb size={15} /> Suggested prompts</legend>
        {active ? suggestions.length ? suggestions.map((item) => <button type="button" key={item.id} onClick={() => void useSuggestion(item)}>
          <span>{item.text}</span><Plus size={14} /></button>)
          : <p className="muted">No prompts are configured for this role and stage.</p>
          : guestSuggestions.map((item) => <button type="button" key={item}><span>{item}</span><Plus size={14} /></button>)}
      </fieldset>
    </aside>}

    <section className="canvas-panel" aria-label="Creative canvas">
      <div className="canvas-bar">
        <div className="canvas-tabs" role="group" aria-label="Canvas views">
          <button type="button" className={tab === "canvas" ? "active" : ""} aria-pressed={tab === "canvas"} disabled={!active} onClick={() => setTab("canvas")}><Layers size={16} /> Canvas</button>
          <button type="button" className={tab === "versions" ? "active" : ""} aria-pressed={tab === "versions"} disabled={!active} onClick={() => setTab("versions")}><History size={16} /> Versions {artefacts.length > 0 && <span>{artefacts.length}</span>}</button>
          <button type="button" className={tab === "sketch" ? "active" : ""} aria-pressed={tab === "sketch"} disabled={!active} onClick={() => setTab("sketch")}><Pencil size={16} /> Sketches</button>
        </div>
        <span className="canvas-mark"><span /> {active ? "Private workspace" : "Study workspace"}</span>
      </div>

      <div className={`canvas-surface ${!active || (!current && tab === "canvas") ? "canvas-centered" : ""}`}>
        {!active ? gate : <>
          {tab === "canvas" && (!current ? <div className="canvas-empty">
            <div className="signal small-signal" aria-hidden="true"><div className="signal-ring outer" /><div className="signal-ring inner" /><div className="signal-core"><AudioLines size={32} strokeWidth={1.55} /></div></div>
            <h2>Start with an idea</h2><p>Choose a collaboration mode and make a prompt your own, or open Sketches to work directly on the canvas.</p>
            <button className="button" type="button" onClick={() => setTab("sketch")}><Pencil size={16} /> Open sketch tools</button>
          </div> : <div className={`artefact-area ${compare ? "compare-layout" : ""}`}>
            <ArtefactCard item={current} editedWorkflow={adapting ? adaptGraph : undefined} onWorkflowChange={adapting ? setAdaptGraph : undefined} />
            {compare && compare.id !== current.id && <div className="compare-side"><button type="button" className="button quiet close-compare" onClick={() => setCompareId("")}><X size={16} /> Close comparison</button><ArtefactCard item={compare} /></div>}
            {artefacts.length > 1 && !compare && <label className="comparison-control">
              <Columns2 size={16} /> Compare versions
              <select value="" onChange={(event) => void selectArtefact(event.target.value, true)} aria-label="Version to compare">
                <option value="" disabled>Choose an earlier or revised artefact</option>
                {artefacts.filter((item) => item.id !== current.id).map((item) => <option key={item.id} value={item.id}>{item.title} · {timestamp(item.createdAt)}</option>)}
              </select>
            </label>}
          </div>)}
          {tab === "versions" && <div className="canvas-content">
            <h2>Artefact versions</h2><p className="muted">Revisions stay linked to the contribution they build on.</p>
            {artefacts.length === 0 && <p>No artefacts yet.</p>}
            <div className="version-list">{artefacts.map((item) => <button type="button" key={item.id} onClick={() => void selectArtefact(item.id)}>
              <span className={`origin-tag ${item.origin}`}>{item.origin === "human" ? "Participant" : item.backend === "WIZARD" ? "Researcher" : "AI"}</span>
              <span><strong>{item.title}</strong><small>{item.parentId ? `Revision of ${artefacts.find((parent) => parent.id === item.parentId)?.title ?? "earlier artefact"}` : "Original version"}</small></span>
              <time dateTime={item.createdAt}>{timestamp(item.createdAt)}</time>
            </button>)}</div>
          </div>}
          {tab === "sketch" && <div className="canvas-content">
            <h2>Participant sketches</h2><p className="muted">Make a new sketch or upload one you have already created.</p>
            <SketchPad label="Draw a participant sketch" disabled={Boolean(busy)} onSave={saveSketch} />
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1}
              onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void uploadSketch(file); event.currentTarget.value = ""; }} />
            <button className="button sketch-upload" type="button" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}><UploadIcon size={16} /> Upload an image</button>
            {uploaded && <div className="saved-sketch">
              <label className="form-field">Saved sketch<select value={uploaded.id} onChange={(event) => setSketchId(event.target.value)}>
                {sketches.map((sketch) => <option key={sketch.id} value={sketch.id}>{sketch.name} · {timestamp(sketch.createdAt)}</option>)}
              </select></label>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={uploaded.dataUrl} alt={uploaded.name} />
            </div>}
          </div>}
        </>}
      </div>

      {error && <p className="workspace-message form-error" role="alert">{error}</p>}
      {notice && <p className="workspace-message success-note" role="status"><Check size={16} />{notice}</p>}
      {active && tab === "canvas" && mode !== "independent" && <form className="composer" onSubmit={generate}>
        {parentId && <div className="revision-label"><GitBranch size={15} /> Revising {artefacts.find((item) => item.id === parentId)?.title || "an earlier artefact"}
          <button className="icon-button" type="button" aria-label="Cancel revision" onClick={() => setParentId(undefined)}><X size={15} /></button></div>}
        <label className="form-field" htmlFor="creative-prompt">Creative prompt</label>
        <textarea id="creative-prompt" ref={promptInput} value={prompt} onChange={(event) => setPrompt(event.target.value)}
          maxLength={8000} rows={3} placeholder="What are you working on? Describe an idea or make a suggested prompt your own." />
        <div className="composer-controls">
          <label className="type-picker"><OutputIcon size={16} /><span className="sr-only">Output type</span>
            <select value={type} onChange={(event) => setType(event.target.value as OutputType)}>
              {OUTPUT_TYPES.map((key) => <option key={key} value={key}>{outputInfo[key].name}</option>)}
            </select><ChevronDown size={14} /></label>
          {isVisual && <input className="style-input" aria-label="Visual style" value={style} onChange={(event) => setStyle(event.target.value)} maxLength={200} placeholder="Visual style (optional)" />}
          <button className="button primary generate-button" type="submit" disabled={!mode || !prompt.trim() || Boolean(busy)}>
            {busy === "generation" ? <RefreshCw size={16} /> : <Send size={16} />} {busy === "generation" ? "Generating…" : state?.settings.backend === "WIZARD" ? "Send request" : "Generate"}
          </button>
        </div>
        {!mode && <p className="muted composer-hint">Select a collaboration mode to generate an artefact.</p>}
      </form>}
      {active && tab === "canvas" && mode === "independent" && <div className="independent-bar">
        <Music2 size={17} /><span>Working independently</span><button className="button" type="button" onClick={() => setTab("sketch")}><Pencil size={15} /> Sketch</button>
        <button className="button" type="button" onClick={() => openDiary(current?.id)}><BookOpen size={15} /> Write in diary</button>
      </div>}
      {!active && <div className="canvas-footer"><span><UserRound size={14} /> Your creative work</span><span><Sparkles size={14} /> AI contributions</span></div>}
    </section>

    {!hideRight && <aside className="history-panel" aria-label="Interaction history">
      <div className="pane-title"><div className="pane-icon teal"><History size={17} /></div><div><h2>Interaction history</h2><p>Review activity and decisions</p></div></div>
      {active && current && current.status === "completed" && <section className="decision-section">
        <div className="form-field small-label"><Sparkles size={15} /> Artefact decision</div>
        {current.decision && <p className="decision-status"><Check size={14} /> {decisionLabel[current.decision]}</p>}
        {current.reflection && <blockquote>{current.reflection}</blockquote>}
        <label className="form-field"><span className="sr-only">Optional decision reflection</span><textarea placeholder="Why did you make this choice? (optional)" rows={3}
          value={reflection} onChange={(event) => setReflection(event.target.value)} maxLength={3000} /></label>
        <div className="decisions">{actions.map(({ id, label, icon: Icon }) => <button className="button" key={id} type="button" disabled={Boolean(busy)} onClick={() => void decide(id)}><Icon size={15} />{label}</button>)}</div>
        {adapting && <form onSubmit={saveAdaptation} className="adapt-form">
          <label className="form-field">Your adaptation<textarea rows={5} value={adaptText} onChange={(event) => setAdaptText(event.target.value)} maxLength={15000} /></label>
          {current.workflow && <p className="muted">Use the canvas to edit activities and connections.</p>}
          <div className="button-row"><button type="submit" className="button primary" disabled={Boolean(busy)}>Save adaptation</button><button type="button" className="button quiet" onClick={() => setAdapting(false)}>Cancel</button></div>
        </form>}
        <button type="button" className="button quiet revise-button" disabled={Boolean(busy) || !mode || mode === "independent"} onClick={() => populateRevision(current)}><RefreshCw size={15} /> Write a revision prompt</button>
        <form className="annotation-form" onSubmit={saveAnnotation}>
          <label className="form-field">Participant annotations<textarea rows={3} value={annotation} onChange={(event) => setAnnotation(event.target.value)}
            maxLength={3000} placeholder="Add a note about this artefact" /></label>
          <button className="button" type="submit" disabled={!annotation.trim() || Boolean(busy)}><MessageSquarePlus size={15} /> Add annotation</button>
        </form>
        {current.annotations.map((item) => <blockquote key={item.id}>{item.text}<time dateTime={item.createdAt}>{timestamp(item.createdAt)}</time></blockquote>)}
      </section>}
      <section className="timeline-section">
        <div className="form-field small-label"><Clock3 size={15} /> Session activity</div>
        {active && activity.length ? <ol className="timeline">{activity.map((item) => <li key={item.id}>
          <span className="timeline-dot" />
          {item.artefactId
            ? <button type="button" onClick={() => void selectArtefact(item.artefactId!)}>{historyNames[item.type]}</button>
            : <span>{historyNames[item.type]}</span>}
          <time dateTime={item.createdAt}>{timestamp(item.createdAt)}</time>
        </li>)}</ol> : <div className="empty-history"><span className="empty-history-icon"><MessageSquarePlus size={20} strokeWidth={1.7} /></span>
          <strong>No activity yet</strong><p>Prompts, outputs, and your decisions will appear here.</p></div>}
      </section>
      <div className="reflection-shortcut"><NotebookPen size={19} /><div><strong>Make time to reflect</strong><p>Capture a moment in your creative diary.</p>
        <button type="button" className="button" disabled={!active} onClick={() => openDiary(current?.id)}><BookOpen size={15} /> Write a diary entry</button></div></div>
    </aside>}
  </div>;
}

function ArtefactCard({ item, editedWorkflow, onWorkflowChange }: {
  item: Artefact; editedWorkflow?: WorkflowGraph; onWorkflowChange?: (graph: WorkflowGraph) => void;
}) {
  const Icon = outputInfo[item.outputType].icon;
  return <article className="artefact-card">
    <div className="artefact-meta">
      <span className={`origin-tag ${item.origin}`}>{item.origin === "human" ? <><UserRound size={13} /> Participant</> : <><Sparkles size={13} /> {item.backend === "MOCK" ? "AI simulation" : item.backend === "WIZARD" ? "Researcher contribution" : "AI contribution"}</>}</span>
      <span><Icon size={14} /> {outputInfo[item.outputType].name}</span>
      <time dateTime={item.createdAt}>{timestamp(item.createdAt)}</time>
    </div>
    <h2>{item.title}</h2>
    {item.status === "pending" && <p role="status">This request is awaiting a response{item.backend === "WIZARD" ? " from the researcher" : ""}.</p>}
    {item.status === "failed" && <p className="form-error" role="status">Generation failed on the {item.backend !== "MANUAL" ? backendNames[item.backend] : "manual"} backend.</p>}
    {item.status === "completed" && <>
      {item.imageUrl && <figure>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.imageUrl} alt={item.title} />
      </figure>}
      {item.text && <div className="artefact-text">{item.text}</div>}
      {item.workflow && <WorkflowEditor graph={editedWorkflow ?? normalizeWorkflow(item.workflow)} onChange={onWorkflowChange} label={onWorkflowChange ? "Edit the workflow map" : "Workflow map"} height={380} />}
      {item.prompt && <details><summary>Participant prompt</summary><p>{item.prompt}</p></details>}
    </>}
  </article>;
}
