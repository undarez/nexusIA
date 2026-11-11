# Politique de confidentialité NEXUS V4.2

Dernière mise à jour : 11 novembre 2026.

## Données locales

NEXUS n’envoie pas de télémétrie et ne transmet pas automatiquement les missions, projets, skills, favoris ou réglages enregistrés dans le stockage local du navigateur. La clé API OpenAI configurée dans l’application Windows est chiffrée avec DPAPI pour le compte Windows courant. La clé du serveur Hermes est lue depuis la configuration locale Hermes; NEXUS ne l’affiche pas.

Les événements d’audit du terminal local sont conservés sur le PC dans le dossier de journaux Tauri. Ils comprennent les décisions d’approbation et les états d’exécution, et n’enregistrent pas la sortie textuelle des commandes. Les adresses d’appareils saisies sont utilisées pour les tests réseau locaux et enregistrées dans le profil local de l’application.

## Connexions déclenchées par l’utilisateur

- **Ollama** : NEXUS envoie le prompt et les skills sélectionnés à l’API locale `127.0.0.1:11434` quand l’utilisateur lance un agent. Le traitement et la conservation ultérieure dépendent de l’installation et de la configuration Ollama.
- **Hermes** : NEXUS envoie le prompt et les skills sélectionnés au serveur API local `127.0.0.1:8642`. Hermes peut utiliser le fournisseur de modèle défini dans sa propre configuration; ses règles de confidentialité s’appliquent alors.
- **OpenAI** : quand l’utilisateur choisit OpenAI et lance une demande, le prompt, le rôle d’agent et le texte des skills sélectionnés sont envoyés à `api.openai.com` avec la clé du compte configuré. Les règles de conservation et d’utilisation d’OpenAI s’appliquent.
- **Navigateur** : une adresse ou recherche est ouverte dans le navigateur ou la WebView choisie par l’utilisateur. Le site ouvert reçoit les données habituelles de connexion du navigateur.
- **Réseau local** : le test d’un appareil envoie une requête ping à l’adresse locale saisie.

Les réponses des modèles peuvent être incorrectes. Vérifie les actions proposées avant de les exécuter. Le terminal NEXUS ne propose que les actions prédéfinies avec approbation explicite.

## Mode bêta navigateur

Le mode bêta navigateur écoute sur `127.0.0.1`. Il ne fournit pas l’accès au terminal Windows, à la clé OpenAI DPAPI, aux moteurs locaux via le pont Tauri, aux appareils ou au compagnon flottant. Il ne lance aucune commande Windows.

## Contact et suppression

Les données de l’interface sont stockées sur le PC. L’utilisateur peut supprimer les éléments enregistrés depuis l’interface ou effacer les données du site/local de l’application et les journaux locaux via Windows. Aucune demande de suppression distante n’est nécessaire puisqu’aucun compte NEXUS ni serveur NEXUS ne stocke ces données.
