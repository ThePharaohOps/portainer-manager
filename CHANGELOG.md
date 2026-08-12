# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/), le projet respecte le [Semantic Versioning](https://semver.org/lang/fr/).

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
