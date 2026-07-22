# Portainer Manager

[![Version](https://img.shields.io/github/v/tag/ThePharaohOps/portainer-manager?label=version&sort=semver)](https://github.com/ThePharaohOps/portainer-manager/tags)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-24--alpine-339933?logo=node.js&logoColor=white)](Dockerfile)

Dashboard web sécurisé pour gérer plusieurs instances Portainer depuis une interface unique.

## Aperçu

> Noms et URLs anonymisés dans ces captures — l'interface réelle affiche vos propres instances.

**Vue grille**
![Vue grille](screenshots/dashboard-grid.png)

**Vue liste**
![Vue liste](screenshots/dashboard-list.png)

**Guide de mise à jour**
![Guide de mise à jour](screenshots/update-guide-modal.png)

**Paramètres**
![Paramètres](screenshots/settings-modal.png)

**Journal d'audit**
![Journal d'audit](screenshots/audit-log-modal.png)

**Actions groupées**
![Actions groupées](screenshots/bulk-toolbar.png)

**Connexion**
![Page de connexion](screenshots/login.png)

## Fonctionnalités

### Dashboard
- Stats globales : instances totales, en ligne, hors ligne, conteneurs, stacks, dernière version CE
- **Alerte cloche** : liste des instances Portainer à mettre à jour, triées de la plus ancienne version à la plus récente
- **Auto-refresh** toutes les 30 secondes avec compte à rebours visible

### Gestion des instances
- **Ajout** via URL + API Token uniquement (pas de login/mot de passe Portainer)
- **Modification** : nom, URL, token, environnement, notes
- **Suppression** avec confirmation
- **Bouton "Ouvrir"** pour accéder directement à l'instance Portainer

### Cards
- Statut en ligne / hors ligne avec bordure colorée (vert/rouge)
- Badge d'**environnement** coloré : Intégration, Recette, Pré-production, Production
- Métriques : environnements, conteneurs actifs/arrêtés, stacks, services Swarm
- Versions **Portainer** et **Docker** avec logos
- Badge **"À jour"** ou **"vX.X.X disponible"** par comparaison avec la dernière CE
- Bouton **"Mettre à jour"** sur les instances obsolètes : ouvre une popup avec les commandes adaptées (Docker standalone ou Swarm, détecté automatiquement)
- **Notes** libres affichées sur la card
- **Uptime sparkline** : historique des 288 dernières vérifications (~2.4h) avec pourcentage

### Vues et navigation
- **Vue grille** (défaut) ou **vue liste** (tableau dense)
- **Groupement par environnement** : sections Production / Preprod / Recette / Intégration
- **Tri** : par nom, environnement, statut, version, date d'ajout
- **Recherche** par nom ou URL
- **Filtre** : Toutes / En ligne / Hors ligne / Mises à jour disponibles
- **Export CSV** de l'état complet du parc
- **Actions groupées** (admin) : sélectionner plusieurs instances pour changer leur environnement en masse ou exporter uniquement la sélection en CSV

### Rôles et audit
- **Rôle lecture seule (viewer)** optionnel via un claim/groupe OIDC : masque Ajouter/Modifier/Supprimer, Paramètres, Audit et les actions groupées — voir [Rôles admin/viewer (OIDC)](#rôles-adminviewer-oidc)
- **Journal d'audit** (admin) : historique des créations/modifications/suppressions d'instances, changements de configuration, imports de sauvegarde et connexions — qui a fait quoi et quand
- **Page de statut publique** en lecture seule, sans authentification (`/status`) : uniquement le nombre d'instances en ligne/hors ligne, sans détail sensible — pratique pour un écran mural

### Alertes webhook
- Notification automatique quand une instance change de statut (online ↔ offline)
- Support : **Slack**, **Microsoft Teams**, **Generic JSON**
- **Filtre par environnement** : notifier uniquement Production, par exemple (aucune coche = tous)
- Bouton "Tester" dans les paramètres

### Paramètres (bouton ⚙️)
- **Webhook** : type, URL, filtre par environnement, test
- **Affichage** : intervalle d'auto-refresh (15s / 30s / 1min / 5min)
- **Historique uptime** : nombre de points conservés par instance (remplace la constante fixe de 288)
- **Statut SSO** : activé/désactivé, fournisseur, lien de test rapide
- **Sauvegarde** : export/import JSON de la configuration complète (instances + tokens chiffrés + réglages) — voir [Sauvegarde et restauration](#sauvegarde-et-restauration)

### Sécurité
- **Authentification** par mot de passe partagé, avec session 8h persistée sur disque (`data/sessions/`) : un redémarrage du conteneur ne déconnecte pas les sessions actives
- **SSO / OIDC** optionnel (Azure AD/Entra ID, Okta, Keycloak, Google Workspace, Authentik...) : se superpose au mot de passe local, qui reste toujours disponible en secours — voir [Configurer le SSO (OIDC)](#configurer-le-sso-oidc)
- **Tokens API chiffrés au repos** (AES-256-GCM, clé dérivée de `SESSION_SECRET`) dans `data/instances.json`
- Les tokens API ne sont **jamais** transmis au navigateur
- Les appels vers l'API Portainer sont effectués côté serveur uniquement
- Certificats TLS auto-signés acceptés (fréquent en local)

---

## Prérequis

- **Docker** (recommandé) — l'image utilise `node:24-alpine` (dernière LTS active) et embarque un `HEALTHCHECK` (`docker ps` reflète l'état réel de l'app, utile derrière Swarm/Kubernetes/Traefik)
- **ou** Node.js 18+ en local (minimum imposé par Express 5)

---

## Démarrage rapide

### Avec Docker (recommandé)

```bash
# Copier et configurer les variables
cp .env.example .env   # ou éditer .env directement

docker compose up -d
```

### En local (Node.js)

```bash
npm install
npm start
```

Pour le développement avec rechargement automatique :

```bash
npm run dev
```

L'application est accessible sur **http://localhost:3000** (ou l'IP définie dans `HOST_IP`).

---

## Configuration — fichier `.env`

| Variable         | Défaut                        | Description                              |
|------------------|-------------------------------|------------------------------------------|
| `PORT`           | `3000`                        | Port d'écoute du serveur                 |
| `HOST_IP`        | *(toutes les interfaces)*     | IP affichée au démarrage dans les logs   |
| `ADMIN_PASSWORD` | `admin`                       | ⚠️ Mot de passe du dashboard — à changer |
| `SESSION_SECRET` | *(aléatoire à chaque restart)*| Clé de signature des sessions et de chiffrement des tokens API |

> **Important** : sans `SESSION_SECRET` fixe, les sessions sont invalidées **et les tokens API chiffrés deviennent illisibles** à chaque redémarrage.

Exemple de `.env` :

```env
HOST_IP=192.168.1.100
ADMIN_PASSWORD=MonMotDePasseSecurisé
SESSION_SECRET=une-chaine-aleatoire-longue-et-unique
PORT=3000
```

---

## Configurer le SSO (OIDC)

En plus du mot de passe partagé, l'application peut déléguer l'authentification à n'importe quel fournisseur **OpenID Connect** (Azure AD/Entra ID, Okta, Keycloak, Google Workspace, Authentik, etc.) via `openid-client`. Le mot de passe local **reste toujours actif** en secours, même si le SSO est configuré.

| Variable              | Défaut                | Description                                                        |
|------------------------|------------------------|----------------------------------------------------------------------|
| `OIDC_ISSUER_URL`       | *(désactivé si vide)* | URL de l'issuer OIDC (découverte via `/.well-known/openid-configuration`) |
| `OIDC_CLIENT_ID`        |                        | Client ID enregistré auprès du fournisseur                          |
| `OIDC_CLIENT_SECRET`    |                        | Client secret correspondant                                         |
| `OIDC_REDIRECT_URI`     |                        | URL de callback, doit être **exactement** celle enregistrée chez le fournisseur (ex. `https://portainer-manager.example.com/auth/oidc/callback`) |
| `OIDC_SCOPE`            | `openid profile email`| Scopes demandés                                                     |
| `OIDC_DISPLAY_NAME`     | `SSO`                  | Libellé du bouton sur la page de connexion (ex. `Entra ID`, `Okta`) |
| `OIDC_ALLOW_INSECURE`   | `false`                | `true` pour autoriser un issuer en HTTP ou avec certificat auto-signé — **dev/test uniquement**, jamais en production |

Les trois variables `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID` et `OIDC_CLIENT_SECRET` (+ `OIDC_REDIRECT_URI`) sont **toutes requises** pour activer le SSO ; si l'une manque, seul le mot de passe local est proposé.

### Exemple — Keycloak
```env
OIDC_ISSUER_URL=https://keycloak.example.com/realms/mon-realm
OIDC_CLIENT_ID=portainer-manager
OIDC_CLIENT_SECRET=xxxxxxxx
OIDC_REDIRECT_URI=https://portainer-manager.example.com/auth/oidc/callback
OIDC_DISPLAY_NAME=Keycloak
```

### Exemple — Azure AD / Entra ID
```env
OIDC_ISSUER_URL=https://login.microsoftonline.com/<tenant-id>/v2.0
OIDC_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
OIDC_CLIENT_SECRET=xxxxxxxx
OIDC_REDIRECT_URI=https://portainer-manager.example.com/auth/oidc/callback
OIDC_DISPLAY_NAME=Entra ID
```

Dans les deux cas, il faut déclarer `OIDC_REDIRECT_URI` comme URI de redirection autorisée côté fournisseur (type "Web"/"Authorization Code").

> **Pourquoi pas LDAP ?** La seule bibliothèque LDAP viable pour Node.js (`ldapjs`, et tout ce qui en dépend comme `passport-ldapauth`) a été [officiellement décommissionnée](https://github.com/ldapjs/node-ldapjs) par son mainteneur, sans successeur maintenu. OIDC est privilégié car activement maintenu et couvre la quasi-totalité des annuaires d'entreprise modernes (y compris Active Directory via ADFS ou Entra ID).

---

## Rôles admin/viewer (OIDC)

Par défaut, tout utilisateur authentifié (mot de passe local ou SSO) a un accès complet (**admin**). Il est possible de restreindre les utilisateurs SSO à un rôle **viewer** (lecture seule) selon un claim/groupe renvoyé par le fournisseur OIDC. Le mot de passe local reste toujours **admin**, quel que soit ce réglage.

| Variable          | Défaut     | Description                                                                 |
|-------------------|------------|-------------------------------------------------------------------------------|
| `OIDC_ROLE_CLAIM`  | `groups`   | Nom du claim ID Token contenant les groupes/rôles de l'utilisateur           |
| `OIDC_ADMIN_GROUP` | *(aucun)*  | Valeur du claim qui donne le rôle admin. Si absent, **tous les utilisateurs SSO sont admin** (comportement actuel inchangé) |

Exemple — seuls les membres du groupe `portainer-admins` (Keycloak, Entra ID...) sont admin, les autres utilisateurs SSO sont en lecture seule :
```env
OIDC_ROLE_CLAIM=groups
OIDC_ADMIN_GROUP=portainer-admins
```

Ce que le rôle **viewer** ne peut pas faire (masqué côté interface **et** rejeté côté API — 403) :
- Ajouter / modifier / supprimer une instance, actions groupées
- Accéder aux Paramètres (webhook, rétention, export/import) et au Journal d'audit

---

## Mettre l'application derrière un reverse proxy

L'app écoute en HTTP simple sur le port interne défini par `PORT` (3000 par défaut), exposé côté hôte via le mapping défini dans `docker-compose.yml` (ex. `127.0.0.1:3001:3000`). Un reverse proxy permet d'ajouter un nom de domaine et le TLS/HTTPS devant.

Dans tous les cas :
- Adaptez `proxy_pass` / `reverse_proxy` au port réellement exposé côté hôte (celui de `ports:` dans `docker-compose.yml`, pas forcément 3000).
- Le cookie de session n'est pas marqué `Secure`, donc il fonctionne tel quel derrière un proxy qui termine le TLS (le trajet proxy → app reste en HTTP interne). Pas de configuration supplémentaire côté app nécessaire.
- Pensez à garder `SESSION_SECRET` fixe dans `.env` (voir plus haut).

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name portainer-manager.example.com;

    ssl_certificate     /etc/letsencrypt/live/portainer-manager.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/portainer-manager.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Caddy

Le TLS est géré automatiquement (Let's Encrypt) — pas de config manuelle des certificats.

```caddyfile
portainer-manager.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

### Traefik

Si Traefik tourne déjà via Docker sur le même hôte, ajoutez ces labels au service dans `docker-compose.yml` (et retirez le mapping `ports:` si Traefik doit être le seul point d'entrée) :

```yaml
services:
  portainer-manager:
    # ... reste de la config inchangé ...
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.portainer-manager.rule=Host(`portainer-manager.example.com`)"
      - "traefik.http.routers.portainer-manager.entrypoints=websecure"
      - "traefik.http.routers.portainer-manager.tls.certresolver=letsencrypt"
      - "traefik.http.services.portainer-manager.loadbalancer.server.port=3000"
    networks:
      - traefik-public

networks:
  traefik-public:
    external: true
```

### Apache

Nécessite les modules `proxy` et `proxy_http` (`a2enmod proxy proxy_http` puis reload).

```apache
<VirtualHost *:443>
    ServerName portainer-manager.example.com

    SSLEngine on
    SSLCertificateFile      /etc/letsencrypt/live/portainer-manager.example.com/fullchain.pem
    SSLCertificateKeyFile   /etc/letsencrypt/live/portainer-manager.example.com/privkey.pem

    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:3001/
    ProxyPassReverse / http://127.0.0.1:3001/
    RequestHeader set X-Forwarded-Proto "https"
</VirtualHost>
```

---

## Créer un API Token Portainer

1. Connectez-vous à votre instance Portainer
2. Cliquez sur votre nom d'utilisateur en haut à droite → **Mon compte**
3. Section **Access tokens** → **Add access token**
4. Donnez un nom, copiez le token généré (format `ptr_…`)

---

## Structure du projet

```
portainer-manager/
├── server.js              # Backend Express (API, proxy Portainer, auth OIDC, webhook, uptime)
├── package.json
├── Dockerfile
├── docker-compose.yml
├── LICENSE                # GPL-3.0
├── CHANGELOG.md
├── .env                   # Variables d'environnement (ne pas committer)
├── screenshots/
├── data/
│   ├── instances.json     # Instances sauvegardées, tokens chiffrés (créé automatiquement)
│   ├── config.json        # Config webhook, filtre environnements, rétention uptime (créé automatiquement)
│   ├── uptime.json        # Historique uptime (créé automatiquement)
│   ├── audit.log          # Journal d'audit, JSONL append-only (créé automatiquement)
│   └── sessions/          # Sessions persistées sur disque (créé automatiquement)
└── public/
    ├── index.html         # Dashboard principal
    ├── login.html         # Page de connexion
    ├── status.html        # Page de statut publique (sans authentification)
    ├── style.css
    └── app.js
```

---

## API REST

### Auth
| Méthode | Route                  | Description                      |
|---------|------------------------|----------------------------------|
| POST    | `/api/auth/login`      | Connexion locale `{password}`    |
| POST    | `/api/auth/logout`     | Déconnexion                      |
| GET     | `/api/auth/me`         | Utilisateur connecté (`{username, method, role}` ou `null`) |
| GET     | `/api/auth/methods`    | Méthodes de connexion disponibles (`{local, oidc, oidcLabel}`) |
| GET     | `/auth/oidc/login`     | Redirige vers le fournisseur OIDC |
| GET     | `/auth/oidc/callback`  | Callback OIDC (échange du code, création de session) |

### Instances (admin)
| Méthode | Route                        | Description                                        |
|---------|------------------------------|----------------------------------------------------|
| GET     | `/api/instances`             | Liste toutes les instances (sans token) — admin et viewer |
| POST    | `/api/instances`             | Ajouter `{name, url, token, environment, notes}`   |
| PUT     | `/api/instances/:id`         | Modifier `{name, url, token, environment, notes}`  |
| DELETE  | `/api/instances/:id`         | Supprimer une instance                             |
| GET     | `/api/instances/:id/data`    | Données live depuis l'API Portainer — admin et viewer |

### Divers
| Méthode | Route                          | Description                            |
|---------|--------------------------------|----------------------------------------|
| GET     | `/api/uptime`                  | Historique uptime par instance — admin et viewer |
| GET     | `/api/config`                  | Configuration (webhook, filtre environnements, rétention uptime) — admin |
| PUT     | `/api/config`                  | Modifier la configuration — admin      |
| POST    | `/api/config/test-webhook`     | Tester un webhook — admin              |
| GET     | `/api/portainer/latest-version`| Dernière version CE (cache 1h)         |
| GET     | `/api/app/version`             | Version de l'app et dernière version disponible sur GitHub (`{current, latest}`, cache 1h) |
| GET     | `/api/backup/export`           | Exporter la configuration complète (JSON) — admin |
| POST    | `/api/backup/import`           | Importer une sauvegarde (upsert par id/URL) — admin |
| GET     | `/api/audit`                   | 200 dernières entrées du journal d'audit — admin |
| GET     | `/status`                      | Page de statut publique, sans authentification |
| GET     | `/api/status/public`           | Compteurs agrégés `{total, online, offline, unknown}`, sans authentification |

---

## Sauvegarde et restauration

Le bouton **⚙️ Paramètres → Sauvegarde** exporte un fichier JSON contenant toutes les instances (avec leurs tokens **chiffrés**, pas en clair) et les réglages (webhook, filtre environnements, rétention uptime).

- **Export** : `GET /api/backup/export`, déclenche le téléchargement d'un fichier `portainer-manager-backup-AAAA-MM-JJ.json`.
- **Import** : `POST /api/backup/import` avec le même format. Les instances sont **fusionnées** par `id` puis par `url` (mise à jour si une correspondance existe, création sinon) — rien n'est supprimé automatiquement. Un token déjà présent est réutilisé si le fichier importé n'en fournit pas.

> ⚠️ Les tokens restent **chiffrés** dans le fichier exporté (AES-256-GCM), mais ce fichier doit être traité comme un secret : il ne redevient lisible qu'avec le `SESSION_SECRET` de l'instance qui l'a généré, mais autant le stocker comme n'importe quel export de credentials.

---

## Licence

[GPL-3.0](LICENSE)
