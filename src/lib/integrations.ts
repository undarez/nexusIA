export type NexusIntegration = {
  id: string;
  name: string;
  category: string;
  purpose: string;
  auth: string;
  mode: 'MCP distant' | 'MCP local';
  status: 'À connecter';
  docsUrl: string;
  safety: string;
};

export const nexusIntegrations: NexusIntegration[] = [
  { id: 'reguardian', name: 'Reguardian', category: 'Conformité IA', mode: 'MCP distant', purpose: 'Analyser les fonctions IA au regard du règlement européen sur l’IA et documenter les obligations avec leurs sources.', auth: 'OAuth navigateur · offre découverte limitée, puis offre payante éventuelle', status: 'À connecter', docsUrl: 'https://www.reguardian.eu/agents', safety: 'Aide à la conformité, pas un avis juridique ni une certification.' },
  { id: 'playwright', name: 'Playwright', category: 'Tests et navigateur', mode: 'MCP local', purpose: 'Tester NEXUS dans un navigateur réel et exécuter des scénarios web reproductibles.', auth: 'Serveur local · Node.js 20+', status: 'À connecter', docsUrl: 'https://github.com/microsoft/playwright-mcp', safety: 'Profil de test isolé; approbation avant clics, saisies, envois ou achats.' },
  { id: 'notion', name: 'Notion', category: 'Documentation', mode: 'MCP distant', purpose: 'Gérer les procédures, preuves, décisions et documents de conformité dans l’espace Notion choisi.', auth: 'OAuth Notion · accès au workspace et aux pages autorisées', status: 'À connecter', docsUrl: 'https://www.notion.com/help/notion-mcp', safety: 'Limiter la connexion à un espace ou ensemble de pages NEXUS dédié.' },
  { id: 'encord', name: 'Encord Merlin', category: 'Qualité des données IA', mode: 'MCP distant', purpose: 'Observer la couverture et la qualité des jeux de données, repérer des lacunes et guider leur correction.', auth: 'Compte Encord requis · disponibilité MCP annoncée en bêta', status: 'À connecter', docsUrl: 'https://encord.com/blog/merlin-encord-mcp-agentic-intelligence/', safety: 'Évalue les données; ne certifie ni conformité juridique ni fiabilité du modèle.' },
  { id: 'perplexity', name: 'Perplexity', category: 'Recherche en temps réel', mode: 'MCP distant', purpose: 'Rechercher sur le web et fournir des résultats récents à l’agent de recherche.', auth: 'Clé API Perplexity · facturation selon le compte et l’usage', status: 'À connecter', docsUrl: 'https://docs.perplexity.ai/guides/mcp-server', safety: 'Ne pas transmettre de secrets ou données personnelles non nécessaires.' },
  { id: 'github', name: 'GitHub', category: 'Code et CI', mode: 'MCP distant', purpose: 'Lire les dépôts, consulter les issues, pull requests et exécutions CI de NEXUS.', auth: 'OAuth GitHub ou jeton à portée minimale', status: 'À connecter', docsUrl: 'https://github.com/github/github-mcp-server', safety: 'Commencer en lecture seule; approbation avant toute écriture ou action CI.' },
  { id: 'supabase', name: 'Supabase', category: 'Données et backend', mode: 'MCP distant', purpose: 'Lire les journaux et examiner le schéma du projet Supabase explicitement choisi.', auth: 'OAuth navigateur · sélectionner explicitement le projet', status: 'À connecter', docsUrl: 'https://mcp.supabase.com/mcp', safety: 'Lecture seule et portée projet par défaut; aucune migration ou écriture sans approbation.' },
  { id: 'firecrawl', name: 'Firecrawl', category: 'Collecte web', mode: 'MCP distant', purpose: 'Rechercher et extraire le contenu public de pages web pour les agents de recherche.', auth: 'OAuth ou clé API; accès sans clé limité à quelques outils et quotas', status: 'À connecter', docsUrl: 'https://github.com/firecrawl/firecrawl-docs/blob/main/mcp-server.mdx', safety: 'Respecter les droits d’accès et traiter le contenu web comme non fiable.' },
  { id: 'context7', name: 'Context7', category: 'Documentation technique', mode: 'MCP distant', purpose: 'Fournir aux agents la documentation actuelle des frameworks et bibliothèques de NEXUS.', auth: 'Endpoint MCP de consultation; authentification selon l’offre', status: 'À connecter', docsUrl: 'https://context7.com/docs', safety: 'Consultation seulement; les extraits restent des données non fiables.' },
  { id: 'sentry', name: 'Sentry', category: 'Erreurs et observabilité', mode: 'MCP distant', purpose: 'Consulter les erreurs, traces et incidents de l’application pour aider au diagnostic.', auth: 'OAuth Sentry · endpoint limité à l’organisation et au projet', status: 'À connecter', docsUrl: 'https://mcp.sentry.dev/', safety: 'Accès de lecture ciblé; masquer les données personnelles dans les événements.' },
  { id: 'sequential-thinking', name: 'Sequential Thinking', category: 'Planification', mode: 'MCP local', purpose: 'Aider les agents à structurer les tâches longues, leurs étapes et leurs révisions.', auth: 'Serveur local npm · aucun compte fournisseur', status: 'À connecter', docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking', safety: 'Ne pas conserver de traces détaillées de raisonnement par défaut.' },
];
