"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, Check, ChevronDown, ClipboardList, GitBranch, ImagePlus, Layers, PencilLine, Save, Sparkles, Upload as UploadIcon } from "lucide-react";
import type { Artefact, DiaryAnswers, Questionnaire, QuestionnaireItem, StudyState, WorkflowGraph, WorkflowSnapshot } from "../lib/study-types";
import { SketchPad, readImageFile } from "./SketchPad";
import { WorkflowDownloads, WorkflowEditor, normalizeWorkflow } from "./WorkflowEditor";
import "./modules.css";

export { SketchPad, readImageFile, normalizeWorkflow, WorkflowEditor, WorkflowDownloads };
export type { WorkflowGraph } from "../lib/study-types";

export type ModuleProps = {
  state: StudyState;
  invoke: (action: string, payload?: Record<string, unknown>) => Promise<StudyState | void>;
  artefactId?: string;
};

const timingLabels = { activity: "After an activity", session: "After a session", deployment: "After the deployment" };
const noDiagram: WorkflowGraph = { nodes: [], edges: [] };
const emptyAnswers: DiaryAnswers = { goal: "", usedAI: "", why: "", changes: "", intention: "", differently: "" };

function timestamp(date: string) {
  return new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "The changes could not be saved. Try again.";
}

function Feedback({ error, confirm }: { error: string; confirm?: string }) {
  if (error) return <div className="module-feedback module-error" role="alert">{error}</div>;
  if (confirm) return <div className="module-feedback module-confirmation" role="status"><Check size={17} /> {confirm}</div>;
  return null;
}

