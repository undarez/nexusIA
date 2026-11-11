# NEXUS V4.2 — état et tâches restantes

## Fonctionnalités présentes

- Application Next.js App Router empaquetée par Tauri 2.
- Terminal PowerShell local avec commandes prédéfinies, approbation, audit, limite de sortie et délai d’arrêt. L’utilisateur a confirmé le fonctionnement réel de la sortie PowerShell dans l’application.
- Pages de missions, projets, skills, agents, navigateur et appareils.
- Skills personnels créés, conservés localement, modifiables/versionnés, importables/exportables en JSON et sélectionnables en groupe dans l’orchestration des agents.
- Missions locales enrichies d’une demande et de plusieurs skills, rechargeables dans l’orchestrateur d’agents.
- Terminal Studio permet de préparer une demande avec plusieurs skills personnels et de la transmettre à Agents, sans exécuter leur contenu comme une commande.
- Guide de jumelage WhatsApp Hermes ajouté à la page Agents; l’échange passe par la passerelle Hermes existante.
- Connexions Ollama, Hermes et OpenAI exposées dans l’interface; clés OpenAI chiffrées via DPAPI.
- Navigation HTTPS lancée dans une fenêtre WebView2 distincte.

## À faire, par priorité

1. **Agents réellement coopératifs** — remplacer la boucle actuelle d’appels séquentiels au même moteur par des exécutions Hermes dédiées, avec sous-agents, événements en direct, annulation, suivi des échanges et mémoire explicitement contrôlée.
2. **Navigateur utilisable par les agents** — synchroniser l’état de connexion entre tableau de bord et page navigateur; ajouter une recherche web pilotée par Hermes et des actions de page en opt-in, avec aperçu et confirmation avant toute saisie/clic.
3. **Appareils du réseau local** — découverte et diagnostic LAN via la box, profils Samsung A52s 5G, TCL 65T8C / Android TV et Elegoo Centauri Carbon; définir des pilotes/API confirmés pour chaque action avant contrôle.
4. **Terminal Studio** — ajouter des sessions interactives CMD/Python avec saisie, arrêt et audit; les maintenir distinctes de PowerShell et soumises à approbation.
5. **Compagnon de bureau** — fenêtre transparente sans WebView visible, fermeture/réduction fiables, rig 2D articulé, animations, positionnement écran et contrôle de la vie privée; voix et microphone restent des options explicites.
6. **Administration et état système** — profil opérateur/admin local clairement affiché, état des moteurs et appareils actualisé, historique des missions et outils, limites et commandes configurables.
7. **Validation Windows et distribution** — compiler et vérifier l’installateur sur le PC cible, valider ouverture/fermeture, permissions, erreurs et journaux; signer avant une distribution publique.

## Limites connues

- La collaboration multi-agent actuelle transmet le contexte d’un rôle au suivant; elle ne lance pas encore des processus Hermes autonomes.
- Une fiche de skill est locale et peut être jointe aux demandes d’agents. Créer un skill ne connecte pas automatiquement un outil Hermes.
- La navigation WebView2 ouvre des pages; l’automatisation web par Hermes n’est pas encore intégrée.
- Les commandes du Terminal Studio demeurent bornées et approuvées. L’interface CMD/Python n’est pas encore une session interactive.
- Les moteurs et modèles gardent leurs limites de contexte et de génération. NEXUS n’ajoute pas de plafond de taille fixe aux demandes ou aux skills.
