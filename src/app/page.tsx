'use client';

import { invoke } from '@tauri-apps/api/core';
import { usePathname, useRouter } from 'next/navigation';
import { ModuleWorkspace } from '@/components/module-workspace';
import { CompanionWindow } from '@/components/companion-window';
import { openNexusCompanion } from '@/lib/desktop-windows';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Activity, ArrowUpRight, Cable, Check, ChevronDown, ChevronRight,
  CircleCheck, Clock3, Code2, Command, Folder, Globe2, HardDrive,
  History, Home, LayoutDashboard, Layers, LockKeyhole, Monitor, PanelsTopLeft,
  Play, Plus, Rocket, Settings, Shield, Sparkles, TerminalSquare, Users,
  Wifi, X, Zap,
} from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';

type TerminalAction = 'getDate' | 'getProcessSummary' | 'getLocation' | 'cmdVersion' | 'cmdUser' | 'pythonVersion' | 'pythonPlatform';
type TerminalRuntime = 'PowerShell' | 'CMD' | 'Python';
type TerminalResult = {
  eventId: string;
  action: string;
  output: string;
  exitCode: number | null;
  outcome: string;
  truncated: boolean;
  elapsedMs: number;
};
type TerminalAuditEvent = {
  eventId: string;
  action: string;
  outcome: string;
  timestampMs: number;
  detail?: string | null;
};
type EngineHealth = { ollama: 'checking' | 'connected' | 'offline'; hermes: 'checking' | 'connected' | 'offline'; openai: 'checking' | 'connected' | 'unconfigured' | 'offline' };
type SystemMetrics = { cpuPercent: number; memoryPercent: number; memoryUsedBytes: number; memoryTotalBytes: number };

const actions: { id: TerminalAction; runtime: TerminalRuntime; label: string; description: string }[] = [
  { id: 'getDate', runtime: 'PowerShell', label: 'Afficher la date et l’heure', description: 'Lecture seule · sortie limitée · 8 s maximum' },
  { id: 'getProcessSummary', runtime: 'PowerShell', label: 'Afficher les processus', description: '12 lignes maximum · lecture seule · 8 s maximum' },
  { id: 'getLocation', runtime: 'PowerShell', label: 'Afficher le dossier courant', description: 'Lecture seule · sortie limitée · 8 s maximum' },
  { id: 'cmdVersion', runtime: 'CMD', label: 'Afficher la version de Windows (CMD)', description: 'Commande fixe · lecture seule · 8 s maximum' },
  { id: 'cmdUser', runtime: 'CMD', label: 'Afficher l’utilisateur courant (CMD)', description: 'Commande fixe · lecture seule · 8 s maximum' },
  { id: 'pythonVersion', runtime: 'Python', label: 'Afficher la version de Python', description: 'Script fixe · lecture seule · 8 s maximum' },
  { id: 'pythonPlatform', runtime: 'Python', label: 'Afficher la plateforme Python', description: 'Script fixe · lecture seule · 8 s maximum' },
];

const topTabs = [
  { label: 'Accueil', icon: Home },
  { label: 'Missions', icon: Rocket },
  { label: 'Agents', icon: Users },
  { label: 'Projets', icon: Folder },
  { label: 'Terminal', icon: TerminalSquare },
  { label: 'Navigateur', icon: Globe2 },
  { label: 'Skills', icon: Layers },
  { label: 'Configuration', icon: Settings },
];

const sideLinks = [
  { label: 'Tableau de bord', icon: LayoutDashboard },
  { label: 'Nouvelle mission', icon: Plus },
  { label: 'Mes projets', icon: Folder },
  { label: 'Agents IA', icon: Users },
  { label: 'Skills (Compétences)', icon: Sparkles },
  { label: 'Navigateur NEXUS', icon: Globe2 },
  { label: 'Terminal Studio', icon: TerminalSquare },
  { label: 'Appareils & Connexions', icon: Monitor },
  { label: 'Historique & Logs', icon: History },
  { label: 'Sécurité & Conformité', icon: Shield },
  { label: 'Connecteurs IA', icon: Cable },
];