function ArtefactPicker({ artefacts, value, onChange, disabled }: {
  artefacts: Artefact[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return <label className="form-field">Related artefact <small>Optional</small><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
    <option value="">No related artefact</option>
    {artefacts.filter(({ status }) => status === "completed").map((item) => <option key={item.id} value={item.id}>{item.title} · {timestamp(item.createdAt)}</option>)}
  </select></label>;
}

export function WorkflowModule({ state, invoke }: ModuleProps) {
  const newest = state.workflows[0];
  const [graph, setGraph] = useState<WorkflowGraph>(() => newest ? normalizeWorkflow(newest) : noDiagram);
  const [title, setTitle] = useState(newest?.title || "My creative workflow");
  const [base, setBase] = useState(newest?.id || "");
  const [busy, setBusy] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function load(snapshot?: WorkflowSnapshot) {
    setBase(snapshot?.id || "");
    setTitle(snapshot?.title || "My creative workflow");
    setGraph(snapshot ? normalizeWorkflow(snapshot) : noDiagram);
    setEditorKey((current) => current + 1);
    setNotice("");
    setError("");
  }

  async function saveSnapshot() {
    setError("");
    setNotice("");
    const cleanTitle = title.trim();
    if (!cleanTitle || !graph.nodes.length) { setError("Add a title and at least one activity before saving."); return; }
    if (graph.nodes.some((node) => !node.data.label.trim())) { setError("Give each activity a name before saving."); return; }
    setBusy(true);
    try {
      const result = await invoke("workflow", { ...graph, title: cleanTitle });
      if (result?.workflows[0]) setBase(result.workflows[0].id);
      setNotice("Workflow snapshot saved.");
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  return <div className="module-screen workflow-module">
    <section className="panel module-card module-intro">
      <div className="module-section-icon"><GitBranch size={20} /></div>
      <div><h2>Map your creative process</h2><p>Turn activities into a workflow and record where you’d welcome AI involvement. Save a snapshot whenever you want to capture your current preferences.</p></div>
    </section>
    <section className="panel module-card" aria-label="Workflow editor">
      <div className="module-heading-row workflow-title-row">
        <label className="form-field">Workflow title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required /></label>
        <WorkflowDownloads graph={graph} title={title} onError={setError} />
      </div>
      <WorkflowEditor key={editorKey} graph={graph} onChange={setGraph} />
      <div className="module-toolbar module-submit-row"><button className="button primary" type="button" onClick={() => void saveSnapshot()} disabled={busy || !graph.nodes.length}><Save size={16} /> {busy ? "Saving snapshot…" : "Save snapshot"}</button></div>
      <Feedback error={error} confirm={notice} />
    </section>
    <section className="panel module-card">
      <div className="module-heading-row"><div><h2>Saved snapshots</h2><p>Open a snapshot to continue editing. Each save creates a new record.</p></div><button type="button" className="button" onClick={() => load()}>New workflow</button></div>
      {state.workflows.length ? <ul className="module-records">{state.workflows.map((snapshot) => <li key={snapshot.id}><Layers size={18} aria-hidden="true" /><div><strong>{snapshot.title}</strong><small>{snapshot.nodes.length} {snapshot.nodes.length === 1 ? "activity" : "activities"} · {timestamp(snapshot.createdAt)}</small></div><button type="button" className="button" onClick={() => load(snapshot)}>{base === snapshot.id ? "Reload" : "Open"}</button></li>)}</ul> : <p className="module-empty-copy">Saved versions will appear here.</p>}
    </section>
  </div>;
}

export function DiaryModule({ state, invoke, artefactId: initialArtefactId }: ModuleProps) {
  const [answers, setAnswers] = useState<DiaryAnswers>(emptyAnswers);
  const [artefactId, setArtefactId] = useState(initialArtefactId || "");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [savedAttachmentId, setSavedAttachmentId] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function edit(key: keyof DiaryAnswers, value: string) {
    setAnswers((previous) => ({ ...previous, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!answers.goal.trim() || !answers.usedAI || !answers.why.trim() || !answers.intention.trim()) { setError("Answer the required diary questions before saving."); return; }
    setBusy(true);
    try {
      let attachmentId = savedAttachmentId;
      if (attachment && !attachmentId) {
        const result = await invoke("upload", { name: attachment.name, dataUrl: await readImageFile(attachment, state.settings.maxImageBytes), purpose: "diary" });
        if (!result?.upload?.id) throw new Error("The attachment was not saved. Try uploading it again.");
        attachmentId = result.upload.id;
        setSavedAttachmentId(attachmentId);
      }
      await invoke("diary", { answers, ...(artefactId ? { artefactId } : {}), ...(attachmentId ? { attachmentId } : {}) });
      setAnswers(emptyAnswers);
      setArtefactId("");
      setAttachment(null);
      setSavedAttachmentId("");
      setFileInputKey((previous) => previous + 1);
      setNotice("Diary entry saved.");
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  const fields = [
    ["why", "Why did you use or choose not to use AI?", true],
    ["changes", "What did you keep, modify or reject?", false],
    ["intention", "Did the resulting work reflect your creative intentions?", true],
    ["differently", "What would you want the AI or creative environment to do differently?", false],
  ] as const;

  return <div className="module-screen diary-module">
    <section className="panel module-card module-intro"><div className="module-section-icon"><BookOpen size={20} /></div><div><h2>Reflect on a creative activity</h2><p>Take about two minutes to record what you tried and how it went. You can reflect on work with or without AI.</p></div></section>
    <form className="panel module-card module-form" onSubmit={submit}>
      <h2>New diary entry</h2>
      <label className="form-field">What were you trying to accomplish?<textarea rows={3} value={answers.goal} onChange={(event) => edit("goal", event.target.value)} required maxLength={4000} /></label>
      <fieldset className="module-fieldset"><legend>Did you use AI during this activity?</legend><div className="module-radio-row">
        {["Yes", "No"].map((label) => <label className="module-radio" key={label}><input type="radio" name="diary-used-ai" value={label} checked={answers.usedAI === label} onChange={() => edit("usedAI", label)} required />{label}</label>)}
      </div></fieldset>
      <div className="module-form-grid">{fields.map(([key, label, required]) => <label className="form-field" key={key}>{label}{!required && <small>Optional</small>}<textarea rows={3} value={answers[key]} onChange={(event) => edit(key, event.target.value)} maxLength={4000} required={required} /></label>)}</div>
      <div className="module-form-grid diary-links">
        <ArtefactPicker artefacts={state.artefacts} value={artefactId} onChange={setArtefactId} disabled={busy} />
        <label className="form-field">Image, screenshot or sketch <small>Optional</small><input key={fileInputKey} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setAttachment(event.target.files?.[0] || null); setSavedAttachmentId(""); }} disabled={busy} /></label>
      </div>
      <div className="module-toolbar module-submit-row"><button type="submit" className="button primary" disabled={busy}><Save size={16} /> {busy ? "Saving entry…" : "Save diary entry"}</button></div>
      <Feedback error={error} confirm={notice} />
    </form>
    <section className="panel module-card">
      <div className="module-heading-row"><div><h2>Past entries</h2><p>Review your earlier reflections.</p></div></div>
      {state.diary.length ? <div className="module-disclosures">{state.diary.map((entry) => {
        const attachment = state.uploads.find((item) => item.id === entry.attachmentId);
        const related = state.artefacts.find((item) => item.id === entry.artefactId);
        return <details key={entry.id}><summary><span><strong>{entry.answers.goal}</strong><small>{timestamp(entry.createdAt)} · Used AI: {entry.answers.usedAI}</small></span><ChevronDown size={18} aria-hidden="true" /></summary><div className="module-disclosure-body">
          <dl>{fields.map(([key, label]) => entry.answers[key] && <div key={key}><dt>{label}</dt><dd>{entry.answers[key]}</dd></div>)}</dl>
          {related && <p>Related artefact: {related.title}</p>}
          {attachment && <img className="diary-attachment" src={attachment.dataUrl} alt={`Diary attachment: ${attachment.name}`} />}
        </div></details>;
      })}</div> : <p className="module-empty-copy">Your reflections will appear here after you save them.</p>}
    </section>
  </div>;
}

export function FutureModule({ state, invoke }: ModuleProps) {
  const proposal = state.future;
  const [description, setDescription] = useState(proposal?.description || "");
  const [acceptable, setAcceptable] = useState(proposal?.acceptable || "");
  const [unacceptable, setUnacceptable] = useState(proposal?.unacceptable || "");
  const [sketchId, setSketchId] = useState(proposal?.sketchId || state.uploads.find((item) => item.purpose === "future")?.id || "");
  const [unlinkedImageId, setUnlinkedImageId] = useState("");
  const [style, setStyle] = useState("");
  const [revision, setRevision] = useState("");
  const [annotation, setAnnotation] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const viewed = useRef("");
  const sketch = state.uploads.find((item) => item.id === sketchId);
  const image = state.artefacts.find((item) => item.id === (unlinkedImageId || proposal?.artefactId));
  const mode = state.participant?.mode;
  const canGenerate = Boolean(mode && mode !== "independent");
  const isPending = image?.status === "pending";
  const fieldsUnchanged = proposal && description.trim() === proposal.description && acceptable.trim() === proposal.acceptable && unacceptable.trim() === proposal.unacceptable && sketchId === (proposal.sketchId || "");

  useEffect(() => {
    if (unlinkedImageId || !image || image.status !== "completed" || viewed.current === image.id) return;
    viewed.current = image.id;
    void invoke("view", { artefactId: image.id }).catch((error: unknown) => setError(message(error)));
  }, [image, invoke, unlinkedImageId]);

  async function run(kind: string, operation: () => Promise<void>) {
    setBusy(kind);
    setError("");
    setNotice("");
    try { await operation(); }
    catch (error) { setError(message(error)); }
    finally { setBusy(""); }
  }

  async function saveProposal(finalized: boolean, artefactId = image?.id, selectedSketchId = sketchId) {
    await invoke("future", { description, acceptable, unacceptable, sketchId: selectedSketchId || null, artefactId: artefactId || null, finalized });
    setUnlinkedImageId("");
  }

  async function attach(dataUrl: string, name: string) {
    const result = await invoke("upload", { name, dataUrl, purpose: "future" });
    if (!result?.upload?.id) throw new Error("The studio sketch could not be saved.");
    setSketchId(result.upload.id);
    if (description.trim()) await saveProposal(false, image?.id, result.upload.id);
    setNotice("Studio sketch saved.");
  }

  async function generate(revising: boolean) {
    await run("generate", async () => {
      const prompt = [
        revising ? "Revise this future music-making environment based on the participant’s feedback." : "Illustrate this future music-making environment as a studio design concept.",
        `Creative environment: ${description.trim()}`,
        acceptable.trim() ? `Acceptable AI behaviour: ${acceptable.trim()}` : "",
        unacceptable.trim() ? `Unacceptable AI behaviour: ${unacceptable.trim()}` : "",
        revising ? `Revision requested: ${revision.trim()}` : "",
      ].filter(Boolean).join("\n\n");
      const completed = await invoke("generate", {
        prompt, promptSource: "original", outputType: "concept",
        ...(style.trim() ? { style: style.trim() } : {}),
        ...(revising && image ? { parentId: image.id } : sketchId ? { referenceId: sketchId } : {}),
      });
      if (!completed?.artefact?.id) throw new Error("The server did not return an illustration record.");
      setUnlinkedImageId(completed.artefact.id);
      await saveProposal(false, completed.artefact.id);
      setRevision("");
      setNotice(completed.artefact.status === "pending" ? "Illustration request saved for researcher review." : "Illustration added to your proposal.");
    });
  }

  async function annotate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!image || !annotation.trim()) return;
    await run("annotate", async () => {
      await invoke("annotate", { artefactId: image.id, text: annotation.trim() });
      setAnnotation("");
      setNotice("Illustration annotation saved.");
    });
  }

  return <div className="module-screen future-module">
    <section className="panel module-card module-intro"><div className="module-section-icon"><Sparkles size={20} /></div><div><h2>Design your future studio</h2><blockquote>Imagine it is 2030. You have access to a music-making environment that can support your creative intentions. You decide what this environment looks like, when AI intervenes, how it communicates, and what it should never do.</blockquote></div></section>
    <div className="future-layout">
      <section className="panel module-card future-sketch-section"><div className="module-heading-row"><div><h2>Initial sketch</h2><p>Draw an idea or upload an image.</p></div><PencilLine size={18} aria-hidden="true" /></div>
        <SketchPad disabled={Boolean(busy)} label="Draw your future music-making environment" onSave={async (dataUrl) => {
          setBusy("upload");
          setError("");
          try { await attach(dataUrl, "future-studio-sketch.png"); }
          finally { setBusy(""); }
        }} />
        <label className="form-field future-upload"><span><UploadIcon size={16} /> Upload a sketch</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={Boolean(busy)} onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void run("upload", async () => attach(await readImageFile(file, state.settings.maxImageBytes), file.name));
        }} /></label>
        {sketch && <figure className="future-sketch-preview"><img src={sketch.dataUrl} alt="Saved sketch of your future studio" /><figcaption>{sketch.name}</figcaption></figure>}
      </section>
      <section className="panel module-card module-form"><div className="module-heading-row"><div><h2>Environment proposal</h2><p>Describe the space, tools, and interactions that would support your process.</p></div></div>
        <label className="form-field">What would it be like?<textarea rows={5} value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} placeholder="A physical studio, a desktop tool, a spatial interface, or another setting…" /></label>
        <label className="form-field">What may AI do?<textarea rows={3} value={acceptable} maxLength={1200} onChange={(event) => setAcceptable(event.target.value)} /></label>
        <label className="form-field">What should AI never do?<textarea rows={3} value={unacceptable} maxLength={1200} onChange={(event) => setUnacceptable(event.target.value)} /></label>
        <div className="module-toolbar">
          <button className="button" type="button" disabled={Boolean(busy) || !description.trim()} onClick={() => void run("save", async () => { await saveProposal(false); setNotice("Proposal draft saved."); })}>Save draft</button>
          <button className="button primary" type="button" disabled={Boolean(busy) || !description.trim() || Boolean(proposal?.finalized && fieldsUnchanged)} onClick={() => void run("final", async () => { await saveProposal(true); setNotice("Final environment proposal saved."); })}><Save size={16} /> {proposal?.finalized && fieldsUnchanged ? "Final proposal saved" : "Save final proposal"}</button>
        </div>
      </section>
    </div>
    <section className="panel module-card module-form"><div className="module-heading-row"><div><h2>Concept illustration</h2><p>Use AI to illustrate the proposal, then annotate or revise the result.</p></div><ImagePlus size={20} aria-hidden="true" /></div>
      {image?.imageUrl && <figure className="future-illustration"><img src={image.imageUrl} alt={image.title} /><figcaption>{image.title} · {image.backend} · {timestamp(image.createdAt)}</figcaption></figure>}
      {image?.text && image.status === "completed" && <p className="future-output-text">{image.text}</p>}
      {isPending && <div className="module-toolbar"><p role="status">Waiting for researcher review.</p><button type="button" className="button" disabled={Boolean(busy)} onClick={() => void run("refresh", async () => { await invoke("state"); })}>Check for response</button></div>}
      {image?.status === "failed" && <p className="module-error" role="alert">This illustration request failed. You can submit a new request below.</p>}
      {image?.status === "completed" && <form className="module-form future-annotation" onSubmit={annotate}>
        {!!image.annotations.length && <ul className="future-annotations">{image.annotations.map((item) => <li key={item.id}><p>{item.text}</p><small>{timestamp(item.createdAt)}</small></li>)}</ul>}
        <label className="form-field">Add an annotation<textarea rows={2} value={annotation} onChange={(event) => setAnnotation(event.target.value)} maxLength={3000} required /></label>
        <div><button type="submit" className="button" disabled={Boolean(busy) || !annotation.trim()}>Save annotation</button></div>
      </form>}
      {!canGenerate && <p className="module-empty-copy">Choose an AI collaboration mode in My Creative Workspace to request an illustration.</p>}
      {canGenerate && !isPending && <div className="module-form">
        {image?.status === "completed" && <label className="form-field">What should change in the illustration?<textarea value={revision} rows={2} maxLength={1200} onChange={(event) => setRevision(event.target.value)} /></label>}
        <label className="form-field">Visual style <small>Optional</small><input value={style} maxLength={140} onChange={(event) => setStyle(event.target.value)} placeholder="Architectural sketch, storyboard, or interface wireframe" /></label>
        {sketch && image?.status !== "completed" && <small className="module-empty-copy">The saved sketch will be included in your generation request.</small>}
        <div><button type="button" className="button primary" disabled={Boolean(busy) || !description.trim() || Boolean(image?.status === "completed" && !revision.trim())} onClick={() => void generate(image?.status === "completed")}><Sparkles size={16} /> {busy === "generate" ? "Requesting illustration…" : image?.status === "completed" ? "Request revision" : "Generate illustration"}</button></div>
      </div>}
      <Feedback error={error} confirm={notice} />
    </section>
  </div>;
}

function InstrumentItem({ item, value, change }: { item: QuestionnaireItem; value: string | number | undefined; change: (value: string | number) => void }) {
  const required = item.required !== false;
  if (item.type === "open") return <label className="form-field">{item.label}{required && <span className="module-required">Required</span>}<textarea value={value ?? ""} rows={3} maxLength={4000} required={required} onChange={(event) => change(event.target.value)} /></label>;
  if (item.type === "slider") {
    const min = item.min ?? 1;
    const max = item.max ?? 7;
    const step = item.step ?? 1;
    const midpoint = min + Math.floor((max - min) / (2 * step)) * step;
    return <fieldset className="module-fieldset instrument-item"><legend>{item.label}{required && <span className="module-required">Required</span>}</legend>
      <div className="instrument-range"><span>{min}</span><input type="range" aria-label={item.label} min={min} max={max} step={step} value={value ?? midpoint} onChange={(event) => change(event.target.valueAsNumber)} /><span>{max}</span></div>
      {value === undefined ? <button className="button" type="button" onClick={() => change(midpoint)}>Record {midpoint}</button> : <output aria-live="polite">Selected value: {value}</output>}
    </fieldset>;
  }
  const min = item.min ?? 1;
  const max = item.max ?? 7;
  const step = item.step ?? 1;
  const scale = Array.from({ length: Math.max(0, Math.min(51, Math.floor((max - min) / step + 1e-9) + 1)) }, (_, index) => Number((min + index * step).toFixed(10)));
  const options = item.type === "likert" ? scale : item.options ?? [];
  return <fieldset className="module-fieldset instrument-item"><legend>{item.label}{required && <span className="module-required">Required</span>}</legend><div className={`module-radio-row ${item.type === "choice" ? "instrument-choice" : ""}`}>
    {options.map((option, index) => <label className="module-radio" key={`${option}-${index}`}><input type="radio" name={`instrument-${item.id}`} value={option} checked={value === option} onChange={() => change(option)} required={required} />{item.type === "likert" ? item.options?.[index] ?? option : option}</label>)}
  </div></fieldset>;
}

function InstrumentForm({ instrument, state, invoke, artefactId: initialArtefactId }: ModuleProps & { instrument: Questionnaire }) {
  const [responses, setResponses] = useState<Record<string, string | number>>({});
  const [activity, setActivity] = useState("");
  const [artefactId, setArtefactId] = useState(initialArtefactId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const missing = instrument.items.find((item) => {
      const value = responses[item.id];
      return item.required !== false && (value === undefined || typeof value === "string" && !value.trim());
    });
    if (missing) { setError(`Please answer: ${missing.label}`); return; }
    setBusy(true);
    try {
      const values = Object.fromEntries(Object.entries(responses).filter(([, value]) => typeof value === "number" || value.trim()));
      await invoke("questionnaire", { instrumentId: instrument.id, version: instrument.version, responses: values, ...(activity.trim() ? { activity: activity.trim() } : {}), ...(artefactId ? { artefactId } : {}) });
      setResponses({});
      setActivity("");
      setArtefactId("");
      setNotice("Questionnaire submitted.");
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  return <form className="panel module-card module-form" onSubmit={submit}>
    <div className="module-heading-row"><div><h2>{instrument.name}</h2><p>{timingLabels[instrument.timing]} · {instrument.version}</p></div></div>
    {instrument.timing === "activity" && <div className="module-form-grid">
      <label className="form-field">Activity name <small>Optional</small><input value={activity} maxLength={140} onChange={(event) => setActivity(event.target.value)} /></label>
      <ArtefactPicker artefacts={state.artefacts} value={artefactId} onChange={setArtefactId} disabled={busy} />
    </div>}
    {instrument.items.map((item) => <InstrumentItem key={item.id} item={item} value={responses[item.id]} change={(value) => setResponses((current) => ({ ...current, [item.id]: value }))} />)}
    <div className="module-toolbar module-submit-row"><button className="button primary" type="submit" disabled={busy}><Check size={16} /> {busy ? "Submitting…" : "Submit questionnaire"}</button></div>
    <Feedback error={error} confirm={notice} />
  </form>;
}

export function QuestionnaireModule(props: ModuleProps) {
  const { state } = props;
  const available = state.questionnaires.filter((item) => item.items.length > 0);
  const [selected, setSelected] = useState("");
  const selectedInstrument = available.find((item) => `${item.id}:${item.version}` === selected);
  return <div className="module-screen questionnaire-module">
    <section className="panel module-card module-intro"><div className="module-section-icon"><ClipboardList size={20} /></div><div><h2>Study questionnaires</h2><p>Complete the questionnaires assigned to your activities and study sessions.</p></div></section>
    <section className="panel module-card"><h2>Available questionnaires</h2>
      {available.length ? <ul className="module-records">{available.map((instrument) => {
        const key = `${instrument.id}:${instrument.version}`;
        const count = state.responses.filter((answer) => answer.instrumentId === instrument.id && answer.version === instrument.version).length;
        return <li key={key}><ClipboardList size={18} aria-hidden="true" /><div><strong>{instrument.name}</strong><small>{timingLabels[instrument.timing]} · {instrument.items.length} {instrument.items.length === 1 ? "item" : "items"}{count ? ` · ${count} submitted` : ""}</small></div><button type="button" className="button" aria-pressed={selected === key} onClick={() => setSelected(key)}>{selected === key ? "Opened" : "Open"}</button></li>;
      })}</ul> : <p className="module-empty-copy">No researcher-approved questionnaire items are available yet.</p>}
    </section>
    {selectedInstrument && <InstrumentForm key={selected} instrument={selectedInstrument} {...props} />}
  </div>;
}
