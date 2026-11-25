'use client';

import { AudioLines, ClipboardList, Download, FlaskConical, LogOut, Moon, Settings2, Sun, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import ParticipantDetail from './participant-detail';
import { CodeManager, ResearchSettings, WizardQueue } from './settings-panels';
import { dateTime, researchRequest, ResearchRequestError, type ParticipantDataset, type ResearchOverview } from './research-client';

type Tab = 'participants' | 'settings' | 'wizard';

export function ExportLinks({ participantId }: { participantId?: string }) {
  const formats = [
    ['json', 'Research data · JSON'],
    ['jsonl', 'Interaction log · JSONL'],
    ['csv', 'Activity combined · CSV'],
    ['events', 'Event summaries · CSV'],
    ['questionnaires', 'Questionnaire items · CSV'],
    ['zip', 'Complete artefact archive · ZIP'],
    ['dictionary', 'Data dictionary · JSON'],
  ];
  return (
    <details className="research-export">
      <summary className="research-button"><Download size={16} aria-hidden="true" /> {participantId ? 'Export participant' : 'Export study'}</summary>
      <div className="research-export-menu">
        {formats.map(([format, label]) => <a key={format} href={`/api/research?format=${format}${participantId ? `&participant=${encodeURIComponent(participantId)}` : ''}`}>{label}</a>)}
      </div>
    </details>
  );
}

export default function ResearchPortal({ initiallySignedIn }: { initiallySignedIn: boolean }) {
  const [signedIn, setSignedIn] = useState(initiallySignedIn);
  const [overview, setOverview] = useState<ResearchOverview | null>(null);
  const [password, setPassword] = useState('');
  const [tab, setTab] = useState<Tab>('participants');
  const [selected, setSelected] = useState('');
  const [dataset, setDataset] = useState<ParticipantDataset | null>(null);
  const [working, setWorking] = useState(false);
  const [detailWorking, setDetailWorking] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const saved = localStorage.getItem('costudio-theme') === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = saved;
    setTheme(saved);
  }, []);

  function changeTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('costudio-theme', next);
    setTheme(next);
  }

  const sessionEnded = useCallback(() => {
    setSignedIn(false);
    setOverview(null);
    setSelected('');
    setDataset(null);
  }, []);

  function reportError(cause: unknown) {
    setError(cause instanceof Error ? cause.message : 'The researcher operation failed.');
  }

  const refresh = useCallback(async () => {
    try {
      const result = await researchRequest<ResearchOverview>('overview');
      setOverview(result);
      setSelected(previous => result.participants.some(item => item.id === previous) ? previous : result.participants[0]?.id ?? '');
      setError('');
    } catch (cause) {
      if (cause instanceof ResearchRequestError && cause.status === 401) sessionEnded();
      reportError(cause);
    }
  }, [sessionEnded]);

  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

  useEffect(() => {
    if (!signedIn || !selected) {
      setDataset(null);
      return;
    }
    let active = true;
    setDetailWorking(true);
    setDataset(null);
    void researchRequest<ParticipantDataset>('participant', { id: selected })
      .then(result => { if (active) setDataset(result); })
      .catch(cause => {
        if (!active) return;
        if (cause instanceof ResearchRequestError && cause.status === 401) sessionEnded();
        reportError(cause);
      })
      .finally(() => { if (active) setDetailWorking(false); });
    return () => { active = false; };
  }, [signedIn, selected, reload, sessionEnded]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError('');
    try {
      await researchRequest('login', { password });
      setPassword('');
      setSignedIn(true);
    } catch (cause) { reportError(cause); }
    finally { setWorking(false); }
  }

  async function logout() {
    try {
      await researchRequest('logout');
      sessionEnded();
      setError('');
    } catch (cause) { reportError(cause); }
  }

  const profile = overview?.participants.find(item => item.id === selected);

  return (
    <div className="research-shell">
      <header className="research-header">
        <Link href="/" className="research-brand"><span className="research-mark"><AudioLines aria-hidden="true" size={21} /></span><span>CoStudio <small>Your music. Your process.</small></span></Link>
        <div className="research-actions">
          <button className="research-button ghost" type="button" aria-label={theme === 'light' ? 'Use dark theme' : 'Use light theme'} onClick={changeTheme}>
            {theme === 'light' ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
          </button>
          {signedIn
            ? <button className="research-button ghost" type="button" onClick={logout}><LogOut aria-hidden="true" size={17} /> Sign out</button>
            : <Link href="/" className="research-button ghost">Participant workspace</Link>}
        </div>
      </header>

      {!signedIn ? (
        <main className="research-login">
          <form className="research-card" onSubmit={login}>
            <div className="research-login-icon"><FlaskConical size={24} aria-hidden="true" /></div>
            <h1>Researcher access</h1>
            <p>Configure the study and review participant activity in CoStudio.</p>
            <label>Researcher password<input type="password" name="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
            {error && <p className="research-error" role="alert">{error}</p>}
            <button className="research-button primary" type="submit" disabled={working}>{working ? 'Signing in…' : 'Sign in'}</button>
          </form>
        </main>
      ) : (
        <main className="research-content">
          <div className="research-title-row">
            <div><h1>Researcher workspace</h1><p>Study configuration, participant progress and data exports.</p></div>
            {overview && <div className="research-actions"><span className="research-pill">{overview.backend} backend</span><ExportLinks /></div>}
          </div>
          {error && <p className="research-error" role="alert">{error} {!overview && <button className="research-button ghost" type="button" onClick={refresh}>Retry</button>}</p>}
          {!overview && !error && <p role="status">Loading study records…</p>}
          {overview && (
            <>
              {!overview.consentReady && <p className="research-notice" role="status">Add researcher-approved information and consent text to open participant onboarding.</p>}
              <nav className="research-tabs" aria-label="Researcher sections">
                <button aria-pressed={tab === 'participants'} type="button" onClick={() => setTab('participants')}><UsersRound size={17} aria-hidden="true" /> Participants</button>
                <button aria-pressed={tab === 'settings'} type="button" onClick={() => setTab('settings')}><Settings2 size={17} aria-hidden="true" /> Study configuration</button>
                {(overview.backend === 'WIZARD' || overview.wizard.length > 0) && <button aria-pressed={tab === 'wizard'} type="button" onClick={() => setTab('wizard')}><ClipboardList size={17} aria-hidden="true" /> Wizard queue <span>{overview.wizard.length}</span></button>}
              </nav>
              {tab === 'participants' && (
                <>
                  <div className="research-metrics" aria-label="Study totals">
                    <div><small>Participants</small><strong>{overview.participants.length}</strong></div>
                    <div><small>Sessions</small><strong>{overview.participants.reduce((sum, item) => sum + item._count.sessions, 0)}</strong></div>
                    <div><small>Artefacts</small><strong>{overview.participants.reduce((sum, item) => sum + item._count.artefacts, 0)}</strong></div>
                    <div><small>Diary entries</small><strong>{overview.participants.reduce((sum, item) => sum + item._count.diary, 0)}</strong></div>
                  </div>
                  <div className="research-columns">
                    <aside className="research-rail" aria-label="Participants and study codes">
                      <section className="research-card">
                        <div className="research-section-head"><h2>Participants</h2><button type="button" className="research-button ghost compact" onClick={() => { void refresh(); setReload(value => value + 1); }}>Refresh</button></div>
                        {overview.participants.length === 0 && <p>Participants appear here after redeeming a study code.</p>}
                        <div className="research-roster">
                          {overview.participants.map(participant => (
                            <button key={participant.id} type="button" aria-pressed={selected === participant.id} onClick={() => setSelected(participant.id)}>
                              <strong>{participant.publicId}</strong>
                              <span>{participant.role ?? 'Onboarding'} · {dateTime(participant.createdAt)}</span>
                            </button>
                          ))}
                        </div>
                      </section>
                      <CodeManager codes={overview.codes} onChange={refresh} />
                    </aside>
                    {detailWorking && <p role="status">Loading participant records…</p>}
                    {!detailWorking && dataset && profile && <ParticipantDetail
                      key={profile.id} dataset={dataset} profile={profile} config={overview.config}
                      pseudonym={profile.pictorialId} onDeleted={async () => { setDataset(null); await refresh(); }}
                      exportLinks={<ExportLinks participantId={profile.id} />}
                    />}
                    {!selected && <section className="research-card research-inactive"><UsersRound size={28} aria-hidden="true" /><h2>Participant records</h2><p>Issue a study code to start enrolling participants.</p></section>}
                  </div>
                </>
              )}
              {tab === 'settings' && <ResearchSettings key={overview.config.configVersion} config={overview.config} onChange={refresh} />}
              {tab === 'wizard' && <WizardQueue queue={overview.wizard} onChange={async () => { await refresh(); setReload(value => value + 1); }} />}
            </>
          )}
        </main>
      )}
    </div>
  );
}
