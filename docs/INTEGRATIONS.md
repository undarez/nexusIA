# Intégrations NEXUS

## État actuel

La page `Connecteurs IA` est un inventaire transparent des services demandés. Les fiches `À connecter` ne signifient pas que le service fonctionne déjà dans NEXUS. Le projet ne contient pas encore de client MCP générique, de flux OAuth tiers, ni de stockage de secrets pour ces fournisseurs. Aucun jeton ne doit être ajouté à `localStorage`, au dépôt ou au frontend.

## Services visés

| Service | Usage dans NEXUS | Première portée proposée |
| --- | --- | --- |
| Reguardian | Analyse assistée des risques AI Act et suivi des obligations | OAuth; analyse soumise après aperçu; avis juridique humain requis |
| Playwright | Tests de l’application et scénarios navigateur | Navigateur de test isolé; confirmation avant toute action web avec effet |
| Notion | Documentation de conformité et décisions | OAuth limité à un espace NEXUS choisi |
| Encord Merlin | Métriques, couverture et problèmes de jeux de données IA | Bêta fournisseur; seulement les jeux de données sélectionnés |
| Perplexity | Recherche web récente | API distante; afficher les sources et avertir avant l’envoi de données |
| GitHub | Dépôt, issues, PR et CI | OAuth ou jeton à portée minimale; lecture seule au départ |
| Supabase | Backend, schéma, journaux et éventuelles données de mission | OAuth, projet explicitement choisi, lecture seule au départ; approbation avant DDL ou écritures |
| Firecrawl | Recherche et extraction de pages publiques | Quotas/permissions fournisseur; contenu web non fiable |
| Context7 | Documentation à jour des bibliothèques | Recherche documentaire uniquement |
| Sentry | Erreurs et traces de NEXUS | Organisation et projet explicitement choisis; lecture seule au départ |
| Sequential Thinking | Décomposition de missions longues | Serveur local; ne pas persister la trace détaillée par défaut |

## Architecture à réaliser

1. Ajouter un broker MCP Rust avec transport Streamable HTTP et STDIO, sorties bornées, délais, annulation et événements d’audit. Les erreurs du serveur ne doivent pas être interprétées comme des instructions.
2. Gérer OAuth dans le navigateur système et les secrets par Windows Credential Manager/DPAPI. Ne jamais mettre de secret dans le bundle, le frontend, les journaux ou les fichiers suivis par Git.
3. Définir des profils d’outils par service. Les outils en écriture, les actions de navigateur et les changements de base attendent une confirmation explicite, décrite avec la cible et l’effet.
4. Brancher les agents à une liste d’outils autorisée par mission, pas à tous les serveurs et outils automatiquement. Enregistrer les identifiants, décisions, horodatages, résultats et erreurs sans journaliser les clés ni les prompts privés inutilement.
5. Ajouter des tests Playwright reproductibles sur un profil temporaire, puis valider séparément les connexions réelles une fois chaque compte configuré.

## Limites et décisions nécessaires

- NEXUS est encore un prototype local. L’inventaire ne constitue ni une connexion ni une preuve de conformité.
- Reguardian est un outil d’aide et non une certification ou un avis juridique. Vérifier les conditions et le coût avant d’activer un usage payant.
- Encord Merlin est annoncé en bêta MCP; vérifier les capacités et le mode d’authentification disponibles au moment du raccordement.
- Le projet Supabase de NEXUS n’a pas été identifié dans ce dépôt. Ne pas réutiliser automatiquement un autre projet Supabase auquel l’utilisateur a accès.
- Les clés API Perplexity/Firecrawl, les accès Sentry/GitHub/Notion/Encord, le projet Supabase cible et les comptes OAuth ne sont pas présents dans le dépôt.
