# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/), le projet respecte le [Semantic Versioning](https://semver.org/lang/fr/).

## [1.4.0] - 2026-11-24

### Ajouté
- **Interface en anglais** : toute l'application (dashboard, connexion, page de statut, exports CSV, dates, journal d'audit) est disponible en français et en anglais. La langue est détectée selon le navigateur, puis modifiable avec le bouton FR/EN ; le choix est mémorisé.
- **Thème clair et automatique** en plus du thème sombre (toujours par défaut), via le bouton soleil/lune de l'en-tête et de la page de connexion.
- **Langue des notifications webhook** (Slack, Teams) : français ou anglais, dans les Paramètres.
- **Image Docker publiée sur GHCR** (`ghcr.io/thepharaohops/portainer-manager`) pour `linux/amd64` et `linux/arm64`, construite automatiquement à chaque tag de version : l'application se lance avec un simple `docker run`, sans cloner le dépôt.
- **Tests automatisés** (`npm test`, test runner intégré à Node) : connexion, blocage anti brute-force, sessions, en-têtes de sécurité, gestion des instances, chiffrement des tokens, données live, recherche globale, `/metrics`, complétude des traductions.
- **Intégration continue** GitHub Actions : tests, audit des dépendances de production et build Docker avec healthcheck à chaque push et pull request.
- Variables `TRUST_PROXY` (derrière un reverse proxy), `LOGIN_MAX_ATTEMPTS` et `DATA_DIR`.

### Sécurité
- **Protection contre le brute-force** : après 10 échecs de mot de passe depuis une même IP, la connexion par mot de passe est bloquée 15 minutes pour cette IP (réponse `429` + `Retry-After`). Les échecs et blocages sont inscrits au journal d'audit avec l'IP.
- **Nouvelle session à chaque connexion** (mot de passe et SSO) : un identifiant de session obtenu avant l'authentification n'est jamais réutilisé (fixation de session).
- Comparaison du mot de passe et du jeton `/metrics` en temps constant.
- Cookie de session `SameSite=Lax`, et `Secure` automatiquement en HTTPS.
- **En-têtes de sécurité** : Content-Security-Policy stricte (les scripts inline des pages de connexion et de statut ont été déplacés dans des fichiers), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, suppression de `X-Powered-By`.
- Ajout d'un `.dockerignore` : `.env` et `data/` ne sont plus envoyés au moteur de build Docker.

### Modifié
- `nodemon` remplacé par `node --watch` (intégré à Node) pour `npm run dev` : une dépendance de développement et toute sa chaîne en moins, ce qui supprime aussi la vulnérabilité modérée `minimatch` qu'elle apportait (`npm audit` : 0 vulnérabilité).
- `axios` 1.21.0 → 1.21.1, `dotenv` 18.0.9 → 18.0.10, `openid-client` 6.8.8 → 6.9.1 (connexion SSO revérifiée de bout en bout derrière un reverse proxy).
- Les erreurs de l'API renvoient un `code` stable en plus du message (ex. `bad_password`, `duplicate_url`), utilisé par l'interface pour les traduire.
- Textes d'aide de l'endpoint `/metrics` en anglais (noms des métriques inchangés).
- Captures d'écran du README en anglais, et en français dans `README.fr.md`.

## [1.3.0] - 2026-10-29

### Modifié
- Refonte visuelle de l'interface : tuiles de statistiques avec icônes, barre de filtres en contrôle segmenté, cartes plus lisibles (métriques regroupées, pied de carte aligné, liseré de statut), en-tête regroupé avec pastille utilisateur, modales et pages de connexion/statut modernisées.
- Mise en page responsive revue : l'en-tête et la barre d'outils passent à la ligne sur mobile (la page débordait horizontalement), stats en 3 puis 2 colonnes.
- Vue liste plus compacte (badges de version sur une même ligne).
- Captures d'écran du README mises à jour.
- `axios` 1.20.0 → 1.21.0, `dotenv` 18.0.5 → 18.0.9, `express` 5.2.1 → 5.3.0, `uuid` 14.0.2 → 14.0.3

### Corrigé
- Libellés des métriques qui débordaient de leur case sur les cartes.
- Cases à cocher des paramètres webhook déformées par le style des champs texte, et bouton « Tester le webhook » étiré sur toute la largeur.
- Contour de focus clavier visible sur les boutons et liens (accessibilité).

### Sécurité
- Échappement HTML des noms et notes d'instance (vue liste, alertes), du nom d'utilisateur SSO et des entrées du journal d'audit : un nom contenant du HTML pouvait s'exécuter dans le navigateur d'un administrateur.
- Correction de vulnérabilités dans les dépendances transitives (`proxy-addr` critique, `follow-redirects` et `body-parser` hautes, `qs` modérée). `npm audit` : 0 vulnérabilité.

## [1.2.3] - 2026-10-04

### Sécurité
- Correction de la vulnérabilité `brace-expansion` (dépendance transitive) via mise à jour des dépendances.

### Modifié
- `dotenv` 17.4.2 → 18.0.5
- `openid-client` 6.8.7 → 6.8.8