const agentModules = [
  { name: 'Project Manager', role: 'Planification & pilotage', icon: PanelsTopLeft, tint: 'cyan' },
  { name: 'UI / UX Designer', role: 'Design & ergonomie', icon: Sparkles, tint: 'violet' },
  { name: 'Frontend Developer', role: 'Interfaces & web', icon: Code2, tint: 'blue' },
  { name: 'Android & Smart TV', role: 'Kotlin · Jetpack · ADB', icon: Monitor, tint: 'green' },
  { name: 'Terminal Operator', role: 'Actions locales supervisées', icon: TerminalSquare, tint: 'purple' },
  { name: 'Security Sentinel', role: 'Contrôle & conformité', icon: Shield, tint: 'pink' },
];

const routeToLabel: Record<string, string> = {
  '/': 'Accueil', '/missions': 'Missions', '/missions/new': 'Nouvelle mission',
  '/agents': 'Agents', '/projects': 'Projets', '/terminal': 'Terminal',
  '/browser': 'Navigateur', '/skills': 'Skills', '/settings': 'Configuration',
  '/devices': 'Appareils & Connexions', '/history': 'Historique & Logs', '/security': 'Sécurité & Conformité', '/integrations': 'Connecteurs IA',
};
const routeForLabel: Record<string, string> = {
  Accueil: '/', 'Tableau de bord': '/', Missions: '/missions', 'Nouvelle mission': '/missions/new',
  Agents: '/agents', 'Agents IA': '/agents', Projets: '/projects', 'Mes projets': '/projects',
  Terminal: '/terminal', 'Terminal Studio': '/terminal', Navigateur: '/browser', 'Navigateur NEXUS': '/browser',
  Skills: '/skills', 'Skills (Compétences)': '/skills', Configuration: '/settings',
  'Appareils & Connexions': '/devices', 'Historique & Logs': '/history', 'Sécurité & Conformité': '/security', 'Connecteurs IA': '/integrations',
};
const pageForPath: Record<string, 'missions' | 'new-mission' | 'projects' | 'agents' | 'terminal' | 'browser' | 'skills' | 'settings' | 'devices' | 'history' | 'security' | 'integrations'> = {
  '/missions': 'missions', '/missions/new': 'new-mission', '/agents': 'agents', '/projects': 'projects',
  '/terminal': 'terminal', '/browser': 'browser', '/skills': 'skills', '/settings': 'settings',
  '/devices': 'devices', '/history': 'history', '/security': 'security', '/integrations': 'integrations',
};

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export default function HomePage() {
  const pathname = usePathname();
  const router = useRouter();
  const [logs, setLogs] = useState<string[]>([
    '[NEXUS] Terminal Studio initialisé',
    '[SECURITY] Actions prédéfinies · approbation requise',
  ]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [selectedAction, setSelectedAction] = useState<TerminalAction>('getDate');
  const [selectedRuntime, setSelectedRuntime] = useState<TerminalRuntime>('PowerShell');
  const [typedCommand, setTypedCommand] = useState('');
  const [pendingApproval, setPendingApproval] = useState<TerminalAction | null>(null);
  const [running, setRunning] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [terminalVerified, setTerminalVerified] = useState(false);
  const [clock, setClock] = useState('');
  const [isCompanionMode, setIsCompanionMode] = useState(false);
  const [companionLaunchError, setCompanionLaunchError] = useState('');
  const [engineHealth, setEngineHealth] = useState<EngineHealth>({ ollama: 'checking', hermes: 'checking', openai: 'checking' });
  const [prototypeExpanded, setPrototypeExpanded] = useState(false);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const activeNav = routeToLabel[pathname] || 'Accueil';

  useEffect(() => {
    setDesktop(isTauri());
    setIsCompanionMode(new URLSearchParams(window.location.search).get('nexusCompanion') === '1');
    setTerminalVerified(localStorage.getItem('nexus.terminal.getDateVerified.v1') === 'true');
    try {
      const storedLogs = sessionStorage.getItem('nexus.terminal.logs.v1');
      if (storedLogs) {
        const parsed: unknown = JSON.parse(storedLogs);
        if (Array.isArray(parsed) && parsed.every((line) => typeof line === 'string')) setLogs(parsed.slice(-100));
      }
    } catch { /* Session storage can be unavailable in restricted webviews. */ }
    setLogsLoaded(true);
    const updateClock = () => setClock(new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date()));
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!desktop) {
      setEngineHealth({ ollama: 'offline', hermes: 'offline', openai: 'unconfigured' });
      return;
    }
    let alive = true;
    const checkEngines = async () => {
      const [ollama, hermes, configured] = await Promise.allSettled([
        invoke<string[]>('list_ollama_models'),
        invoke<string[]>('list_hermes_models'),
        invoke<boolean>('openai_api_key_configured'),
      ]);
      let openai: EngineHealth['openai'] = configured.status === 'fulfilled' && configured.value ? 'offline' : 'unconfigured';
      if (configured.status === 'fulfilled' && configured.value) {
        try { await invoke<string[]>('list_openai_models'); openai = 'connected'; } catch { openai = 'offline'; }
      }
      if (!alive) return;
      setEngineHealth({
        ollama: ollama.status === 'fulfilled' ? 'connected' : 'offline',
        hermes: hermes.status === 'fulfilled' ? 'connected' : 'offline',
        openai,
      });
    };
    void checkEngines();
    const timer = window.setInterval(() => void checkEngines(), 30_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const refresh = async () => {
      try {
        const metrics = await invoke<SystemMetrics>('get_system_metrics');
        if (alive) setSystemMetrics(metrics);
      } catch { if (alive) setSystemMetrics(null); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [desktop]);

  useEffect(() => {
    if (!desktop || isCompanionMode) return;
    void openNexusCompanion().catch((error) => setCompanionLaunchError(String(error)));
  }, [desktop, isCompanionMode]);

  useEffect(() => {
    if (!logsLoaded) return;
    try { sessionStorage.setItem('nexus.terminal.logs.v1', JSON.stringify(logs.slice(-100))); }
    catch { /* Keep the current session usable when storage is restricted. */ }
  }, [logs, logsLoaded]);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<TerminalAuditEvent>('terminal://audit', ({ payload }) => {
        const time = new Date(payload.timestampMs).toLocaleTimeString('fr-FR');
        setLogs((current) => [...current, `[AUDIT ${time}] ${payload.outcome} · ${payload.action}${payload.detail ? ` · ${payload.detail}` : ''}`].slice(-100));
      }).then((stop) => {
        if (active) unlisten = stop;
        else stop();
      }),
    ).catch(() => setLogs((current) => [...current, '[SECURITY] Flux d’audit indisponible']));
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  function appendLog(message: string) {
    setLogs((current) => [...current, message].slice(-100));
  }

  function selectSection(label: string) {
    const route = routeForLabel[label];
    if (route && route !== pathname) router.push(route);
  }

  async function enterCompanionMode() {
    setCompanionLaunchError('');
    try {
      await openNexusCompanion();
      await getCurrentWindow().minimize();
    } catch (error) {
      setCompanionLaunchError(String(error));
    }
  }

  async function executeApprovedAction() {
    if (!pendingApproval || running) return;
    const action = pendingApproval;
    setPendingApproval(null);
    setRunning(true);
    try {
      const result = await invoke<TerminalResult>('execute_terminal_action', { action });
      if (action === 'getDate' && result.outcome === 'completed' && result.exitCode === 0 && result.output.trim()) {
        setTerminalVerified(true);
        localStorage.setItem('nexus.terminal.getDateVerified.v1', 'true');
      }
      setLogs((current) => [
        ...current,
        `[${actions.find((item) => item.id === action)?.runtime ?? 'Terminal'} NEXUS · ${result.action}]`,
        result.output || '(aucune sortie)',
        `[${result.outcome}] code=${result.exitCode ?? 'inconnu'} · ${result.elapsedMs} ms${result.truncated ? ' · sortie tronquée' : ''} · ${result.eventId}`,
      ].slice(-100));
    } catch (error) {
      appendLog(`[ERREUR TERMINAL] ${String(error)}`);
    } finally {
      setRunning(false);
    }
  }

  function rejectPendingAction() {
    if (!pendingApproval) return;
    const action = pendingApproval;
    setPendingApproval(null);
    void invoke('record_terminal_denial', { action }).catch((error) => {
      appendLog(`[AUDIT] Refus non consigné : ${String(error)}`);
    });
  }

  function requestAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!desktop || running) return;
    const typed = typedCommand.trim().toLocaleLowerCase('en-US');
    if (!typed) {
      setPendingApproval(selectedAction);
      return;
    }
    const allowedCommands: Record<string, TerminalAction> = {
      'get-date': 'getDate',
      'get-process': 'getProcessSummary',
      'get-location': 'getLocation',
      pwd: 'getLocation',
      ver: 'cmdVersion',
      whoami: 'cmdUser',
      'python --version': 'pythonVersion',
      'python -v': 'pythonVersion',
      'python platform': 'pythonPlatform',
    };
    const action = allowedCommands[typed];
    const matchingAction = action && actions.find((item) => item.id === action);
    if (matchingAction && matchingAction.runtime !== selectedRuntime) {
      appendLog(`[SECURITY] Action refusée · ${matchingAction.runtime} n’est pas le runtime sélectionné`);
      void invoke('record_terminal_text_rejection').catch((error) => appendLog(`[AUDIT] Refus non consigné : ${String(error)}`));
      setTypedCommand('');
      return;
    }
    if (!action) {
      appendLog('[SECURITY] Commande refusée · seules les actions affichées pour ce runtime sont autorisées');
      void invoke('record_terminal_text_rejection').catch((error) => appendLog(`[AUDIT] Refus non consigné : ${String(error)}`));
      setTypedCommand('');
      return;
    }
    setSelectedAction(action);
    setPendingApproval(action);
    setTypedCommand('');
  }

  const runtimeActions = actions.filter((action) => action.runtime === selectedRuntime);
  const terminalPanel = <section className="panel terminal-panel" id="terminal-studio">
    <div className="section-heading terminal-heading">
      <div className="heading-icon terminal-icon"><TerminalSquare size={18} /></div>
      <div><h2>Terminal Studio</h2><p>{selectedRuntime} · commandes limitées</p></div>
      <span className={`runtime-tag ${desktop ? 'ready' : ''}`}><i />{desktop ? 'CONPTY' : 'NON DISPONIBLE'}</span>
    </div>
    <div className="terminal-tabs"><button type="button" className={`terminal-tab ${selectedRuntime === 'PowerShell' ? 'active' : ''}`} onClick={() => { setSelectedRuntime('PowerShell'); setSelectedAction('getDate'); setTypedCommand(''); }} disabled={running}><TerminalSquare size={14} /> PowerShell</button><button type="button" className={`terminal-tab ${selectedRuntime === 'CMD' ? 'active' : ''}`} onClick={() => { setSelectedRuntime('CMD'); setSelectedAction('cmdVersion'); setTypedCommand(''); }} disabled={running}><Command size={13} /> CMD</button><button type="button" className={`terminal-tab ${selectedRuntime === 'Python' ? 'active' : ''}`} onClick={() => { setSelectedRuntime('Python'); setSelectedAction('pythonVersion'); setTypedCommand(''); }} disabled={running}><Code2 size={13} /> Python</button><span className="term-lock"><LockKeyhole size={13} /> Actions approuvées</span></div>
    <form className="terminal-command-row" onSubmit={requestAction}>
      <label className="sr-only" htmlFor="terminal-command-input">Saisir une commande autorisée</label>
      <input id="terminal-command-input" className="terminal-command-input" value={typedCommand} onChange={(event) => setTypedCommand(event.target.value)} placeholder={selectedRuntime === 'PowerShell' ? 'Get-Date, Get-Process, Get-Location…' : selectedRuntime === 'CMD' ? 'ver ou whoami…' : 'python --version ou python platform…'} autoComplete="off" maxLength={100} disabled={!desktop || running} />
      <label className="sr-only" htmlFor="terminal-action">Action {selectedRuntime}</label>
      <select id="terminal-action" value={selectedAction} onChange={(event) => { setSelectedAction(event.target.value as TerminalAction); setTypedCommand(''); }} disabled={!desktop || running}>
        {runtimeActions.map((action) => <option key={action.id} value={action.id}>{action.label}</option>)}
      </select>
      <button className="run-action" disabled={!desktop || running}><Play size={15} fill="currentColor" />{running ? 'En cours…' : 'Exécuter'}</button>
    </form>
    {!desktop && <div className="web-terminal-note">Ouvre NEXUS dans son application Windows pour utiliser PowerShell.</div>}
    <div className="terminal-screen" role="log" aria-live="polite">
      <div className="terminal-screen-top"><span><i /><i /><i /></span><small>{selectedRuntime.toLocaleUpperCase('fr-FR')} · SESSION LOCALE</small><span className="screen-secure"><LockKeyhole size={11} /> SÉCURISÉ</span></div>
      <div className="terminal-output">
        {logs.slice(-8).map((line, index) => <div key={`${index}-${line}`} className={`log-line ${line.includes('ERREUR') ? 'error' : line.includes('SECURITY') || line.includes('AUDIT') ? 'audit' : ''}`}><span className="log-prompt">{line.startsWith('[PS') ? '›' : '·'}</span><span>{line}</span></div>)}
        {!running && <div className="terminal-cursor-line"><span>PS NEXUS <b>›</b></span><i /></div>}
        {running && <div className="log-line audit"><span className="log-prompt">·</span><span>Exécution {selectedRuntime} en cours…</span></div>}
      </div>
    </div>
      <div className="terminal-footnote"><Shield size={13} /> Actions prédéfinies · approbation requise · sortie 16 Ko max · arrêt après 8 s · audit local</div>
  </section>;

  const activeTopLabel = activeNav === 'Nouvelle mission' ? 'Missions' : activeNav;

  if (isCompanionMode) return <CompanionWindow />;

  return <main className="desktop-shell">
    <aside className="side-rail">
      <div className="rail-brand">
        <div className="nexus-mark"><span>N</span><i /></div>
        <div><strong>NEXUS<span>V4.2</span></strong><small>Plateforme d’orchestration IA</small></div>
      </div>

      <div className="rail-section-label">ESPACE DE TRAVAIL</div>
      <nav className="side-nav" aria-label="Navigation principale">
        {sideLinks.map(({ label, icon: Icon }, index) => <button
          key={label}
          className={`side-link ${activeNav === (index === 0 ? 'Accueil' : routeToLabel[routeForLabel[label]] || label) ? 'selected' : ''} ${index === 1 ? 'new-mission' : ''}`}
          onClick={() => selectSection(index === 0 ? 'Accueil' : label)}
        >
          <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{label === 'Appareils & Connexions' && <i className="link-status" />}
        </button>)}
      </nav>

      <div className="device-card">
        <div className="device-card-title"><span>APPAREIL LOCAL</span><span className="live-dot" /></div>
        <div className="device-name"><Monitor size={17} /><span>PC Windows</span><small>{desktop ? 'Connecté' : 'Non connecté'}</small></div>
        <div className="device-caption"><Wifi size={13} /> Liaison locale Tauri</div>
      </div>

      <div className="rail-bottom">
        <div className="rail-build"><span className="build-led" /> NEXUS CORE <span>BUILD 0.1.0</span></div>
      <div className="profile-chip"><div className="profile-avatar">A</div><div><strong>Administrateur</strong><small>Session Windows locale</small></div><ChevronDown size={15} /></div>
      </div>
    </aside>

    <section className="workspace">
      <header className="topbar">
        <div className="mobile-brand"><div className="nexus-mark"><span>N</span><i /></div><strong>NEXUS V4.2</strong></div>
        <nav className="top-tabs" aria-label="Modules NEXUS">
          {topTabs.map(({ label, icon: Icon }) => <button key={label} className={activeTopLabel === label ? 'tab-active' : ''} onClick={() => selectSection(label)}>
            <Icon size={16} strokeWidth={1.8} /><span>{label}</span>
          </button>)}
        </nav>
        <div className="top-tools">
          <div className={`connection-badge ${desktop ? '' : 'offline'}`}><span className="live-dot" />{desktop ? 'LOCAL' : 'WEB'}</div>
          <div className="clock-box"><small>MAR. 10 NOV. 2026</small><strong>{clock || '—:—'}</strong></div>
          <button className="top-icon" aria-label="Configuration" onClick={() => selectSection('Configuration')}><Settings size={18} /></button>
        </div>
      </header>

      {!desktop && pathname === '/' && <div className="web-beta-notice dashboard-web-beta" role="status"><strong>Bêta navigateur active</strong><span>Tu peux parcourir NEXUS et utiliser les fonctions locales de suivi. Le terminal Windows, les moteurs IA locaux et le compagnon bureau attendent le runtime Tauri, actuellement bloqué par la stratégie de sécurité Windows.</span></div>}

      {pathname === '/' ? <div className="dashboard-grid">
        <div className="main-column">
          <section className="welcome-banner">
            <div className="welcome-emblem"><div className="emblem-core"><Command size={35} /></div><span className="emblem-orbit orbit-one" /><span className="emblem-orbit orbit-two" /></div>
            <div className="welcome-copy">
              <div className="eyebrow"><Sparkles size={13} /> CENTRE DE COMMANDE <span>·</span> V4.2</div>
              <h1>Bienvenue dans <b>NEXUS</b></h1>
              <p>Ton atelier IA pour concevoir, automatiser et piloter tes projets.</p>
            </div>
            <div className="banner-streak streak-a" /><div className="banner-streak streak-b" />
          </section>

          <section className="quick-actions" aria-label="Actions rapides">
            <button className="quick-action primary" onClick={() => selectSection('Nouvelle mission')}><Rocket size={21} /><span>Lancer une mission</span><ArrowUpRight size={15} /></button>
              <button className="quick-action" onClick={() => selectSection('Navigateur')}><Globe2 size={20} /><span>Ouvrir le navigateur</span></button>
            <button className="quick-action" onClick={() => selectSection('Terminal')}><TerminalSquare size={20} /><span>Terminal Studio</span></button>
            <button className="quick-action" onClick={() => selectSection('Agents')}><Users size={20} /><span>Gérer les agents</span></button>
          </section>

          <section className="panel agent-panel">
            <div className="section-heading">
              <div className="heading-icon cyan-icon"><Users size={18} /></div>
              <div><h2>Rôles agents</h2><p>Catalogue disponible · connexion du moteur IA requise</p></div>
              <span className="module-count">6 rôles</span>
              <button className="text-link" onClick={() => selectSection('Agents')}>Voir les modules <ChevronRight size={15} /></button>
            </div>
            <div className="agent-grid">
              {agentModules.map(({ name, role, icon: Icon, tint }) => <button className="agent-card" key={name} onClick={() => selectSection('Agents')}>
                <span className={`agent-icon ${tint}`}><Icon size={19} strokeWidth={1.9} /></span>
                <span className="agent-card-copy"><strong>{name}</strong><small>{role}</small></span>
                <span className={`module-state ${engineHealth.ollama === 'connected' || engineHealth.hermes === 'connected' ? 'connected' : ''}`}><i />{engineHealth.hermes === 'connected' ? 'HERMES' : engineHealth.ollama === 'connected' ? 'OLLAMA' : engineHealth.openai === 'connected' ? 'OPENAI' : engineHealth.ollama === 'checking' ? 'TEST…' : 'HORS LIGNE'}</span>
              </button>)}
            </div>
          </section>

          <section className="panel mission-panel">
            <div className="mission-topline">
              <div className="heading-icon blue-icon"><Zap size={18} /></div>
              <div><h2>Prototype Windows</h2><p>Mission de développement actuelle</p></div>
              <span className="mission-status"><i /> EN VALIDATION</span>
              <button className="icon-button" aria-label="Afficher les prochaines étapes du prototype Windows" aria-expanded={prototypeExpanded} onClick={() => setPrototypeExpanded((value) => !value)}><ChevronDown className={prototypeExpanded ? 'expanded' : ''} size={17} /></button>
            </div>
            <div className="mission-body">
              <div className="mission-copy">
                <h3>Terminal PowerShell supervisé</h3>
                <p className="mission-subtitle">Intégration Tauri 2 · Rust · ConPTY</p>
                <div className="mission-steps">
                  <div className="mission-step done"><span><Check size={12} /></span><p>Actions prédéfinies et lecture seule</p><small>TERMINÉ</small></div>
                  <div className="mission-step done"><span><Check size={12} /></span><p>Approbation, audit et limites d’exécution</p><small>TERMINÉ</small></div>
                  <div className={`mission-step ${terminalVerified ? 'done' : 'pending'}`}><span>{terminalVerified ? <Check size={12} /> : <i />}</span><p>Valider la sortie PowerShell dans l’application</p><small>{terminalVerified ? 'VALIDÉ' : 'À TESTER'}</small></div>
                </div>
                <div className="mission-progress"><div><span style={{ width: terminalVerified ? '100%' : '68%' }} /></div><strong>{terminalVerified ? '3 / 3 étapes' : '2 / 3 étapes'}</strong></div>
              </div>
              <div className="mission-visual"><div className="mission-visual-grid" /><div className="mission-visual-ring" /><div className="mission-visual-core"><TerminalSquare size={30} /></div><div className="mission-code code-one">PS&gt; Get-Date</div><div className="mission-code code-two">APPROVAL REQUIRED</div><div className="mission-code code-three">CONPTY // LOCAL</div></div>
            </div>
            {prototypeExpanded && <div className="prototype-next-steps">
              <div className="prototype-next-heading"><strong>PROCHAINES ÉTAPES</strong><small>La validation PowerShell reste conservée dans l’historique.</small></div>
              <div className="prototype-next-grid">
                <article><span>01</span><strong>CMD et Python</strong><small>Actions fixes, sortie bornée et approbation intégrées au Terminal Studio.</small><em>DISPONIBLE</em></article>
                <article><span>02</span><strong>Agents et skills</strong><small>Échanges séquentiels et sélection de plusieurs skills.</small><em>EN COURS</em></article>
                <article><span>03</span><strong>État système en direct</strong><small>CPU et mémoire locale actualisés toutes les 2 secondes.</small><em>{systemMetrics ? 'ACTIF' : 'INDISPONIBLE'}</em></article>
              </div>
            </div>}
          </section>

          <div className="lower-grid">
            {terminalPanel}

            <section className="panel browser-panel" id="nexus-browser">
              <div className="section-heading browser-heading">
                <div className="heading-icon browser-icon"><Globe2 size={18} /></div>
                <div><h2>Navigateur NEXUS</h2><p>Module de navigation</p></div>
                <span className="coming-tag">LOCAL · HTTPS</span>
              </div>
              <button className="browser-address browser-address-button" onClick={() => selectSection('Navigateur')}><Globe2 size={15} /><span>Rechercher sur Internet ou saisir une adresse HTTPS</span><ChevronRight size={15} /></button>
              <div className="browser-empty"><div className="browser-orbit"><Globe2 size={28} /></div><strong>Navigateur prêt</strong><p>Ouvre son module pour lancer une recherche ou une page dans une fenêtre NEXUS dédiée.</p><button className="subtle-button" onClick={() => selectSection('Navigateur')}>Naviguer</button></div>
              <div className="browser-shortcuts"><span><span className="shortcut-icon youtube">▶</span>YouTube</span><span><span className="shortcut-icon github">⌘</span>GitHub</span><span><span className="shortcut-icon docs">▤</span>Docs</span><span><span className="shortcut-icon add"><Plus size={17} /></span>Ajouter</span></div>
            </section>
          </div>
        </div>

        <aside className="right-column">
          <section className="companion-card">
            <div className="companion-hud hud-top" /><div className="companion-hud hud-side" />
            <div className="companion-header"><div><span className="companion-overline">COMPAGNON IA</span><h2>NEXUS-01</h2><p>Unité d’assistance locale</p></div><span className={`online-pill ${desktop ? '' : 'offline'}`}><i />{desktop ? 'EN LIGNE' : 'HORS LIGNE'}</span></div>
            <div className="companion-stage">
              <div className="speech-card"><span className="speech-label"><Sparkles size={12} /> SYSTÈME PRÊT</span><p>Je veille sur les actions locales. Chaque commande attend ton approbation.</p><span className="speech-corner" /></div>
              <div className="companion-glow" />
              <img className="companion-art" src="/nexus-01-companion.png" alt="NEXUS-01, mécha compagnon blanc et bleu aux détails dorés" />
              <div className="scanline" />
              <div className="companion-id"><span>NEXUS-01</span><small>GUARDIAN INTERFACE · V4.2</small></div>
            </div>
            <div className="companion-signal"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
            <div className="companion-caption"><span><Activity size={14} /> PRÉSENCE LOCALE</span><span>{desktop ? 'TAURI · CONNECTÉ' : 'TAURI · DÉCONNECTÉ'}</span></div>
            <button className="companion-launch-button" onClick={() => void enterCompanionMode()} disabled={!desktop}><Sparkles size={13} /> Mode compagnon bureau <ArrowUpRight size={13} /></button>
            {companionLaunchError && <small className="companion-launch-error">{companionLaunchError}</small>}
          </section>

          <section className="panel system-panel">
            <div className="section-heading system-heading"><div className="heading-icon system-icon"><Activity size={18} /></div><div><h2>État du système</h2><p>Limites actives du prototype</p></div></div>
            <div className="system-list">
              <div className="system-row"><span className="system-row-icon green-system"><Activity size={16} /></span><span>CPU · en temps réel</span><strong>{systemMetrics ? `${Math.round(systemMetrics.cpuPercent)} %` : '—'}</strong></div>
              <div className="system-row"><span className="system-row-icon purple-system"><HardDrive size={16} /></span><span>Mémoire vive</span><strong>{systemMetrics ? `${(systemMetrics.memoryUsedBytes / 1073741824).toFixed(1)} / ${(systemMetrics.memoryTotalBytes / 1073741824).toFixed(1)} Go · ${Math.round(systemMetrics.memoryPercent)} %` : '—'}</strong></div>
              <div className="system-row"><span className="system-row-icon"><TerminalSquare size={16} /></span><span>Actions prédéfinies</span><strong>7 · PS/CMD/Python</strong></div>
              <div className="system-row"><span className="system-row-icon green-system"><LockKeyhole size={16} /></span><span>Approbation</span><strong>À chaque action</strong></div>
              <div className="system-row"><span className="system-row-icon purple-system"><HardDrive size={16} /></span><span>Sortie maximale</span><strong>16 Ko</strong></div>
              <div className="system-row"><span className="system-row-icon cyan-system"><Clock3 size={16} /></span><span>Délai d’arrêt</span><strong>8 secondes</strong></div>
            </div>
            <div className="system-footer"><span><CircleCheck size={14} /> {systemMetrics ? 'Mesures Windows locales · actualisées toutes les 2 s' : 'Métriques locales indisponibles'}</span><span>V4.2</span></div>
          </section>

          <section className="panel connection-panel">
            <div className="connection-title"><span className="connection-icon"><Wifi size={16} /></span><div><strong>Connexion locale</strong><small>PC Windows · Tauri 2</small></div><span className="live-dot" /></div>
            <div className="connection-line"><span>Journal d’audit</span><strong><Check size={13} /> Actif</strong></div>
          </section>
        </aside>
      </div> : <div className="module-route-container"><ModuleWorkspace page={pageForPath[pathname] || 'agents'} terminalPanel={terminalPanel} desktop={desktop} logs={logs} /></div>}
      <footer className="workspace-footer"><span>NEXUS V4.2 <i /> PROTOTYPE LOCAL</span><span><Shield size={12} /> Les commandes restent sous ton contrôle</span></footer>
    </section>

    {pendingApproval && <div className="approval-backdrop"><section className="approval-card" role="dialog" aria-modal="true" aria-labelledby="approval-title">
      <button className="approval-close" onClick={rejectPendingAction} aria-label="Fermer"><X size={18} /></button>
      <div className="approval-shield"><Shield size={24} /></div><div className="approval-kicker">CONFIRMATION DE SÉCURITÉ</div>
      <h2 id="approval-title">Autoriser cette action ?</h2>
      <p className="approval-action-name">{actions.find((action) => action.id === pendingApproval)?.label}</p>
      <p className="approval-description">{actions.find((action) => action.id === pendingApproval)?.description}. Le script est prédéfini et ne peut modifier aucun fichier.</p>
      <div className="approval-meta"><span><LockKeyhole size={13} /> {actions.find((action) => action.id === pendingApproval)?.runtime} local</span><span><Clock3 size={13} /> Arrêt après 8 s</span></div>
      <div className="approval-buttons"><button className="approval-cancel" onClick={rejectPendingAction}>Annuler</button><button className="approval-confirm" onClick={executeApprovedAction}><Check size={16} /> Approuver et exécuter</button></div>
    </section></div>}
  </main>;
}
