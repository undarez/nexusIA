# NEXUS V4.2 — Prototype Windows

Prototype de bureau basé sur Next.js App Router (export statique), Tauri 2 et Rust.
Le prototype inclut un pont PowerShell local à commandes limitées, avec approbation et audit. Supabase/MCP ne sont pas activés.

## Prérequis Windows 11
- Node.js LTS
- pnpm
- Rust stable + cible MSVC
- Visual Studio Build Tools (C++ workload)
- WebView2 Runtime

## Démarrage de l'interface
```powershell
pnpm install
pnpm dev
```

### Bêta utilisable sans le runtime Tauri
Si Windows bloque `nexus-desktop.exe` avec la stratégie de contrôle d’application, lance l’interface web locale :
```powershell
pnpm dev:beta
```
Puis ouvre `http://127.0.0.1:3000`. Cette commande écoute uniquement sur le PC. Les missions, projets, skills et la navigation vers des sites dans le navigateur habituel sont disponibles; le Terminal Studio local, les moteurs IA locaux, les appareils et le compagnon flottant nécessitent le runtime Tauri. Le mode web n’exécute aucune commande Windows.

## Compilation frontend statique
```powershell
pnpm build
```
Le résultat Next.js est exporté dans `out/`.

Pour définir une adresse LAN locale par défaut, copie `.env.example` vers `.env.local` et renseigne `NEXT_PUBLIC_DEFAULT_PRINTER_IP`. `.env.local` est ignoré par Git.

## Lancement desktop
```powershell
pnpm tauri dev
```

## Terminal Windows
- Disponible uniquement dans l'application Tauri sous Windows via ConPTY.
- Trois actions de lecture sont proposées : date/heure, résumé de 12 processus, dossier courant.
- Chaque exécution demande une approbation visible; le frontend ne transmet jamais de texte de commande.
- Sortie plafonnée à 16 Ko et exécution interrompue après 8 secondes.
- Les événements JSON d'approbation, refus, démarrage et résultat sont émis dans `terminal://audit` et conservés dans `terminal-audit.jsonl` sous le dossier de logs Tauri (rotation avec un fichier précédent, limite de 1 Mo par fichier). Le contenu PowerShell n'est jamais journalisé.
- Les commandes Tauri accessibles sont limitées par `src-tauri/capabilities/default.json`.

Ce pont est un prototype local; il ne fournit pas de terminal interactif ni d'accès à distance. La validation de la distribution Windows reste nécessaire.

## Signature Windows et préparation open source

- `.github/workflows/ci.yml` vérifie les changements sur Windows.
- La candidature au programme gratuit SignPath Foundation est seulement envisagée; NEXUS n’est pas accepté et aucune version n’est signée par SignPath.
- Les conditions SignPath incluent une licence OSI, un projet publiquement documenté et déjà publié dans le format à signer, une réputation vérifiable, une MFA sur GitHub/SignPath et l’approbation manuelle de chaque signature. L’acceptation n’est pas garantie.
- `docs/CODE_SIGNING_POLICY.md` décrit l’état honnête de la signature et les rôles proposés; `docs/PRIVACY.md` décrit les flux de données.
- `.github/workflows/signed-release.yml` est encore le workflow PFX pour un certificat fourni par une CA; il n’est pas branché à SignPath. N’étiquette pas une release avant qu’une méthode de signature effective soit configurée.
- Pour un PFX pris en charge, configure les secrets `WINDOWS_CERTIFICATE` (PFX encodé en base64) et `WINDOWS_CERTIFICATE_PASSWORD`, puis la variable de dépôt `WINDOWS_TIMESTAMP_URL` fournie par l’autorité de certification.
- Ne committe jamais de certificat `.pfx`, de mot de passe, de clé privée ou de fichier de signature local.
- Le build de développement local `pnpm tauri dev` peut être bloqué par la stratégie de contrôle d’application de Windows (notamment l’erreur 4551 / Code Integrity 3077). Ne désactive pas cette protection pour utiliser la bêta web; le certificat de production peut attendre.

## Important
- Ne renseigne aucune clé secrète dans le frontend.
- N'exécute pas de commande arbitraire via une route frontend.
- La validation d’installation et de lancement du runtime ConPTY/approbations doit encore être réalisée sur Windows avec un exécutable signé.
- Supabase Auth, MCP Gateway et les agents nécessitent leurs implémentations et tests dédiés.

## Licence

Le projet est publié sous licence MIT; voir [LICENSE](LICENSE). Les dépendances tierces conservent leurs licences respectives.

## Code signing policy et privacy

- [Code signing policy](docs/CODE_SIGNING_POLICY.md)
- [Politique de confidentialité](docs/PRIVACY.md)