### Note
- La chaîne de dépendances `nodemon` → `chokidar` → `braces` présente encore une vulnérabilité signalée par `npm audit`, mais `nodemon` est une dépendance de développement uniquement (le `Dockerfile` utilise `npm ci --omit=dev`), donc elle n'atteint jamais l'image de production. Aucun correctif sûr n'existe à ce jour sans forcer une régression majeure de `nodemon` (1.14.10) ; risque accepté et documenté.

## [1.2.2] - 2026-09-03

### Corrigé
- `qs` (dépendance transitive d'Express) : vulnérabilité modérée (contournement de limite de tableau, DoS) corrigée via `npm audit fix`.

### Modifié
- Mise à jour de dépendances : `axios` 1.19.0 → 1.20.0, `openid-client` 6.8.5 → 6.8.7, `uuid` 14.0.1 → 14.0.2.

## [1.2.1] - 2026-08-12

### Corrigé
- Recherche globale : les noms de conteneurs Swarm et les tags d'image longs (sans espace pour couper) faisaient déborder les résultats horizontalement et verticalement. Chaque résultat s'affiche maintenant sur sa propre ligne, tronqué avec `…` si nécessaire (texte complet au survol).
- Mise à jour de `openid-client` (6.8.4 → 6.8.5).

## [1.2.0] - 2026-08-12

### Ajouté
- **Endpoint Prometheus** (`/metrics`) : statut, conteneurs actifs/arrêtés, stacks, ratio de disponibilité et disponibilité de mise à jour par instance, au format d'exposition Prometheus. Alimenté par les données déjà collectées (pas de sondage supplémentaire des instances Portainer). Accès par session ou par `METRICS_TOKEN` (bearer token ou `?token=`) pour un scraping sans session.
- **Recherche globale** (icône 🔍) : recherche un conteneur ou une stack par son nom à travers toutes les instances configurées, résultats groupés par instance avec lien direct vers Portainer. Déclenchée à la demande, pas automatique.
- `OIDC_ROLE_CLAIM` et `OIDC_ADMIN_GROUP` (rôles) ainsi que `METRICS_TOKEN` sont désormais transmis par `docker-compose.yml` — ils manquaient depuis leur introduction et n'étaient utilisables qu'en `docker run` direct.

## [1.1.2] - 2026-08-12

### Corrigé
- SSO : `openid-client` redérive le `redirect_uri` envoyé au fournisseur lors de l'échange du code à partir de l'hôte/protocole vus par Express, au lieu de réutiliser `OIDC_REDIRECT_URI`. Derrière un reverse proxy (ou toute config où l'app ne voit pas exactement l'URL externe), ça produisait `invalid_grant` / "Incorrect redirect_uri" côté fournisseur (Keycloak, etc.) alors que la configuration était pourtant correcte. La valeur d'`OIDC_REDIRECT_URI` est maintenant forcée explicitement.
- Les erreurs OIDC affichent désormais le code d'erreur OAuth et sa description (`error`, `error_description`, `status`) dans les logs, au lieu du seul message générique `server responded with an error in the response body`.

## [1.1.1] - 2026-08-09

### Corrigé
- Mise à jour de dépendances : `axios` 1.18.1 → 1.19.0, et correction d'une vulnérabilité haute (`brace-expansion`, dépendance de dev via `nodemon`).
- Restauration d'une sauvegarde sur une autre machine avec un `SESSION_SECRET` différent : au lieu d'une stack trace crypto brute dans les logs et d'un 500 générique, l'instance concernée passe proprement "Hors ligne" avec le message `Token illisible (SESSION_SECRET incorrect)`.

### Documentation
- Le README explique désormais explicitement qu'il faut copier le même `SESSION_SECRET` pour restaurer une sauvegarde sur une nouvelle machine, et comment récupérer une installation déjà touchée par ce problème sans réimporter.

## [1.1.0] - 2026-07-22

### Ajouté
- **HEALTHCHECK Docker** intégré à l'image — `docker ps` reflète l'état réel de l'application.
- **Journal d'audit** : historique des créations/modifications/suppressions d'instances, changements de configuration, imports de sauvegarde et connexions (qui a fait quoi, et quand).
- **Rôles admin/viewer** via un claim/groupe OIDC (`OIDC_ROLE_CLAIM`, `OIDC_ADMIN_GROUP`) : un rôle lecture seule peut être attribué aux utilisateurs SSO, masqué et rejeté (403) côté API pour toute action de mutation.
- **Page de statut publique** en lecture seule (`/status`, `/api/status/public`), sans authentification, n'exposant que des compteurs agrégés.
- **Actions groupées** : sélection multiple d'instances pour changer leur environnement en masse ou exporter uniquement la sélection en CSV.
- **Affichage de version** dans l'interface (badge + section "À propos" dans Paramètres) avec vérification automatique de la dernière version disponible sur GitHub.

### Corrigé
- Fiabilité des sessions : le store de sessions fichier ne retentait pas la lecture en cas d'écriture concurrente (`retries: 0`), provoquant des échecs de connexion intermittents. Passé à 5 tentatives.

## [1.0.0] - 2026-07-12

### Ajouté
- Licence GPL-3.0.
- Authentification SSO (OpenID Connect) en complément du mot de passe local, compatible Azure AD/Entra ID, Okta, Keycloak, Google Workspace, Authentik...
- Panneau Paramètres étendu : filtre webhook par environnement, intervalle d'auto-refresh configurable, rétention de l'historique uptime configurable, statut SSO visible, export/import de la configuration complète.
