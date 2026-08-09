# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/), le projet respecte le [Semantic Versioning](https://semver.org/lang/fr/).

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
