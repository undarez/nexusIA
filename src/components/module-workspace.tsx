'use client';

import { ChangeEvent, FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openNexusBrowser } from '@/lib/desktop-windows';
import { AgentTopology, type TopologySkill } from '@/components/agent-topology';
import {
  Activity, ArrowRight, BookOpen, Check, Circle, Clock3, Code2, Folder,
  Globe2, HardDrive, LockKeyhole, Monitor, Plus, Rocket, Shield,
  Download, ExternalLink, Pencil, Sparkles, TerminalSquare, Trash2, Upload, Users, Wifi,
} from 'lucide-react';

type WorkspacePage = 'missions' | 'new-mission' | 'projects' | 'agents' | 'terminal' | 'browser' | 'skills' | 'settings' | 'devices' | 'history' | 'security';
type Mission = { id: string; title: string; state: 'À faire' | 'En cours' | 'Terminée'; createdAt: string; request?: string; skillIds?: string[] };
type Project = { id: string; name: string; note: string; createdAt: string };
type CustomSkill = { id: string; name: string; group: string; desc: string; createdAt: string; updatedAt?: string; version?: number };
type SkillLibraryItem = TopologySkill & { custom: boolean; createdAt?: string; updatedAt?: string; version?: number };
type AgentRunResult = { response: string; model: string; elapsedMs: number };
type HermesRunSnapshot = { runId: string; status: string; output: string | null; error: string | null };
type DeviceKey = 'printer' | 'phone' | 'tv';
type DeviceCheckState = { status: 'idle' | 'checking' | 'reachable' | 'absent' | 'error'; message?: string };

const titles: Record<WorkspacePage, { title: string; subtitle: string; icon: typeof Rocket }> = {
  missions: { title: 'Missions', subtitle: 'Organise et suis les tâches de ton espace local.', icon: Rocket },
  'new-mission': { title: 'Nouvelle mission', subtitle: 'Crée une mission et retrouve-la dans ton espace local.', icon: Plus },
  projects: { title: 'Mes projets', subtitle: 'Garde une liste locale des projets que tu pilotes.', icon: Folder },
  agents: { title: 'Agents IA', subtitle: 'Rôles disponibles et état réel de leur connexion.', icon: Users },
  terminal: { title: 'Terminal Studio', subtitle: 'PowerShell local, actions prédéfinies et approbation explicite.', icon: TerminalSquare },
  browser: { title: 'Navigateur NEXUS', subtitle: 'État de la connexion de navigation.', icon: Globe2 },
  skills: { title: 'Skills', subtitle: 'Compétences décrites pour les modules NEXUS.', icon: BookOpen },
  settings: { title: 'Configuration', subtitle: 'Préférences locales de l’interface.', icon: Activity },
  devices: { title: 'Appareils & Connexions', subtitle: 'État des connexions détectées par le prototype.', icon: Monitor },
  history: { title: 'Historique & Logs', subtitle: 'Événements de la session affichés dans le Terminal Studio.', icon: Clock3 },
  security: { title: 'Sécurité & Conformité', subtitle: 'Garde-fous actifs du terminal local.', icon: Shield },
};

const agents = [
  { name: 'Project Manager', role: 'Planification et pilotage', icon: Folder, color: 'cyan' },
  { name: 'UI / UX Designer', role: 'Conception des interfaces', icon: Sparkles, color: 'violet' },
  { name: 'Frontend Developer', role: 'Développement web', icon: Code2, color: 'blue' },
  { name: 'Android & Smart TV', role: 'Kotlin, Jetpack et ADB', icon: Monitor, color: 'green' },
  { name: 'Terminal Operator', role: 'Actions locales supervisées', icon: TerminalSquare, color: 'purple' },
  { name: 'Security Sentinel', role: 'Contrôle et conformité', icon: Shield, color: 'pink' },
];

const builtInAgentSkills: TopologySkill[] = [
  { id: 'builtin-security-review', name: 'Revue sécurité', group: 'Sécurité', desc: 'Repère les risques, les hypothèses et les actions qui demandent une confirmation.' },
  { id: 'builtin-web-research', name: 'Recherche web', group: 'Navigateur', desc: 'Structure une recherche, distingue les sources et signale les incertitudes.' },
  { id: 'builtin-ui-review', name: 'Revue UX', group: 'Design', desc: 'Vérifie la lisibilité, la navigation et les états de l’interface.' },
  { id: 'builtin-kotlin-review', name: 'Android et Kotlin', group: 'Développement', desc: 'Oriente les propositions vers Kotlin, Android et Jetpack Compose.' },
];

const defaultPrinterIp = process.env.NEXT_PUBLIC_DEFAULT_PRINTER_IP || '';

function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function useLocalList<T>(key: string): [T[], (value: T[] | ((current: T[]) => T[])) => void] {
  const [items, setItems] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setItems(readLocal<T[]>(key, []));
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    if (loaded) {
      try { localStorage.setItem(key, JSON.stringify(items)); } catch { /* Storage may be unavailable. */ }
    }
  }, [items, key, loaded]);
  return [items, setItems];
}

