# Signature Windows via GitHub Actions

Le dépôt est privé. Le workflow de CI ne reçoit aucun secret; le workflow de signature ne se lance que lorsqu’un tag `v*` est poussé. Il suit la méthode PFX du guide fourni et fonctionne uniquement si le certificat choisi peut être fourni comme `.pfx` importable.

## À configurer après acquisition du certificat

Après acquisition du certificat, vérifie auprès de l’émetteur que la clé de signature peut être utilisée depuis un runner GitHub. Les certificats récents peuvent garder la clé dans un HSM, un jeton ou un service cloud et ne pas fournir de PFX exportable. Dans ce cas, ne tente pas d’extraire la clé : le workflow doit utiliser l’outil de signature pris en charge par cet émetteur.

Si l’émetteur fournit un PFX importable, configure dans **Settings → Secrets and variables → Actions** du dépôt privé :

- Secret `WINDOWS_CERTIFICATE`: contenu Base64 du fichier `.pfx` contenant le certificat et sa clé privée.
- Secret `WINDOWS_CERTIFICATE_PASSWORD`: mot de passe d’export du `.pfx`.
- Variable `WINDOWS_TIMESTAMP_URL`: serveur d’horodatage recommandé par l’autorité de certification.

Le workflow importe le certificat dans le magasin temporaire du runner Windows, fabrique une configuration Tauri temporaire avec son empreinte, compile et signe les bundles, puis crée une release GitHub en brouillon. Le PFX est supprimé du runner après import. Les secrets ne sont pas utilisés pour les pull requests.

N’ajoute jamais le `.pfx`, sa clé privée, son mot de passe ou un fichier Base64 au dépôt. N’utilise pas de certificat auto-signé pour Smart App Control.

## Mise en route

1. Obtenir un certificat de signature de code reconnu par Smart App Control; confirmer avec l’émetteur son mode d’intégration GitHub Actions.
2. Ajouter les deux secrets et la variable ci-dessus dans le dépôt.
3. Créer et pousser un tag de version, par exemple `v0.1.0`.
4. Examiner les artefacts dans la release brouillon avant publication.

Sans certificat valide, le workflow de signature s’arrête avec une erreur explicite. `pnpm tauri dev` construit un exécutable local non signé; cette automatisation de release signe les bundles de publication, pas l’exécutable de développement local.
