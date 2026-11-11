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

## GitHub Actions et signature Windows

- `.github/workflows/ci.yml` vérifie les changements sur Windows.
- `.github/workflows/signed-release.yml` crée un brouillon de version signé pour les tags `v*`.
- Le workflow de signature fourni nécessite un PFX importable. Avant de créer un tag, confirme que l’émetteur autorise cette méthode; certains certificats récents nécessitent leur propre outil HSM/cloud et une configuration `signCommand` dédiée.
- Pour un PFX pris en charge, configure les secrets `WINDOWS_CERTIFICATE` (PFX encodé en base64) et `WINDOWS_CERTIFICATE_PASSWORD`, puis la variable de dépôt `WINDOWS_TIMESTAMP_URL` fournie par l’autorité de certification.
- Ne committe jamais de certificat `.pfx`, de mot de passe, de clé privée ou de fichier de signature local.
- Le build de développement local `pnpm tauri dev` reste bloqué par Smart App Control tant que l’exécutable n’est pas signé avec un certificat reconnu. Le workflow de release ne peut signer qu’après la configuration du certificat.

## Important
- Ne renseigne aucune clé secrète dans le frontend.
- N'exécute pas de commande arbitraire via une route frontend.
- La validation d’installation et de lancement du runtime ConPTY/approbations doit encore être réalisée sur Windows avec un exécutable signé.
- Supabase Auth, MCP Gateway et les agents nécessitent leurs implémentations et tests dédiés.
