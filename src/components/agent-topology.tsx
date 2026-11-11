'use client';

import { useState } from 'react';

export type TopologyAgent = { name: string; role: string };
export type TopologySkill = { id: string; name: string; group: string; desc: string };

const agentPositions: Record<string, [number, number]> = {
  'Project Manager': [500, 46],
  'UI / UX Designer': [770, 115],
  'Frontend Developer': [770, 280],
  'Android & Smart TV': [500, 360],
  'Terminal Operator': [230, 280],
  'Security Sentinel': [230, 115],
};

export function AgentTopology({
  agents,
  skills,
  selectedAgents,
  selectedSkills,
  activeAgents,
  completedAgents,
  failedAgent,
  engineLabel,
  engineReady,
  onToggleAgent,
  onToggleSkill,
}: {
  agents: TopologyAgent[];
  skills: TopologySkill[];
  selectedAgents: string[];
  selectedSkills: string[];
  activeAgents: string[];
  completedAgents: string[];
  failedAgent: string | null;
  engineLabel: string;
  engineReady: boolean;
  onToggleAgent: (name: string) => void;
  onToggleSkill: (id: string) => void;
}) {
  const [focusedNode, setFocusedNode] = useState('');
  const team = selectedAgents.length ? selectedAgents : agents.slice(0, 1).map((agent) => agent.name);
  const activeSkills = skills.filter((skill) => selectedSkills.includes(skill.id));
  const visibleSkills = activeSkills.slice(0, 8);
  const focusedAgent = agents.find((agent) => `agent:${agent.name}` === focusedNode);
  const focusedSkill = skills.find((skill) => `skill:${skill.id}` === focusedNode);

  function statusFor(name: string) {
    if (activeAgents.includes(name)) return 'En cours';
    if (failedAgent === name) return 'Échec';
    if (completedAgents.includes(name)) return 'Réponse reçue';
    if (team.includes(name)) return 'Dans l’équipe';
    return 'Disponible';
  }

  return <section className="panel module-card agent-topology-panel">
    <div className="module-card-heading">
      <div><h2>Réseau des agents et skills</h2><p>Les spécialistes analysent par lots de deux; l’agent de départ reçoit leurs contributions et rédige la synthèse.</p></div>
      <span className={`topology-engine ${engineReady ? 'ready' : ''} ${engineLabel === 'HERMES' ? 'hermes' : ''}`}><i />{engineLabel} · {engineReady ? 'CONNECTÉ' : 'HORS LIGNE'}</span>
    </div>
    <div className="agent-topology" role="group" aria-label="Réseau interactif des agents et des skills">
      <svg className="agent-topology-edges" viewBox="0 0 1000 450" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="nexus-flow-line"><stop stopColor="#17d6f5" /><stop offset="1" stopColor="#b044ff" /></linearGradient></defs>
        {agents.map((agent) => {
          const [x, y] = agentPositions[agent.name] ?? [500, 45];
          const selected = team.includes(agent.name);
          return <line key={`core-${agent.name}`} className={`topology-edge ${selected ? 'selected' : ''} ${activeAgents.includes(agent.name) ? 'flowing' : ''}`} x1="500" y1="205" x2={x} y2={y} />;
        })}
        {team.slice(1).map((name, index) => {
          const fromName = team[index];
          const from = agentPositions[fromName];
          const to = agentPositions[name];
          if (!from || !to) return null;
          return <line key={`team-${fromName}-${name}`} className={`topology-edge team-edge ${activeAgents.includes(name) ? 'flowing' : ''}`} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} />;
        })}
        {team.flatMap((agentName) => {
          const point = agentPositions[agentName];
          if (!point) return [];
          return visibleSkills.map((skill) => <line key={`${agentName}-${skill.id}`} className={`topology-edge skill-edge ${activeAgents.includes(agentName) ? 'flowing' : ''}`} x1={point[0]} y1={point[1]} x2={500 + (visibleSkills.indexOf(skill) - (visibleSkills.length - 1) / 2) * 92} y2="423" />);
        })}
      </svg>
      <div className="topology-core">
        <strong>NEXUS</strong><span>ORCHESTRATEUR</span><small>{activeAgents.length ? `→ ${activeAgents.length} agent${activeAgents.length > 1 ? 's' : ''} actif${activeAgents.length > 1 ? 's' : ''}` : engineReady ? `${engineLabel} prêt` : `${engineLabel} indisponible`}</small>
      </div>
      {agents.map((agent) => {
        const [x, y] = agentPositions[agent.name] ?? [500, 45];
        const status = statusFor(agent.name);
        return <button
          key={agent.name}
          type="button"
          className={`topology-agent ${team.includes(agent.name) ? 'selected' : ''} ${status === 'En cours' ? 'running' : ''} ${status === 'Réponse reçue' ? 'completed' : ''} ${status === 'Échec' ? 'failed' : ''}`}
          style={{ left: `${x / 10}%`, top: `${y / 4.5}%` }}
          aria-pressed={team.includes(agent.name)}
          title={`${agent.name} · ${status}. Clique pour ${selectedAgents.includes(agent.name) ? 'retirer' : 'ajouter'} à l’équipe.`}
          onClick={() => onToggleAgent(agent.name)}
          onMouseEnter={() => setFocusedNode(`agent:${agent.name}`)}
          onMouseLeave={() => setFocusedNode('')}
          onFocus={() => setFocusedNode(`agent:${agent.name}`)}
          onBlur={() => setFocusedNode('')}
        ><i /><strong>{agent.name}</strong><small>{status}</small></button>;
      })}
      {visibleSkills.map((skill, index) => {
        const x = 500 + (index - (visibleSkills.length - 1) / 2) * 92;
        return <button
          key={skill.id}
          type="button"
          className="topology-skill"
          style={{ left: `${x / 10}%`, top: '94%' }}
          title={`${skill.name} · appliqué à chaque agent de l’équipe.`}
          onClick={() => onToggleSkill(skill.id)}
          onMouseEnter={() => setFocusedNode(`skill:${skill.id}`)}
          onMouseLeave={() => setFocusedNode('')}
          onFocus={() => setFocusedNode(`skill:${skill.id}`)}
          onBlur={() => setFocusedNode('')}
        ><span>SKILL</span>{skill.name}</button>;
      })}
    </div>
    <div className="topology-skill-picker" aria-label="Choisir les skills à transmettre">
      <span>Skills appliqués à l’équipe</span>
      {skills.length ? skills.map((skill) => <label key={skill.id} title={`${skill.group} · ${skill.desc}`}><input type="checkbox" checked={selectedSkills.includes(skill.id)} onChange={() => onToggleSkill(skill.id)} />{skill.name}</label>) : <small>Crée un skill pour l’ajouter au réseau.</small>}
      {activeSkills.length > visibleSkills.length && <small>Le graphe affiche les 8 premiers skills actifs; tous restent transmis.</small>}
    </div>
    <div className="topology-detail" aria-live="polite">
      {focusedAgent ? <><strong>{focusedAgent.name}</strong><span>{focusedAgent.role} · {statusFor(focusedAgent.name)}. {completedAgents.includes(focusedAgent.name) ? 'La réponse reçue est visible dans le compte rendu sous le graphe.' : team.includes(focusedAgent.name) ? 'Sa contribution est demandée dans cette mission.' : 'Clique sur l’agent pour l’ajouter à l’équipe.'}</span></> : focusedSkill ? <><strong>{focusedSkill.name}</strong><span>{focusedSkill.group} · {selectedSkills.includes(focusedSkill.id) ? 'Ce skill est transmis aux agents sélectionnés.' : 'Clique pour l’activer.'} {focusedSkill.desc}</span></> : <><strong>{activeAgents.length ? `${activeAgents.length} agent${activeAgents.length > 1 ? 's' : ''} en cours` : failedAgent ? `Échec de ${failedAgent}` : completedAgents.length ? `${completedAgents.length} réponse(s) reçue(s)` : 'Prêt à orchestrer'}</strong><span>Les contributions des spécialistes sont ensuite transmises à l’agent de départ pour la synthèse. Les réponses sont propres à cette mission; le graphe ne prétend pas que le modèle a appris ou mémorisé au-delà.</span></>}
    </div>
  </section>;
}
