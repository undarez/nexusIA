# NEXUS V4.2 — état et tâches restantes

## Fonctionnalités présentes

- Application Next.js App Router empaquetée par Tauri 2.
- Terminal PowerShell local avec commandes prédéfinies, approbation, audit, limite de sortie et délai d’arrêt. L’utilisateur a confirmé le fonctionnement réel de la sortie PowerShell dans l’application.
- Pages de missions, projets, skills, agents, navigateur et appareils.
- Skills personnels créés, conservés localement, modifiables/versionnés, importables/exportables en JSON et sélectionnables en groupe dans l’orchestration des agents.
- Connexions Ollama, Hermes et OpenAI exposées dans l’interface; clés OpenAI chiffrées via DPAPI.
- Navigation HTTPS lancée dans une fenêtre WebView2 distincte.
- Inventaire des 11 connecteurs MCP/API demandés dans la page Connecteurs IA; les fiches affichent explicitement « À connecter ».

## À faire, par priorité

1. **Connecteurs MCP réels** — construire un broker Rust avec OAuth/DPAPI, permissions par outil, lecture seule par défaut, approbation des écritures, limites, annulation et audit; commencer par Reguardian, GitHub et Supabase.
2. **Tests navigateur Playwright** — profil isolé, tests d’interface et de parcours agent, permissions séparées, confirmation avant les actions web qui envoient ou changent des données.
3. **Agents réellement coopératifs** — exécutions Hermes dédiées, sous-agents, événements en direct, annulation, suivi des échanges et mémoire explicitement contrôlée.
4. **Skills réutilisables de bout en bout** — plusieurs skills depuis Missions et Terminal Studio; proposer un skill du terminal sans exécuter son contenu automatiquement.
5. **Recherche web dans le navigateur** — connecter Perplexity et Firecrawl; recherche sourcée, aperçu et confirmation avant saisie/clic/envoi.
6. **Documentation, données et incidents** — connecter Notion, Encord Merlin, Context7 et Sentry avec des portées limitées et des destinations explicites.
7. **Appareils du réseau local** — diagnostic via la box, profils Samsung A52s 5G, TCL 65T8C / Android TV et Elegoo Centauri Carbon; pilotes/API confirmés avant contrôle.
8. **Terminal Studio** — sessions interactives CMD/Python avec saisie, arrêt et audit; distinctes de PowerShell et toujours soumises à approbation.
9. **Compagnon, administration et distribution** — rig 2D, animations, états administrateur, métriques dynamiques, validation Windows et signature reconnue.

## Limites connues

- La collaboration multi-agent actuelle transmet le contexte d’un rôle au suivant; elle ne lance pas encore des processus Hermes autonomes.
- Une fiche de skill est locale et peut être jointe aux demandes d’agents. Créer un skill ne connecte pas automatiquement un outil Hermes.
- La navigation WebView2 ouvre des pages; l’automatisation web par Hermes n’est pas encore intégrée.
- Le broker MCP NEXUS n’existe pas encore. L’inventaire Connecteurs IA ne stocke pas les secrets et n’appelle aucun service.
- Les commandes du Terminal Studio demeurent bornées et approuvées. L’interface CMD/Python n’est pas encore une session interactive.
- Les moteurs et modèles gardent leurs limites de contexte et de génération. NEXUS n’ajoute pas de plafond de taille fixe aux demandes ou aux skills.