export function ModuleWorkspace({ page, terminalPanel, desktop, logs }: {
  page: WorkspacePage;
  terminalPanel: ReactNode;
  desktop: boolean;
  logs: string[];
}) {
  const header = titles[page];
  const Icon = header.icon;
  const [missions, setMissions] = useLocalList<Mission>('nexus.missions.v1');
  const [projects, setProjects] = useLocalList<Project>('nexus.projects.v1');
  const [customSkills, setCustomSkills] = useLocalList<CustomSkill>('nexus.customSkills.v1');
  const [missionTitle, setMissionTitle] = useState('');
  const [missionRequest, setMissionRequest] = useState('');
  const [selectedMissionSkills, setSelectedMissionSkills] = useState<string[]>([]);
  const [missionToLoad, setMissionToLoad] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectNote, setProjectNote] = useState('');
  const [browserAddress, setBrowserAddress] = useState('');
  const [savedAddress, setSavedAddress] = useState('');
  const [browserError, setBrowserError] = useState('');
  const [browserOpening, setBrowserOpening] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [search, setSearch] = useState('');
  const [skillName, setSkillName] = useState('');
  const [skillGroup, setSkillGroup] = useState('Personnel');
  const [skillInstructions, setSkillInstructions] = useState('');
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [skillTransferMessage, setSkillTransferMessage] = useState('');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [ollamaError, setOllamaError] = useState('');
  const [hermesModels, setHermesModels] = useState<string[]>([]);
  const [hermesStatus, setHermesStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [hermesError, setHermesError] = useState('');
  const [hermesEnabledToolsets, setHermesEnabledToolsets] = useState<string[]>([]);
  const [openaiModels, setOpenaiModels] = useState<string[]>([]);
  const [openaiKeyConfigured, setOpenaiKeyConfigured] = useState(false);
  const [openaiKeyDraft, setOpenaiKeyDraft] = useState('');
  const [openaiStatus, setOpenaiStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [openaiError, setOpenaiError] = useState('');
  const [agentModels, setAgentModels] = useState<Record<string, string>>({});
  const [selectedAgent, setSelectedAgent] = useState(agents[0].name);
  const [agentProvider, setAgentProvider] = useState<'ollama' | 'hermes' | 'openai'>('hermes');
  const [selectedAgentModel, setSelectedAgentModel] = useState('');
  const [selectedAgentSkills, setSelectedAgentSkills] = useState<string[]>([]);
  const [selectedAgentTeam, setSelectedAgentTeam] = useState<string[]>([agents[0].name]);
  const [allowHermesTools, setAllowHermesTools] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentResponse, setAgentResponse] = useState('');
  const [agentRunState, setAgentRunState] = useState<'idle' | 'running' | 'error'>('idle');
  const [agentRunError, setAgentRunError] = useState('');
  const [hermesCompatibilityMode, setHermesCompatibilityMode] = useState(false);
  const [activeGraphAgents, setActiveGraphAgents] = useState<string[]>([]);
  const [completedGraphAgents, setCompletedGraphAgents] = useState<string[]>([]);
  const [failedGraphAgent, setFailedGraphAgent] = useState<string | null>(null);
  const activeHermesRuns = useRef<Set<string>>(new Set());
  const cancelHermesTeam = useRef(false);
  const [deviceIps, setDeviceIps] = useState<Record<DeviceKey, string>>({ printer: defaultPrinterIp, phone: '', tv: '' });
  const [deviceChecks, setDeviceChecks] = useState<Record<DeviceKey, DeviceCheckState>>({
    printer: { status: 'idle' }, phone: { status: 'idle' }, tv: { status: 'idle' },
  });
  const agentAvailableModels = agentProvider === 'ollama' ? ollamaModels : agentProvider === 'hermes' ? hermesModels : openaiModels;
  const agentEffectiveModel = selectedAgentModel || (agentProvider === 'ollama' ? agentModels[selectedAgent] : '') || agentAvailableModels[0] || '';
  const agentSkillOptions: TopologySkill[] = [...builtInAgentSkills, ...customSkills];
  const activeAgentTeam = selectedAgentTeam.length ? selectedAgentTeam : [selectedAgent];
  const hermesMultiAgentToolsConflict = agentProvider === 'hermes'
    && hermesEnabledToolsets.length > 0
    && activeAgentTeam.some((role) => role !== selectedAgent);
  const skillLibraryItems: SkillLibraryItem[] = [
    ...[
      { name: 'Actions PowerShell limitées', group: 'Terminal Studio', desc: 'Date/heure, résumé de processus et dossier courant ; approbation obligatoire.' },
      { name: 'Journal d’audit local', group: 'Sécurité', desc: 'Événements d’approbation, refus, début et résultat des actions terminal.' },
      { name: 'Suivi de missions local', group: 'Missions', desc: 'Créer des missions et mettre à jour leur état sur ce profil.' },
      { name: 'Fiches projets locales', group: 'Projets', desc: 'Enregistrer des notes de projet dans le stockage local de l’application.' },
    ].map((skill) => ({ ...skill, id: `builtin-${skill.name}`, custom: false })),
    ...customSkills.map((skill) => ({ ...skill, custom: true })),
  ];

  useEffect(() => {
    try {
      setSavedAddress(localStorage.getItem('nexus.browser.bookmark.v1') || '');
      const savedDeviceIps = localStorage.getItem('nexus.devices.lanIps.v1');
      if (savedDeviceIps) {
        const parsed: unknown = JSON.parse(savedDeviceIps);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const values = parsed as Partial<Record<DeviceKey, unknown>>;
          setDeviceIps({ printer: typeof values.printer === 'string' ? values.printer : defaultPrinterIp, phone: typeof values.phone === 'string' ? values.phone : '', tv: typeof values.tv === 'string' ? values.tv : '' });
        }
      }
      const savedModels = localStorage.getItem('nexus.agent.ollamaModels.v1');
      if (savedModels) {
        const parsed: unknown = JSON.parse(savedModels);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) setAgentModels(parsed as Record<string, string>);
      }
      const preference = localStorage.getItem('nexus.ui.reduceMotion.v1') === 'true';
      setReducedMotion(preference);
      document.documentElement.classList.toggle('reduce-motion', preference);
    } catch { /* The workspace remains usable without persistent preferences. */ }
  }, []);

  useEffect(() => {
    if (page !== 'agents') return;
    try {
      const raw = localStorage.getItem('nexus.agent.draftFromTerminal.v1');
      if (!raw) return;
      const draft: unknown = JSON.parse(raw);
      if (draft && typeof draft === 'object' && 'prompt' in draft && typeof draft.prompt === 'string' && 'skillIds' in draft && Array.isArray(draft.skillIds)) {
        setAgentPrompt(draft.prompt);
        setSelectedAgentSkills(draft.skillIds.filter((id): id is string => typeof id === 'string'));
        localStorage.removeItem('nexus.agent.draftFromTerminal.v1');
      }
    } catch { /* Keep the Agents workspace usable when storage is unavailable or malformed. */ }
  }, [page]);

  useEffect(() => {
    if (!desktop) return;
    void invoke<boolean>('openai_api_key_configured').then(setOpenaiKeyConfigured).catch(() => setOpenaiKeyConfigured(false));
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    void loadOllamaModels();
    void loadHermesModels();
    void invoke<boolean>('openai_api_key_configured').then((configured) => {
      setOpenaiKeyConfigured(configured);
      if (configured) void loadOpenaiModels();
    }).catch(() => setOpenaiKeyConfigured(false));
  }, [desktop]);

  function createMission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = missionTitle.trim();
    if (!title) return;
    setMissions((current) => [{ id: crypto.randomUUID(), title, state: 'À faire', createdAt: new Date().toLocaleString('fr-FR'), request: missionRequest.trim(), skillIds: selectedMissionSkills }, ...current]);
    setMissionTitle('');
    setMissionRequest('');
    setSelectedMissionSkills([]);
  }

  function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) return;
    setProjects((current) => [{ id: crypto.randomUUID(), name, note: projectNote.trim(), createdAt: new Date().toLocaleDateString('fr-FR') }, ...current]);
    setProjectName('');
    setProjectNote('');
  }

  function createSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = skillName.trim();
    const instructions = skillInstructions.trim();
    if (!name || !instructions) return;
    const now = new Date().toLocaleDateString('fr-FR');
    if (editingSkillId) {
      setCustomSkills((current) => current.map((skill) => skill.id === editingSkillId
        ? { ...skill, name, group: skillGroup.trim() || 'Personnel', desc: instructions, updatedAt: now, version: (skill.version || 1) + 1 }
        : skill));
      setEditingSkillId(null);
    } else {
      setCustomSkills((current) => [{ id: crypto.randomUUID(), name, group: skillGroup.trim() || 'Personnel', desc: instructions, createdAt: now, version: 1 }, ...current]);
    }
    setSkillName('');
    setSkillGroup('Personnel');
    setSkillInstructions('');
  }

  function editSkill(skill: CustomSkill) {
    setEditingSkillId(skill.id);
    setSkillName(skill.name);
    setSkillGroup(skill.group);
    setSkillInstructions(skill.desc);
  }

  function cancelSkillEdit() {
    setEditingSkillId(null);
    setSkillName('');
    setSkillGroup('Personnel');
    setSkillInstructions('');
  }

  function exportSkills() {
    const payload = JSON.stringify({ format: 'nexus-skills', version: 1, exportedAt: new Date().toISOString(), skills: customSkills }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nexus-skills.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSkillTransferMessage(`${customSkills.length} skill${customSkills.length === 1 ? '' : 's'} exporté${customSkills.length === 1 ? '' : 's'}.`);
  }

  async function importSkills(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const rows = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && 'format' in parsed && parsed.format === 'nexus-skills' && 'skills' in parsed && Array.isArray(parsed.skills)
          ? parsed.skills
          : null;
      if (!rows) throw new Error('Ce fichier ne contient pas une bibliothèque NEXUS valide.');
      const imported: CustomSkill[] = rows.map((row: unknown, index: number) => {
        if (!row || typeof row !== 'object' || !('name' in row) || typeof row.name !== 'string' || !row.name.trim() || !('desc' in row) || typeof row.desc !== 'string' || !row.desc.trim()) {
          throw new Error(`La fiche ${index + 1} doit avoir un nom et des consignes textuelles.`);
        }
        const item = row as Record<string, unknown>;
        const name = item.name as string;
        const desc = item.desc as string;
        return {
          id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
          name: name.trim(),
          group: typeof item.group === 'string' && item.group.trim() ? item.group.trim() : 'Importé',
          desc,
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toLocaleDateString('fr-FR'),
          updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
          version: typeof item.version === 'number' && Number.isInteger(item.version) && item.version > 0 ? item.version : 1,
        };
      });
      setCustomSkills((current) => {
        const merged = new Map(current.map((skill) => [skill.id, skill]));
        imported.forEach((skill) => merged.set(skill.id, skill));
        return [...merged.values()];
      });
      setSkillTransferMessage(`${imported.length} skill${imported.length === 1 ? '' : 's'} importé${imported.length === 1 ? '' : 's'}; les identifiants déjà présents ont été mis à jour.`);
    } catch (error) {
      setSkillTransferMessage(`Import impossible : ${String(error)}`);
    } finally {
      event.target.value = '';
    }
  }

  async function loadOllamaModels() {
    if (!desktop || ollamaStatus === 'loading') return;
    setOllamaStatus('loading');
    setOllamaError('');
    try {
      const models = await invoke<string[]>('list_ollama_models');
      setOllamaModels(models);
      setOllamaStatus('ready');
    } catch (error) {
      setOllamaError(String(error));
      setOllamaStatus('error');
    }
  }

  async function loadHermesModels() {
    if (!desktop || hermesStatus === 'loading') return;
    setHermesStatus('loading');
    setHermesError('');
    try {
      const [models, enabledToolsets] = await Promise.all([
        invoke<string[]>('list_hermes_models'),
        invoke<string[]>('hermes_text_only_status'),
      ]);
      setHermesModels(models);
      setHermesEnabledToolsets(enabledToolsets);
      setHermesStatus('ready');
    } catch (error) {
      setHermesError(String(error));
      setHermesStatus('error');
    }
  }

  async function loadOpenaiModels() {
    if (!desktop || openaiStatus === 'loading') return;
    setOpenaiStatus('loading');
    setOpenaiError('');
    try {
      const models = await invoke<string[]>('list_openai_models');
      setOpenaiModels(models);
      setOpenaiStatus('ready');
    } catch (error) {
      setOpenaiError(String(error));
      setOpenaiStatus('error');
    }
  }

  async function saveOpenaiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!desktop || !openaiKeyDraft.trim()) return;
    setOpenaiStatus('loading');
    setOpenaiError('');
    try {
      await invoke('save_openai_api_key', { key: openaiKeyDraft });
      setOpenaiKeyDraft('');
      setOpenaiKeyConfigured(true);
      await loadOpenaiModels();
    } catch (error) {
      setOpenaiError(String(error));
      setOpenaiStatus('error');
    }
  }

  function updateDeviceIp(device: DeviceKey, value: string) {
    setDeviceIps((current) => {
      const next = { ...current, [device]: value };
      try { localStorage.setItem('nexus.devices.lanIps.v1', JSON.stringify(next)); } catch { /* Keep the current session usable. */ }
      return next;
    });
    setDeviceChecks((current) => ({ ...current, [device]: { status: 'idle' } }));
  }

  async function checkLanDevice(device: DeviceKey) {
    if (!desktop || deviceChecks[device].status === 'checking') return;
    setDeviceChecks((current) => ({ ...current, [device]: { status: 'checking' } }));
    try {
      const reachable = await invoke<boolean>('check_lan_device', { host: deviceIps[device] });
      setDeviceChecks((current) => ({ ...current, [device]: { status: reachable ? 'reachable' : 'absent' } }));
    } catch (error) {
      setDeviceChecks((current) => ({ ...current, [device]: { status: 'error', message: String(error) } }));
    }
  }

  function assignAgentModel(agent: string, model: string) {
    setAgentModels((current) => {
      const next = { ...current, [agent]: model };
      try { localStorage.setItem('nexus.agent.ollamaModels.v1', JSON.stringify(next)); } catch { /* Keep current session usable. */ }
      return next;
    });
  }

  async function runSelectedAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const availableModels = agentProvider === 'ollama' ? ollamaModels : agentProvider === 'hermes' ? hermesModels : openaiModels;
    const model = selectedAgentModel || (agentProvider === 'ollama' ? agentModels[selectedAgent] : '') || availableModels[0];
    if (!desktop || !model || !agentPrompt.trim() || agentRunState === 'running') return;
    const team = activeAgentTeam;
    if (hermesMultiAgentToolsConflict) {
      setAgentRunError('Hermes expose les outils au niveau de toute la plateforme API. Pour lancer plusieurs rôles, désactive ses toolsets API Server; sinon, choisis un agent unique.');
      setAgentRunState('error');
      return;
    }
    if (agentProvider === 'hermes' && hermesEnabledToolsets.length > 0 && !allowHermesTools) {
      setAgentRunError(`Hermes dispose d’outils API actifs (${hermesEnabledToolsets.join(', ')}). Coche « Autoriser les outils Hermes » pour cette demande si tu veux lui permettre de les utiliser.`);
      setAgentRunState('error');
      return;
    }
    const skills = agentSkillOptions.filter((item) => selectedAgentSkills.includes(item.id));
    const skillInstructions = skills.map((skill) => `## ${skill.name}\n${skill.desc}`).join('\n\n');
    setAgentRunState('running');
    setAgentRunError('');
    setAgentResponse('');
    setHermesCompatibilityMode(false);
    setActiveGraphAgents([]);
    setCompletedGraphAgents([]);
    setFailedGraphAgent(null);
    cancelHermesTeam.current = false;
    activeHermesRuns.current.clear();
    let executingRole = selectedAgent;
    let failedRole: string | null = null;
    try {
      const runRole = async (role: string, prompt: string, coordinator: boolean): Promise<AgentRunResult> => {
        const input = {
          model,
          role,
          prompt,
          skillName: skills.map((skill) => skill.name).join(', ') || null,
          skillInstructions: skillInstructions || null,
          enableHermesTools: agentProvider === 'hermes' && coordinator && allowHermesTools && hermesEnabledToolsets.length > 0,
        };
        if (agentProvider !== 'hermes') {
          const command = agentProvider === 'ollama' ? 'run_ollama_agent' : 'run_openai_agent';
          return invoke<AgentRunResult>(command, { input });
        }
        let runId: string;
        try {
          runId = await invoke<string>('start_hermes_run', { input });
        } catch (error) {
          if (!/start_hermes_run.*(?:not allowed|not found)|(?:not allowed|not found).*start_hermes_run/i.test(String(error))) throw error;
          setHermesCompatibilityMode(true);
          return invoke<AgentRunResult>('run_hermes_agent', { input });
        }
        activeHermesRuns.current.add(runId);
        const startedAt = Date.now();
        let stopRequested = false;
        try {
          while (Date.now() - startedAt < 180_000) {
            const snapshot = await invoke<HermesRunSnapshot>('get_hermes_run', { runId });
            if (snapshot.status === 'completed') {
              if (!snapshot.output) throw new Error('Hermes a terminé sans réponse textuelle.');
              return { response: snapshot.output, model, elapsedMs: Date.now() - startedAt };
            }
            if (['failed', 'cancelled', 'interrupted'].includes(snapshot.status)) {
              throw new Error(snapshot.error || `Run Hermes ${snapshot.status}.`);
            }
            if (cancelHermesTeam.current && !stopRequested) {
              stopRequested = true;
              await invoke('stop_hermes_run', { runId });
            }
            await new Promise((resolve) => window.setTimeout(resolve, 900));
          }
          await invoke('stop_hermes_run', { runId });
          throw new Error('Délai de 3 minutes atteint; NEXUS a demandé l’arrêt du run Hermes.');
        } finally {
          activeHermesRuns.current.delete(runId);
        }
      };
      const specialists = team.filter((role) => role !== selectedAgent);
      const contributions: Array<{ role: string; response: string }> = [];
      for (let offset = 0; offset < specialists.length; offset += 2) {
        if (cancelHermesTeam.current) throw new Error('Mission Hermes annulée.');
        const batch = specialists.slice(offset, offset + 2);
        setActiveGraphAgents(batch);
        const results = await Promise.all(batch.map(async (role) => {
          try {
            const result = await runRole(role, agentPrompt.trim(), false);
            return { role, response: result.response };
          } catch (error) {
            failedRole = role;
            throw error;
          }
        }));
        contributions.push(...results);
        setCompletedGraphAgents((current) => [...current, ...results.map((result) => result.role)]);
      }

      if (contributions.length) {
        if (cancelHermesTeam.current) throw new Error('Mission Hermes annulée.');
        executingRole = selectedAgent;
        setActiveGraphAgents([selectedAgent]);
        const contributionBrief = contributions.map(({ role, response }) => `### Contribution de ${role}\n${response}`).join('\n\n');
        const synthesisPrompt = `${agentPrompt.trim()}\n\nContributions des agents spécialistes (à examiner et mettre en relation) :\n${contributionBrief}\n\nEn tant qu’agent coordinateur ${selectedAgent}, compare ces contributions, relève les désaccords ou hypothèses non vérifiées, puis fournis une synthèse exploitable avec les prochaines étapes. Ne prétends pas avoir exécuté d’action qui n’a pas été confirmée.`;
        const synthesis = await runRole(selectedAgent, synthesisPrompt, true);
        setCompletedGraphAgents((current) => current.includes(selectedAgent) ? current : [...current, selectedAgent]);
        setAgentResponse(`${contributionBrief}\n\n### Synthèse de ${selectedAgent}\n${synthesis.response}\n\n— ${agentProvider === 'ollama' ? 'Ollama' : agentProvider === 'hermes' ? 'Hermes' : 'OpenAI'} · ${model} · ${contributions.length} spécialiste${contributions.length === 1 ? '' : 's'} en parallèle · 2 requêtes simultanées maximum`);
      } else {
        setActiveGraphAgents([selectedAgent]);
        const result = await runRole(selectedAgent, agentPrompt.trim(), true);
        setCompletedGraphAgents((current) => current.includes(selectedAgent) ? current : [...current, selectedAgent]);
        setAgentResponse(`### ${selectedAgent}\n${result.response}\n\n— ${agentProvider === 'ollama' ? 'Ollama' : agentProvider === 'hermes' ? 'Hermes' : 'OpenAI'} · ${model} · agent unique`);
      }
      setActiveGraphAgents([]);
      setAgentRunState('idle');
    } catch (error) {
      setFailedGraphAgent(failedRole || executingRole);
      setActiveGraphAgents([]);
      setAgentRunError(String(error));
      setAgentRunState('error');
    } finally {
      activeHermesRuns.current.clear();
    }
  }

  async function cancelHermesAgentRun() {
    cancelHermesTeam.current = true;
    await Promise.all([...activeHermesRuns.current].map((runId) => invoke('stop_hermes_run', { runId }).catch(() => undefined)));
  }

  function addMissionFromQuickForm(event: FormEvent<HTMLFormElement>) {
    createMission(event);
  }

  function loadMissionIntoAgents() {
    const mission = missions.find((item) => item.id === missionToLoad);
    if (!mission) return;
    setAgentPrompt([mission.title, mission.request].filter(Boolean).join('\n\n'));
    setSelectedAgentSkills((mission.skillIds || []).filter((id) => agentSkillOptions.some((skill) => skill.id === id)));
  }

  function saveBookmark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void openBrowserTarget(browserAddress, true);
  }

  async function openBrowserTarget(value: string, save = false) {
    const query = value.trim();
    if (!query || browserOpening) return;
    setBrowserOpening(true);
    setBrowserError('');
    try {
      const looksLikeAddress = /^(https?:\/\/|[\w-]+\.[a-z]{2,}(?::\d+)?(?:\/|$))/i.test(query);
      const url = new URL(looksLikeAddress ? (/^https?:\/\//i.test(query) ? query : `https://${query}`) : `https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
      if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2048) {
        throw new Error('Utilise une adresse HTTPS sans identifiant intégré, ou saisis des mots à rechercher.');
      }
      await openNexusBrowser(url.toString());
      setBrowserAddress(url.toString());
      if (save) {
        setSavedAddress(url.toString());
        localStorage.setItem('nexus.browser.bookmark.v1', url.toString());
      }
    } catch (error) {
      setBrowserError(String(error));
    } finally {
      setBrowserOpening(false);
    }
  }

  function setMotionPreference(value: boolean) {
    setReducedMotion(value);
    localStorage.setItem('nexus.ui.reduceMotion.v1', String(value));
    document.documentElement.classList.toggle('reduce-motion', value);
  }

  return <div className="module-page">
    <header className="module-page-header">
      <div className="module-breadcrumb">NEXUS V4.2 <span>/</span> ESPACE DE TRAVAIL <span>/</span> {header.title.toLocaleUpperCase('fr-FR')}</div>
      <div className="module-title-row"><div className="module-title-icon"><Icon size={22} /></div><div><h1>{header.title}</h1><p>{header.subtitle}</p></div><span className="module-local-badge"><i /> LOCAL</span></div>
    </header>

    {!desktop && <section className="web-beta-notice" role="status"><strong>Bêta navigateur · mode local limité</strong><span>Cette session permet d’utiliser les pages, missions, projets et skills dans ce navigateur. Les moteurs IA locaux, le Terminal Studio, les appareils et le compagnon flottant nécessitent le runtime Windows NEXUS.</span></section>}

    {page === 'terminal' && <div className="module-terminal">{terminalPanel}</div>}

    {(page === 'missions' || page === 'new-mission') && <div className="module-content-grid">
      <section className="panel module-card mission-manager-card">
        <div className="module-card-heading"><div><h2>{page === 'new-mission' ? 'Préparer une mission' : 'Créer une mission'}</h2><p>Les données restent enregistrées dans ce profil local.</p></div><span className="module-count">{missions.length} mission{missions.length > 1 ? 's' : ''}</span></div>
        <form className="module-form" onSubmit={addMissionFromQuickForm}><label htmlFor="mission-title">Nom de la mission</label><input id="mission-title" value={missionTitle} onChange={(event) => setMissionTitle(event.target.value)} placeholder="Ex. Préparer mon prochain projet" required maxLength={100} /><label htmlFor="mission-request">Demande à confier à l’équipe (facultatif)</label><textarea id="mission-request" value={missionRequest} onChange={(event) => setMissionRequest(event.target.value)} placeholder="Décris le résultat attendu et les contraintes…" /><label>Skills à joindre à la mission</label><div className="agent-check-grid">{agentSkillOptions.map((skill) => <label key={skill.id}><input type="checkbox" checked={selectedMissionSkills.includes(skill.id)} onChange={() => setSelectedMissionSkills((current) => current.includes(skill.id) ? current.filter((id) => id !== skill.id) : [...current, skill.id])} />{skill.name}</label>)}</div><div className="module-form-row"><button className="module-primary-button"><Plus size={16} /> Créer la mission</button></div></form>
      </section>
      <section className="panel module-card">
        <div className="module-card-heading"><div><h2>Tableau des missions</h2><p>Fais avancer chaque mission à ton rythme.</p></div><Rocket size={19} /></div>
        {missions.length === 0 ? <div className="module-empty"><Circle size={22} /><strong>Aucune mission pour l’instant</strong><span>Crée une mission pour la voir apparaître ici.</span></div> : <div className="managed-list">{missions.map((mission) => { const attachedSkills = (mission.skillIds || []).map((id) => agentSkillOptions.find((skill) => skill.id === id)?.name).filter((name): name is string => Boolean(name)); return <article className="managed-row" key={mission.id}><span className={`managed-state ${mission.state === 'Terminée' ? 'done' : mission.state === 'En cours' ? 'running' : ''}`}><Circle size={13} /></span><div><strong>{mission.title}</strong><small>{mission.createdAt} · {mission.state}</small>{mission.request && <p className="mission-request-preview">{mission.request}</p>}{attachedSkills.length > 0 && <small>Skills : {attachedSkills.join(' · ')}</small>}</div><button className="subtle-button" onClick={() => setMissions((current) => current.map((item) => item.id !== mission.id ? item : { ...item, state: item.state === 'À faire' ? 'En cours' : item.state === 'En cours' ? 'Terminée' : 'À faire' }))}>{mission.state === 'À faire' ? 'Démarrer' : mission.state === 'En cours' ? 'Terminer' : 'Réouvrir'}</button><button className="danger-icon-button" aria-label={`Retirer ${mission.title}`} onClick={() => setMissions((current) => current.filter((item) => item.id !== mission.id))}><Trash2 size={14} /></button></article>; })}</div>}
      </section>
    </div>}

    {page === 'projects' && <div className="module-content-grid">
      <section className="panel module-card"><div className="module-card-heading"><div><h2>Ajouter un projet</h2><p>Crée une fiche de suivi locale ; aucun dossier n’est modifié.</p></div><Folder size={19} /></div><form className="module-form" onSubmit={createProject}><label htmlFor="project-name">Nom du projet</label><input id="project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Nom de projet" maxLength={80} required /><label htmlFor="project-note">Note (facultative)</label><textarea id="project-note" value={projectNote} onChange={(event) => setProjectNote(event.target.value)} placeholder="Objectif ou prochaine étape" maxLength={240} /><button className="module-primary-button"><Plus size={16} /> Ajouter le projet</button></form></section>
      <section className="panel module-card"><div className="module-card-heading"><div><h2>Projets suivis</h2><p>{projects.length} fiche{projects.length === 1 ? '' : 's'} stockée{projects.length === 1 ? '' : 's'} localement</p></div><HardDrive size={19} /></div>{projects.length === 0 ? <div className="module-empty"><Folder size={22} /><strong>Aucun projet enregistré</strong><span>Ajoute une fiche pour commencer ton espace de suivi.</span></div> : <div className="managed-list">{projects.map((project) => <article className="managed-row project-row" key={project.id}><span className="managed-state running"><Folder size={14} /></span><div><strong>{project.name}</strong><small>{project.note || 'Aucune note'} · ajouté le {project.createdAt}</small></div><button className="danger-icon-button" aria-label={`Retirer ${project.name}`} onClick={() => setProjects((current) => current.filter((item) => item.id !== project.id))}><Trash2 size={14} /></button></article>)}</div>}</section>
    </div>}

    {page === 'agents' && <>
      <AgentTopology
        agents={agents}
        skills={agentSkillOptions}
        selectedAgents={selectedAgentTeam}
        selectedSkills={selectedAgentSkills}
        activeAgents={activeGraphAgents}
        completedAgents={completedGraphAgents}
        failedAgent={failedGraphAgent}
        engineLabel={agentProvider === 'hermes' ? 'HERMES' : agentProvider === 'ollama' ? 'OLLAMA' : 'OPENAI'}
        engineReady={agentProvider === 'hermes' ? hermesStatus === 'ready' : agentProvider === 'ollama' ? ollamaStatus === 'ready' : openaiStatus === 'ready'}
        onToggleAgent={(name) => setSelectedAgentTeam((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name])}
        onToggleSkill={(id) => setSelectedAgentSkills((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
      />
      <section className="panel module-card"><div className="module-card-heading"><div><h2>Moteur local Ollama</h2><p>Connexion contrôlée automatiquement à l’ouverture de NEXUS et actualisée à la demande.</p></div><button className="module-primary-button" onClick={() => void loadOllamaModels()} disabled={!desktop || ollamaStatus === 'loading'}><Activity size={15} />{ollamaStatus === 'loading' ? 'Vérification…' : 'Actualiser'}</button></div>{ollamaStatus === 'ready' ? <><div className="connection-state-large"><span className="connection-state-icon connected"><Check size={22} /></span><div><strong>Ollama connecté · {ollamaModels.length} modèle{ollamaModels.length === 1 ? '' : 's'} local{ollamaModels.length === 1 ? '' : 'aux'}</strong><small>Les noms de modèles sont lus depuis le service local; aucun prompt n’est envoyé.</small></div></div>{ollamaModels.length > 0 && <div className="ollama-model-list">{ollamaModels.map((model) => <span className="ollama-model-chip" key={model}>{model}</span>)}</div>}</> : ollamaStatus === 'error' ? <div className="module-info-note"><LockKeyhole size={15} /> Ollama n’a pas répondu : {ollamaError}</div> : <div className="module-info-note"><LockKeyhole size={15} />{desktop ? 'Vérification automatique en cours…' : 'Ouvre NEXUS dans l’application Windows pour vérifier Ollama.'}</div>}</section>
      <section className="panel module-card"><div className="module-card-heading"><div><h2>Moteur Hermes local</h2><p>Connexion contrôlée automatiquement à l’ouverture. Les outils configurés peuvent être autorisés pour une demande précise.</p></div><button className="module-primary-button" onClick={() => void loadHermesModels()} disabled={!desktop || hermesStatus === 'loading'}><Activity size={15} />{hermesStatus === 'loading' ? 'Vérification…' : 'Actualiser'}</button></div>{hermesStatus === 'ready' ? <><div className="connection-state-large"><span className="connection-state-icon connected"><Check size={22} /></span><div><strong>Hermes authentifié · {hermesModels.length} modèle{hermesModels.length === 1 ? '' : 's'}</strong><small>{hermesEnabledToolsets.length === 0 ? 'Aucun outil API Server actif.' : `${hermesEnabledToolsets.length} toolset${hermesEnabledToolsets.length === 1 ? '' : 's'} disponible${hermesEnabledToolsets.length === 1 ? '' : 's'}; autorisation à la demande.`}</small></div></div>{hermesModels.length > 0 && <div className="ollama-model-list">{hermesModels.map((model) => <span className="ollama-model-chip hermes-model-chip" key={model}>{model}</span>)}</div>}</> : hermesStatus === 'error' ? <div className="module-info-note"><LockKeyhole size={15} /> Hermes ne répond pas : {hermesError}</div> : <div className="module-info-note"><LockKeyhole size={15} />{desktop ? 'Vérification automatique en cours…' : 'Ouvre NEXUS dans l’application Windows pour vérifier Hermes.'}</div>}</section>
      <section className="panel module-card hermes-whatsapp-guide"><div className="module-card-heading"><div><h2>WhatsApp pour Hermes</h2><p>La passerelle Hermes reçoit tes messages WhatsApp et les transmet à son agent. NEXUS ne stocke pas la session WhatsApp.</p></div><Globe2 size={19} /></div><ol><li>Dans PowerShell, vérifie d’abord <code>hermes gateway status</code>.</li><li>Lance l’assistant de jumelage <code>hermes whatsapp</code>, puis scanne le QR avec WhatsApp → Appareils connectés → Connecter un appareil.</li><li>Autorise uniquement ton numéro dans la liste des utilisateurs, puis redémarre l’instance existante avec <code>hermes gateway restart</code>.</li><li>Vérifie l’état avec <code>hermes gateway status</code> et envoie un message privé de test.</li></ol><div className="module-info-note"><LockKeyhole size={15} /> La passerelle WhatsApp Hermes peut donner accès à ses outils, y compris au terminal. Garde une liste d’utilisateurs limitée à ton numéro. L’adaptateur Baileys est non officiel et présente un risque de restriction du compte.</div><a href="https://hermes-agent.nousresearch.com/docs/user-guide/messaging/whatsapp" target="_blank" rel="noreferrer">Guide WhatsApp officiel Hermes <ExternalLink size={13} /></a></section>
      <section className="panel module-card"><div className="module-card-heading"><div><h2>Moteur OpenAI</h2><p>La clé se configure dans Configuration et reste chiffrée dans le profil Windows.</p></div><button className="module-primary-button" onClick={() => void loadOpenaiModels()} disabled={!desktop || !openaiKeyConfigured || openaiStatus === 'loading'}><Activity size={15} />{openaiStatus === 'loading' ? 'Vérification…' : openaiKeyConfigured ? 'Vérifier OpenAI' : 'Clé requise'}</button></div>{openaiStatus === 'ready' ? <div className="ollama-model-list">{openaiModels.map((model) => <span className="ollama-model-chip" key={model}>{model}</span>)}</div> : openaiStatus === 'error' ? <div className="module-info-note"><LockKeyhole size={15} /> OpenAI : {openaiError}</div> : <div className="module-info-note"><LockKeyhole size={15} />{openaiKeyConfigured ? 'Vérifie les modèles GPT disponibles pour ce compte API.' : 'Aucune clé enregistrée. Ajoute-la dans Configuration.'}</div>}</section>
      <section className="panel module-card"><div className="module-card-heading"><div><h2>Rôles de l’orchestrateur</h2><p>Choisis plusieurs rôles pour qu’ils se transmettent leurs réponses dans une même mission.</p></div><span className="module-count">{agents.length} rôles</span></div><div className="module-agent-grid">{agents.map(({ name, role, icon: AgentIcon, color }) => <article className="module-agent-card agent-model-card" key={name}><span className={`agent-icon ${color}`}><AgentIcon size={20} /></span><div className="agent-model-copy"><strong>{name}</strong><small>{role}</small><select aria-label={`Modèle Ollama pour ${name}`} value={agentModels[name] || ''} onChange={(event) => assignAgentModel(name, event.target.value)} disabled={ollamaModels.length === 0}><option value="">Aucun modèle associé</option>{ollamaModels.map((model) => <option key={model} value={model}>{model}</option>)}</select></div><span className={ollamaStatus === 'ready' ? 'skill-available' : 'not-connected'}><i /> {ollamaStatus === 'ready' ? 'OLLAMA' : ollamaStatus === 'loading' ? 'TEST…' : 'HORS LIGNE'}</span></article>)}</div></section>
      <section className="panel module-card"><div className="module-card-heading"><div><h2>Orchestrer une équipe</h2><p>Les spécialistes travaillent par lots de deux; l’agent de départ analyse leurs contributions et rédige la synthèse. Choisis les rôles et skills.</p></div><Sparkles size={19} /></div><form className="module-form agent-run-form" onSubmit={(event) => void runSelectedAgent(event)}>
        {missions.length > 0 && <div className="module-form-row mission-agent-loader"><select aria-label="Mission à charger" value={missionToLoad} onChange={(event) => setMissionToLoad(event.target.value)}><option value="">Charger une mission existante…</option>{missions.map((mission) => <option value={mission.id} key={mission.id}>{mission.title}</option>)}</select><button type="button" className="subtle-button" onClick={loadMissionIntoAgents} disabled={!missionToLoad}>Charger demande et skills</button></div>}
        <label htmlFor="agent-role">Agent de départ</label><select id="agent-role" value={selectedAgent} onChange={(event) => { setSelectedAgent(event.target.value); setSelectedAgentModel(''); setSelectedAgentTeam((current) => current.includes(event.target.value) ? current : [event.target.value, ...current]); }}>{agents.map((agent) => <option key={agent.name} value={agent.name}>{agent.name}</option>)}</select>
        <label>Équipe participante</label><div className="agent-check-grid">{agents.map((agent) => <label key={agent.name}><input type="checkbox" checked={selectedAgentTeam.includes(agent.name)} onChange={() => setSelectedAgentTeam((current) => current.includes(agent.name) ? current.filter((name) => name !== agent.name) : [...current, agent.name])} />{agent.name}</label>)}</div>
        <label htmlFor="agent-provider">Moteur IA</label><select id="agent-provider" value={agentProvider} onChange={(event) => { setAgentProvider(event.target.value as 'ollama' | 'hermes' | 'openai'); setSelectedAgentModel(''); }}><option value="ollama">Ollama · local</option><option value="hermes">Hermes · local</option><option value="openai">OpenAI · Internet</option></select>
        <label htmlFor="agent-model">Modèle</label><select id="agent-model" value={agentEffectiveModel} onChange={(event) => { setSelectedAgentModel(event.target.value); if (agentProvider === 'ollama') assignAgentModel(selectedAgent, event.target.value); }} disabled={agentAvailableModels.length === 0}><option value="">{agentProvider === 'openai' && !openaiKeyConfigured ? 'Configure d’abord la clé OpenAI' : 'Aucun moteur connecté'}</option>{agentAvailableModels.map((model) => <option key={model} value={model}>{model}</option>)}</select>
        <label>Skills à appliquer</label><div className="agent-check-grid">{agentSkillOptions.map((skill) => <label key={skill.id}><input type="checkbox" checked={selectedAgentSkills.includes(skill.id)} onChange={() => setSelectedAgentSkills((current) => current.includes(skill.id) ? current.filter((id) => id !== skill.id) : [...current, skill.id])} />{skill.name}</label>)}</div>
        <label htmlFor="agent-prompt">Ta demande</label><textarea id="agent-prompt" value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} placeholder="Décris ce que l’équipe doit accomplir…" required />
        {agentProvider === 'openai' && <small className="module-form-hint">Ta demande et les skills choisis seront envoyés à OpenAI et peuvent entraîner une facturation API.</small>}
        {agentProvider === 'hermes' && hermesEnabledToolsets.length > 0 && (hermesMultiAgentToolsConflict
          ? <div className="module-info-note"><LockKeyhole size={15} />Les outils Hermes actifs sont disponibles pour chaque appel API. Désactive-les dans Hermes pour lancer une équipe en mode analyse, ou réduis l’équipe à un seul agent.</div>
          : <label className="agent-tools-approval"><input type="checkbox" checked={allowHermesTools} onChange={(event) => setAllowHermesTools(event.target.checked)} />Autoriser les toolsets Hermes pour cette demande : {hermesEnabledToolsets.join(', ')}</label>)}
        <div className="agent-form-actions"><button className="module-primary-button" disabled={!desktop || !agentEffectiveModel || agentRunState === 'running' || hermesMultiAgentToolsConflict || (agentProvider === 'hermes' && hermesEnabledToolsets.length > 0 && !allowHermesTools)}><Sparkles size={15} />{agentRunState === 'running' ? 'Les agents échangent…' : `Lancer ${Math.max(1, activeAgentTeam.length)} agent${activeAgentTeam.length === 1 ? '' : 's'}`}</button>{agentProvider === 'hermes' && agentRunState === 'running' && !hermesCompatibilityMode && <button type="button" className="subtle-button" onClick={() => void cancelHermesAgentRun()}>Arrêter la mission</button>}</div>
      </form>{hermesCompatibilityMode && <div className="module-info-note"><Activity size={15} /> Backend Tauri ancien détecté : demande traitée par le mode Hermes classique. L’annulation du run natif n’est pas disponible; relance une compilation récente pour la récupérer.</div>}{agentRunState === 'error' && <div className="module-info-note"><LockKeyhole size={15} /> L’équipe n’a pas pu répondre : {agentRunError}</div>}{agentResponse && <pre className="agent-response">{agentResponse}</pre>}</section>
      <section className="panel module-card"><div className="module-info-note"><LockKeyhole size={15} /> Hermes utilise maintenant l’API native des runs : NEXUS suit le statut et peut demander l’annulation. Les spécialistes collaborent toujours par lots de deux avant la synthèse. Les événements SSE et la visibilité des sous-agents natifs restent à connecter. Les toolsets API sont contrôlés au niveau global; NEXUS bloque donc le multi-agent s’ils sont actifs.</div></section>
    </>}

    {page === 'browser' && <div className="module-content-grid">
      <section className="panel module-card"><div className="module-card-heading"><div><h2>Naviguer sur Internet</h2><p>{desktop ? 'Les pages s’ouvrent dans une fenêtre WebView2 distincte, sans accès aux commandes Tauri.' : 'En bêta navigateur, les pages s’ouvrent dans ton navigateur habituel.'}</p></div><Globe2 size={20} /></div><form className="module-form" onSubmit={saveBookmark}><label htmlFor="browser-address">Adresse HTTPS ou recherche web</label><div className="module-form-row"><input id="browser-address" type="text" value={browserAddress} onChange={(event) => setBrowserAddress(event.target.value)} placeholder="https://exemple.com ou rechercher…" required maxLength={2048} /><button className="module-primary-button" disabled={browserOpening}><Globe2 size={15} />{browserOpening ? 'Ouverture…' : 'Naviguer'}</button></div></form>{browserError && <div className="module-info-note"><LockKeyhole size={15} />{browserError}</div>}<div className="browser-shortcuts-row"><button className="subtle-button" disabled={browserOpening} onClick={() => void openBrowserTarget('https://www.youtube.com')}>YouTube</button><button className="subtle-button" disabled={browserOpening} onClick={() => void openBrowserTarget('https://github.com')}>GitHub</button><button className="subtle-button" disabled={browserOpening} onClick={() => void openBrowserTarget('https://www.google.com')}>Google</button></div></section>
      <section className="panel module-card"><div className="module-card-heading"><div><h2>Favori enregistré</h2><p>Un favori est une adresse mémorisée; ce n’est pas l’état de la navigation.</p></div><Wifi size={20} /></div>{savedAddress ? <div className="saved-address"><span>Adresse</span><strong>{savedAddress}</strong><button className="subtle-button" disabled={browserOpening} onClick={() => void openBrowserTarget(savedAddress)}>Ouvrir</button><button className="danger-icon-button" aria-label="Retirer le favori" onClick={() => { setSavedAddress(''); localStorage.removeItem('nexus.browser.bookmark.v1'); }}><Trash2 size={14} /></button></div> : <div className="connection-state-large"><span className={`connection-state-icon ${desktop ? 'connected' : ''}`}><Globe2 size={22} /></span><div><strong>{desktop ? 'Moteur de navigation disponible' : 'Navigateur du PC disponible'}</strong><small>{desktop ? 'Saisis une adresse ou une recherche pour ouvrir une vraie page dans la fenêtre Navigateur NEXUS.' : 'Saisis une adresse ou une recherche : elle s’ouvrira dans ton navigateur habituel.'}</small></div></div>}</section>
    </div>}

    {page === 'skills' && <>
      <section className="panel module-card"><div className="module-card-heading"><div><h2>{editingSkillId ? 'Modifier le skill' : 'Créer un skill'}</h2><p>Enregistre une fiche de consignes réutilisable sur ce PC.</p></div><Plus size={19} /></div><form className="module-form" onSubmit={createSkill}><label htmlFor="skill-name">Nom du skill</label><input id="skill-name" value={skillName} onChange={(event) => setSkillName(event.target.value)} placeholder="Ex. Revue de code Kotlin" required /><label htmlFor="skill-group">Catégorie</label><input id="skill-group" value={skillGroup} onChange={(event) => setSkillGroup(event.target.value)} placeholder="Personnel" /><label htmlFor="skill-instructions">Consignes</label><textarea id="skill-instructions" value={skillInstructions} onChange={(event) => setSkillInstructions(event.target.value)} placeholder="Décris les objectifs, les étapes et les limites de ce skill…" required /><div className="module-form-row"><button className="module-primary-button">{editingSkillId ? <Check size={16} /> : <Plus size={16} />}{editingSkillId ? 'Mettre à jour' : 'Enregistrer le skill'}</button>{editingSkillId && <button type="button" className="subtle-button" onClick={cancelSkillEdit}>Annuler</button>}</div><small className="module-form-hint">Aucun plafond de taille n’est imposé par NEXUS. Le modèle choisi peut toutefois limiter la longueur totale de son contexte.</small></form></section>
      <section className="panel module-card"><div className="module-card-heading"><div><h2>Bibliothèque de skills</h2><p>Recherche parmi les fonctions intégrées et tes fiches locales.</p></div><div className="module-form-row"><button type="button" className="subtle-button" onClick={exportSkills} disabled={customSkills.length === 0}><Download size={14} /> Exporter</button><label className="subtle-button" htmlFor="skills-import-file"><Upload size={14} /> Importer</label><input id="skills-import-file" type="file" accept=".json,application/json" onChange={(event) => void importSkills(event)} style={{ display: 'none' }} /></div></div>{skillTransferMessage && <div className="module-info-note">{skillTransferMessage}</div>}<div className="module-search"><Sparkles size={15} /><input aria-label="Rechercher une compétence" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrer les compétences…" /></div><div className="skill-list">{skillLibraryItems.filter((skill) => `${skill.name} ${skill.group} ${skill.desc}`.toLocaleLowerCase('fr-FR').includes(search.toLocaleLowerCase('fr-FR'))).map((skill) => <article className="skill-row" key={skill.id}><span className="skill-icon"><Sparkles size={16} /></span><div><strong>{skill.name}</strong><small>{skill.group}{skill.custom ? ` · v${skill.version || 1}${skill.updatedAt ? ` · modifié le ${skill.updatedAt}` : ''}` : ''}{skill.custom && skill.createdAt ? ` · créé le ${skill.createdAt}` : ''}</small><p>{skill.desc}</p></div>{skill.custom ? <><button className="subtle-button" aria-label={`Modifier ${skill.name}`} onClick={() => editSkill(skill as CustomSkill)}><Pencil size={14} /></button><button className="danger-icon-button" aria-label={`Supprimer ${skill.name}`} onClick={() => setCustomSkills((current) => current.filter((item) => item.id !== skill.id))}><Trash2 size={14} /></button></> : <span className="skill-available"><Check size={13} /> DISPONIBLE</span>}</article>)}</div></section>
    </>}

    {page === 'settings' && <>
      <section className="panel module-card"><div className="module-card-heading"><div><h2>Connexion OpenAI</h2><p>La clé est chiffrée par Windows DPAPI dans le profil de cette session. NEXUS ne la réaffiche jamais.</p></div><LockKeyhole size={19} /></div><div className="connection-state-large"><span className={`connection-state-icon ${openaiKeyConfigured ? 'connected' : ''}`}><LockKeyhole size={21} /></span><div><strong>{openaiKeyConfigured ? 'Clé OpenAI enregistrée sur ce PC' : 'Clé OpenAI à configurer'}</strong><small>{openaiStatus === 'ready' ? `${openaiModels.length} modèle${openaiModels.length === 1 ? '' : 's'} GPT disponible${openaiModels.length === 1 ? '' : 's'}` : 'Elle sera utilisée uniquement quand tu sélectionnes OpenAI et envoies une demande à un agent.'}</small></div><button className="subtle-button" onClick={() => void loadOpenaiModels()} disabled={!desktop || !openaiKeyConfigured || openaiStatus === 'loading'}>Vérifier</button></div><form className="module-form openai-key-form" onSubmit={(event) => void saveOpenaiKey(event)}><label htmlFor="openai-api-key">Clé API OpenAI</label><div className="module-form-row"><input id="openai-api-key" type="password" value={openaiKeyDraft} onChange={(event) => setOpenaiKeyDraft(event.target.value)} placeholder="sk-…" autoComplete="new-password" spellCheck={false} maxLength={1024} disabled={!desktop || openaiStatus === 'loading'} /><button className="module-primary-button" disabled={!desktop || !openaiKeyDraft.trim() || openaiStatus === 'loading'}>Enregistrer chiffré</button></div><small className="module-form-hint">Ne colle pas cette clé dans le chat. La saisie est transmise à Rust pour être chiffrée par Windows, puis effacée du champ.</small></form>{openaiStatus === 'error' && <div className="module-info-note"><LockKeyhole size={15} /> Configuration OpenAI : {openaiError}</div>}</section>
      <section className="panel module-card settings-card"><div className="module-card-heading"><div><h2>Préférences d’affichage</h2><p>Ces préférences sont enregistrées localement sur cet appareil.</p></div><Activity size={19} /></div><label className="setting-row"><span><strong>Réduire les animations</strong><small>Désactive les effets de mouvement de l’interface.</small></span><input type="checkbox" checked={reducedMotion} onChange={(event) => setMotionPreference(event.target.checked)} /></label><div className="setting-row"><span><strong>Langue de l’interface</strong><small>Langue actuellement utilisée.</small></span><span className="setting-value">Français</span></div><div className="setting-row"><span><strong>Profil de stockage</strong><small>Les missions et fiches projet de cette version restent sur ce PC.</small></span><span className="setting-value">Local</span></div></section>
    </>}

    {page === 'devices' && <>
      <section className="panel module-card"><div className="module-card-heading"><div><h2>PC Windows local</h2><p>Connexion au runtime de bureau Tauri.</p></div><Monitor size={19} /></div><div className="connection-state-large"><span className={`connection-state-icon ${desktop ? 'connected' : ''}`}><Monitor size={22} /></span><div><strong>{desktop ? 'Application Tauri connectée' : 'Application de bureau non détectée'}</strong><small>{desktop ? 'Les commandes locales restent soumises à approbation.' : 'Ouvre NEXUS depuis l’application Windows pour activer les commandes.'}</small></div></div></section>
      <section className="panel module-card"><div className="module-card-heading"><div><h2>Appareils sur la Bbox</h2><p>NEXUS teste uniquement l’adresse saisie dans le réseau local 192.168.1.x. Aucun balayage d’autres appareils.</p></div><Wifi size={19} /></div><div className="lan-device-grid">{([
        { id: 'printer' as const, title: 'Elegoo Centauri Carbon', detail: 'Imprimante · adresse conservée sur ce PC', icon: HardDrive, note: 'Le test confirme seulement qu’elle répond sur le réseau. Le contrôle d’impression local reste à intégrer.' },
        { id: 'phone' as const, title: 'Samsung Galaxy A52s 5G', detail: 'Téléphone Android · connexion par Wi‑Fi Bbox', icon: Wifi, note: 'Après détection, active Débogage sans fil sur le téléphone et associe-le à ADB.' },
        { id: 'tv' as const, title: 'TCL 65T8CX1 / 65T8C', detail: 'Google TV · Android 14 · connexion filaire Bbox', icon: Monitor, note: 'Après détection, active les options développeur et le débogage sans fil sur la TV.' },
      ]).map(({ id, title, detail, icon: DeviceIcon, note }) => <article className="lan-device-card" key={id}><div className="lan-device-heading"><span className="agent-icon cyan"><DeviceIcon size={18} /></span><div><strong>{title}</strong><small>{detail}</small></div><span className={`device-check-pill ${deviceChecks[id].status}`}><i />{deviceChecks[id].status === 'reachable' ? 'EN LIGNE' : deviceChecks[id].status === 'checking' ? 'TEST…' : deviceChecks[id].status === 'absent' ? 'HORS LIGNE' : deviceChecks[id].status === 'error' ? 'À VÉRIFIER' : 'BBOX LAN'}</span></div><label htmlFor={`device-ip-${id}`}>Adresse IP locale</label><div className="module-form-row"><input id={`device-ip-${id}`} value={deviceIps[id]} onChange={(event) => updateDeviceIp(id, event.target.value)} placeholder="192.168.1.x" inputMode="decimal" maxLength={15} /><button className="module-primary-button" onClick={() => void checkLanDevice(id)} disabled={!desktop || !deviceIps[id].trim() || deviceChecks[id].status === 'checking'}><Wifi size={14} />Tester</button></div>{deviceChecks[id].status === 'reachable' && <small className="device-result ok">L’appareil répond au test réseau local.</small>}{deviceChecks[id].status === 'absent' && <small className="device-result">Aucune réponse au ping. Vérifie qu’il est allumé et relié à la Bbox; certains appareils bloquent le ping.</small>}{deviceChecks[id].status === 'error' && <small className="device-result error">{deviceChecks[id].message}</small>}<small className="module-form-hint">{note}</small></article>)}</div></section>
    </>}

    {page === 'history' && <section className="panel module-card"><div className="module-card-heading"><div><h2>Événements de session</h2><p>Les traces affichées ici sont conservées en mémoire pour la session en cours.</p></div><span className="module-count">{logs.length} entrées</span></div><div className="event-list">{[...logs].reverse().map((entry, index) => <div className="event-row" key={`${index}-${entry}`}><span className={entry.includes('ERREUR') ? 'event-indicator error' : entry.includes('AUDIT') || entry.includes('SECURITY') ? 'event-indicator audit' : 'event-indicator'} /><code>{entry}</code></div>)}</div></section>}

    {page === 'security' && <div className="module-content-grid"><section className="panel module-card"><div className="module-card-heading"><div><h2>Garde-fous du terminal</h2><p>Limites appliquées par le runtime Rust local.</p></div><Shield size={19} /></div><div className="security-rule"><LockKeyhole size={17} /><div><strong>Approbation requise à chaque action</strong><small>Le refus est lui aussi consigné dans le journal d’audit.</small></div></div><div className="security-rule"><TerminalSquare size={17} /><div><strong>Sept actions prédéfinies · PowerShell, CMD et Python</strong><small>Aucune commande libre ni texte fourni par la page web.</small></div></div><div className="security-rule"><HardDrive size={17} /><div><strong>Sortie plafonnée à 16 Ko</strong><small>L’exécution est arrêtée en cas de dépassement.</small></div></div><div className="security-rule"><Clock3 size={17} /><div><strong>Arrêt après 8 secondes</strong><small>Un seul processus terminal peut fonctionner à la fois.</small></div></div></section><section className="panel module-card"><div className="module-card-heading"><div><h2>Journal local</h2><p>Événements techniques, sans contenu envoyé à un service distant.</p></div><Activity size={19} /></div><div className="connection-state-large"><span className="connection-state-icon connected"><Check size={22} /></span><div><strong>Écoute des événements active</strong><small>Les décisions et résultats s’affichent dans Historique & Logs.</small></div></div></section></div>}
  </div>;
}
