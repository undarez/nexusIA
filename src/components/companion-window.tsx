'use client';

import { invoke } from '@tauri-apps/api/core';
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { availableMonitors, currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, MessageCircle, Minus, MoveUpRight, Send, Settings2, Shield, Sparkles, X } from 'lucide-react';
import { openNexusBrowser } from '@/lib/desktop-windows';

type Provider = 'ollama' | 'hermes' | 'openai';
type AgentRunResult = { response: string; model: string; elapsedMs: number };
type ChatLine = { id: string; from: 'nexus' | 'user'; text: string };
type AppId = 'calculator' | 'notepad' | 'explorer' | 'spotify' | 'edge' | 'chrome' | 'vlc';
type CompanionScale = 'S' | 'M' | 'L' | 'XL';
const companionSizes: Record<CompanionScale, [number, number]> = { S: [340, 580], M: [380, 690], L: [440, 790], XL: [520, 900] };

const apps: Record<AppId, string> = { calculator: 'Calculatrice', notepad: 'Bloc-notes', explorer: 'Explorateur de fichiers', spotify: 'Spotify', edge: 'Microsoft Edge', chrome: 'Google Chrome', vlc: 'VLC media player' };

function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

export function CompanionWindow() {
  const [provider, setProvider] = useState<Provider>('hermes');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatLine[]>([{ id: makeId(), from: 'nexus', text: 'Salut. Je suis NEXUS-01. Tu peux me parler ici.' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [motion, setMotion] = useState<'idle' | 'walk' | 'jump' | 'fly' | 'teleport' | 'sit' | 'fall' | 'sleep'>('idle');
  const [showChat, setShowChat] = useState(true);
  const [pendingApp, setPendingApp] = useState<AppId | null>(null);
  const [hermesTools, setHermesTools] = useState<string[]>([]);
  const [allowHermesTools, setAllowHermesTools] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [companionScale, setCompanionScale] = useState<CompanionScale>('M');
  const [fontStep, setFontStep] = useState(0);
  const [animationsEnabled, setAnimationsEnabled] = useState(true);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [idleTeleport, setIdleTeleport] = useState(false);
  const selectedModel = useMemo(() => model || models[0] || '', [model, models]);

  useEffect(() => {
    document.documentElement.classList.add('nexus-companion-document');
    document.body.classList.add('nexus-companion-document');
    let alive = true;
    const load = async () => {
      const providerSetting = localStorage.getItem('nexus.companion.provider.v1');
      const modelSetting = localStorage.getItem('nexus.companion.model.v1');
      const scaleSetting = localStorage.getItem('nexus.companion.scale.v1');
      const fontSetting = Number(localStorage.getItem('nexus.companion.fontStep.v1') || 0);
      setCompanionScale(scaleSetting && scaleSetting in companionSizes ? scaleSetting as CompanionScale : 'M');
      setFontStep(Number.isFinite(fontSetting) ? Math.min(3, Math.max(-2, fontSetting)) : 0);
      setAnimationsEnabled(localStorage.getItem('nexus.companion.animations.v1') !== 'false');
      setAlwaysOnTop(localStorage.getItem('nexus.companion.alwaysOnTop.v1') !== 'false');
      setIdleTeleport(localStorage.getItem('nexus.companion.idleTeleport.v1') === 'true');
      if (providerSetting === 'openai' || providerSetting === 'hermes') setProvider(providerSetting);
      else {
        setProvider('hermes');
        localStorage.setItem('nexus.companion.provider.v1', 'hermes');
      }
      if (modelSetting && providerSetting !== 'ollama') setModel(modelSetting);
      else {
        setModel('');
        localStorage.removeItem('nexus.companion.model.v1');
      }
      try {
        const available = await invoke<string[]>('list_ollama_models');
        if (alive) setModels(available);
      } catch { /* Keep companion available when a local provider is stopped. */ }
    };
    void load();
    return () => {
      alive = false;
      document.documentElement.classList.remove('nexus-companion-document');
      document.body.classList.remove('nexus-companion-document');
    };
  }, []);

  useEffect(() => {
    const [width, height] = companionSizes[companionScale];
    void getCurrentWindow().setSize(new LogicalSize(width, height)).catch((reason) => setError(String(reason)));
    localStorage.setItem('nexus.companion.scale.v1', companionScale);
  }, [companionScale]);

  useEffect(() => {
    void getCurrentWindow().setAlwaysOnTop(alwaysOnTop).catch((reason) => setError(String(reason)));
    localStorage.setItem('nexus.companion.alwaysOnTop.v1', String(alwaysOnTop));
  }, [alwaysOnTop]);

  useEffect(() => { localStorage.setItem('nexus.companion.animations.v1', String(animationsEnabled)); }, [animationsEnabled]);
  useEffect(() => { localStorage.setItem('nexus.companion.idleTeleport.v1', String(idleTeleport)); }, [idleTeleport]);
  useEffect(() => { localStorage.setItem('nexus.companion.fontStep.v1', String(fontStep)); }, [fontStep]);

  useEffect(() => {
    if (!idleTeleport) return;
    const timer = window.setInterval(() => {
      if (!busy && motion === 'idle') void teleport();
    }, 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [idleTeleport, busy, motion]);

  useEffect(() => {
    if (provider === 'ollama') {
      void invoke<string[]>('list_ollama_models').then(setModels).catch((reason) => setError(String(reason)));
    } else if (provider === 'hermes') {
      Promise.all([invoke<string[]>('list_hermes_models'), invoke<string[]>('hermes_text_only_status')])
        .then(([available, activeTools]) => { setModels(available); setHermesTools(activeTools); })
        .catch((reason) => setError(String(reason)));
    } else {
      Promise.all([invoke<boolean>('openai_api_key_configured'), invoke<string[]>('list_openai_models')])
        .then(([, available]) => setModels(available))
        .catch((reason) => setError(String(reason)));
    }
  }, [provider]);

  function chooseProvider(value: Provider) {
    setProvider(value);
    setModel('');
    localStorage.setItem('nexus.companion.provider.v1', value);
    localStorage.removeItem('nexus.companion.model.v1');
    setError('');
  }

  function closeWindow() { void getCurrentWindow().close(); }
  function minimizeWindow() { void getCurrentWindow().minimize(); }

  async function teleport() {
    try {
      const current = await currentMonitor();
      const monitors = await availableMonitors();
      const monitor = monitors.length ? monitors[Math.floor(Math.random() * monitors.length)] : current;
      if (!monitor) throw new Error('Aucun écran disponible pour déplacer le compagnon.');
      const scale = monitor.scaleFactor;
      const area = monitor.workArea;
      const [logicalWidth, logicalHeight] = companionSizes[companionScale];
      const maxX = area.position.x + Math.max(0, area.size.width - logicalWidth * scale);
      const maxY = area.position.y + Math.max(0, area.size.height - logicalHeight * scale);
      setMotion('teleport');
      await getCurrentWindow().setPosition(new PhysicalPosition(
        Math.round(area.position.x + Math.random() * (maxX - area.position.x)),
        Math.round(area.position.y + Math.random() * (maxY - area.position.y)),
      ));
      window.setTimeout(() => setMotion('idle'), 900);
    } catch (reason) {
      setError(String(reason));
      setMotion('idle');
    }
  }

  function playMotion(next: 'jump' | 'fly' | 'fall') {
    setMotion(next);
    window.setTimeout(() => setMotion('idle'), next === 'fly' ? 2600 : 1000);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || busy) return;
    const searchMatch = prompt.match(/(?:cherche|recherche|regarde|trouve|va\s+sur|ouvre\s+le\s+site|navigue\s+vers)\s+(?:sur\s+internet\s+|sur\s+le\s+net\s+|sur\s+youtube\s+|sur\s+spotify\s+)?(.+)/i);
    const musicMatch = prompt.match(/(?:mets|lance|cherche|change(?:\s+la)?\s+musique(?:\s+pour)?|joue)\s+(.+)/i);
    const appMatch = prompt.match(/(?:ouvre|lance|démarre)\s+(?:l['’]application\s+|l['’]app\s+|la\s+|le\s+)?(calculatrice|bloc[- ]notes|notepad|explorateur(?:\s+de\s+fichiers)?|spotify|edge|chrome|vlc)(?:\s|$)/i);
    const appKey = appMatch?.[1].toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ');
    const app: AppId | undefined = appKey === 'calculatrice' ? 'calculator' : appKey === 'bloc-notes' || appKey === 'notepad' ? 'notepad' : appKey?.startsWith('explorateur') ? 'explorer' : appKey === 'spotify' ? 'spotify' : appKey === 'edge' ? 'edge' : appKey === 'chrome' ? 'chrome' : appKey === 'vlc' ? 'vlc' : undefined;
    if (musicMatch && /musique|spotify|youtube|chanson|morceau/i.test(prompt)) {
      const query = musicMatch[1].trim().replace(/[.!?]+$/, '');
      setMessages((items) => [...items, { id: makeId(), from: 'user', text: prompt }, { id: makeId(), from: 'nexus', text: `J’ouvre une recherche YouTube Music pour « ${query} ». Tu pourras choisir le résultat.` }]);
      setDraft('');
      setBusy(true);
      try { await openNexusBrowser(`https://music.youtube.com/search?q=${encodeURIComponent(query)}`); setMotion('jump'); }
      catch (reason) { setError(String(reason)); }
      finally { setBusy(false); }
      return;
    }
    if (searchMatch && !app) {
      const query = searchMatch[1].trim().replace(/[.!?]+$/, '');
      setMessages((items) => [...items, { id: makeId(), from: 'user', text: prompt }, { id: makeId(), from: 'nexus', text: `J’ouvre les résultats web pour « ${query} ».` }]);
      setDraft('');
      setBusy(true);
      try { await openNexusBrowser(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`); setMotion('walk'); }
      catch (reason) { setError(String(reason)); }
      finally { setBusy(false); }
      return;
    }
    if (app) {
      setMessages((items) => [...items, { id: makeId(), from: 'user', text: prompt }, { id: makeId(), from: 'nexus', text: `Je peux ouvrir ${apps[app]}. Confirme l’action ci-dessous.` }]);
      setDraft('');
      setPendingApp(app);
      setMotion('walk');
      return;
    }
    setMessages((items) => [...items, { id: makeId(), from: 'user', text: prompt }]);
    setDraft('');
    setBusy(true);
    setError('');
    setMotion('walk');
    try {
      if (!selectedModel) throw new Error('Aucun modèle disponible pour ce moteur. Vérifie sa connexion dans NEXUS.');
      if (provider === 'hermes' && hermesTools.length && !allowHermesTools) throw new Error(`Hermes a des outils disponibles (${hermesTools.join(', ')}). Active leur usage pour cette demande dans les réglages du compagnon.`);
      const command = provider === 'ollama' ? 'run_ollama_agent' : provider === 'hermes' ? 'run_hermes_agent' : 'run_openai_agent';
      const history = messages.slice(-8).map((line) => `${line.from === 'user' ? 'Utilisateur' : 'NEXUS-01'} : ${line.text}`).join('\n');
      const conversationPrompt = `${history}\nUtilisateur : ${prompt}`;
      const result = await invoke<AgentRunResult>(command, {
        input: { model: selectedModel, role: 'Compagnon NEXUS-01', prompt: conversationPrompt, skillName: null, skillInstructions: null, enableHermesTools: provider === 'hermes' && allowHermesTools },
      });
      setMessages((items) => [...items, { id: makeId(), from: 'nexus', text: result.response }]);
      setMotion('idle');
    } catch (reason) {
      setError(String(reason));
      setMotion('idle');
    } finally {
      setBusy(false);
    }
  }

  async function approveApp() {
    if (!pendingApp) return;
    const app = pendingApp;
    setPendingApp(null);
    try {
      await invoke('open_approved_app', { appId: app });
      setMessages((items) => [...items, { id: makeId(), from: 'nexus', text: `${apps[app]} ouvert. L’action est inscrite dans le journal local.` }]);
      playMotion('jump');
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function rejectApp() {
    if (!pendingApp) return;
    const app = pendingApp;
    setPendingApp(null);
    try { await invoke('record_companion_app_denial', { appId: app }); }
    catch (reason) { setError(String(reason)); }
  }

  return <main className={`companion-window-root${animationsEnabled ? '' : ' animations-disabled'}`} data-scale={companionScale} style={{ '--companion-font-scale': String(1 + fontStep * 0.16) } as React.CSSProperties}>
    <header className="companion-window-titlebar" data-tauri-drag-region>
      <span className="companion-title-mark"><Sparkles size={13} /></span><strong data-tauri-drag-region>NEXUS-01</strong><span className="companion-status-dot" />
      <div className="companion-window-controls"><button onClick={() => setSettingsOpen((value) => !value)} aria-label="Réglages du compagnon" title="Réglages"><Settings2 size={14} /></button><button onClick={minimizeWindow} aria-label="Masquer le compagnon" title="Masquer"><Minus size={14} /></button><button onClick={closeWindow} aria-label="Fermer le compagnon"><X size={14} /></button></div>
    </header>
    <section className={`companion-pet-stage motion-${motion}`}>
      <div className="companion-pet-orbit orbit-a" /><div className="companion-pet-orbit orbit-b" /><div className="companion-pet-pad" />
      <img className="companion-pet-art" src="/nexus-01-companion.png" alt="NEXUS-01, mécha blanc, bleu et or — illustration d’origine" />
      <div className="companion-jet-flame"><i /><i /></div>
      <div className="companion-speech"><span><Sparkles size={11} /> EN LIGNE</span><p>{busy ? 'Je prépare ma réponse…' : 'À ton écoute.'}</p></div>
      <nav className="companion-motion-controls" aria-label="Mouvements du compagnon">
        <button onClick={() => { setMotion('walk'); window.setTimeout(() => setMotion('idle'), 2000); }} title="Marche"><MoveUpRight size={14} />Marcher</button>
        <button onClick={() => playMotion('jump')} title="Sauter">Saut</button>
        <button onClick={() => playMotion('fly')} title="Jet-pack">Vol</button>
        <button onClick={() => void teleport()} title="Téléporter">Téléport</button>
        <button onClick={() => setMotion((value) => value === 'sit' ? 'idle' : 'sit')} title="S’asseoir">Assis</button>
        <button onClick={() => playMotion('fall')} title="Tomber">Chute</button>
        <button onClick={() => setMotion((value) => value === 'sleep' ? 'idle' : 'sleep')} title="Sommeil">Repos</button>
      </nav>
    </section>
    <section className="companion-chat-card">
      <button className="companion-chat-heading" onClick={() => setShowChat((value) => !value)}><span><MessageCircle size={14} /> Discussion NEXUS-01</span><ChevronDown className={showChat ? '' : 'collapsed'} size={15} /></button>
      {showChat && <>
        {settingsOpen && <div className="companion-settings-panel">
          <div className="companion-settings-heading"><strong>CONSTRUCT MANIFEST</strong><span>Réglages du compagnon</span></div>
          <div className="companion-settings-row"><span>Taille</span><div className="companion-size-options">{(['S', 'M', 'L', 'XL'] as CompanionScale[]).map((size) => <button className={companionScale === size ? 'selected' : ''} key={size} onClick={() => setCompanionScale(size)}>{size}</button>)}</div></div>
          <div className="companion-settings-row"><span>Taille du texte</span><div className="companion-size-options"><button onClick={() => setFontStep((value) => Math.max(-2, value - 1))}>A−</button><button onClick={() => setFontStep((value) => Math.min(3, value + 1))}>A+</button></div></div>
          <label className="companion-toggle-row"><span>Animations</span><input type="checkbox" checked={animationsEnabled} onChange={(event) => setAnimationsEnabled(event.target.checked)} /></label>
          <label className="companion-toggle-row"><span>Rester au-dessus des fenêtres</span><input type="checkbox" checked={alwaysOnTop} onChange={(event) => setAlwaysOnTop(event.target.checked)} /></label>
          <label className="companion-toggle-row"><span>Téléportation en veille · 10 min</span><input type="checkbox" checked={idleTeleport} onChange={(event) => setIdleTeleport(event.target.checked)} /></label>
          <div className="companion-feature-status"><span>Microphone et voix locale</span><strong>À intégrer</strong></div>
          <div className="companion-feature-status"><span>Se poser sur les fenêtres</span><strong>À intégrer</strong></div>
        </div>}
        <div className="companion-chat-settings"><select aria-label="Moteur IA du compagnon" value={provider} onChange={(event) => chooseProvider(event.target.value as Provider)}><option value="ollama">Ollama · local</option><option value="hermes">Hermes · local</option><option value="openai">OpenAI · Internet</option></select><select aria-label="Modèle du compagnon" value={selectedModel} onChange={(event) => { setModel(event.target.value); localStorage.setItem('nexus.companion.model.v1', event.target.value); }}><option value="">Choisir un modèle</option>{models.map((item) => <option value={item} key={item}>{item}</option>)}</select></div>
        {provider === 'hermes' && hermesTools.length > 0 && <label className="companion-hermes-tools"><input type="checkbox" checked={allowHermesTools} onChange={(event) => setAllowHermesTools(event.target.checked)} />Autoriser les toolsets Hermes pour la prochaine demande</label>}
        <div className="companion-messages" aria-live="polite">{messages.slice(-16).map((message) => <article className={`companion-message ${message.from}`} key={message.id}><span>{message.from === 'nexus' ? 'NEXUS-01' : 'TOI'}</span><p>{message.text}</p></article>)}</div>
        {pendingApp && <div className="companion-approval"><Shield size={14} /><span>Autoriser l’ouverture de <strong>{apps[pendingApp]}</strong> ?</span><button onClick={() => void approveApp()}><Check size={13} /> Approuver</button><button onClick={() => void rejectApp()}>Refuser</button></div>}
        {provider === 'openai' && <small className="companion-privacy-note">La conversation est envoyée à OpenAI et peut être facturée.</small>}
        {error && <small className="companion-error">{error}</small>}
        <form className="companion-compose" onSubmit={(event) => void sendMessage(event)}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Parle-moi ou donne une tâche…" rows={2} /><button disabled={busy || !draft.trim()} aria-label="Envoyer"><Send size={15} /></button></form>
        <small className="companion-safety"><Shield size={11} /> Lancement d’application avec confirmation · recherche web disponible</small>
      </>}
    </section>
  </main>;
}
