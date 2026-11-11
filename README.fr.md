# OEM Enterprise · Espace de travail de services d'entreprise open source + Réseautage d'affaires

<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ja.md">日本語</a> · <a href="README.ar.md">العربية</a> · <strong>Français</strong> · <a href="README.es.md">Español</a> · <a href="README.ru.md">Русский</a>
</p>

**Démo en ligne : <https://enterprise.aiworkin.com>**

Un projet open source qui fusionne et porte deux systèmes en un : l'**espace de travail de services d'entreprise**
(Hono + Prisma + MySQL + Next.js / Ant Design) et le **réseautage d'affaires SNS**
(relations / publications / groupes / messages privés / CV / place d'offre et de demande / recrutement).

Ce n'est pas un outil isolé, mais une base complète pour « gestion interne de l'entreprise + acquisition externe de clients + mise en relation d'affaires » : au-dessus d'un système unifié de comptes et d'identités,
une **page d'accueil officielle** (`/`, page d'atterrissage pour visiteurs non connectés, dont l'en-tête ne propose que Connexion / Inscription) accueille d'abord le visiteur, puis mène au cockpit,
à 21 entrées d'espace de travail (Mes tâches, Agent, Flux de travail, Base de connaissances, Workbuddy Cloud d'entreprise, Tableaux multidimensionnels, RPA, Création de contenu, Outils marketing,
Actifs numériques, E-mail IA, CRM, BI, OA, OKR, Service client IA, Espace RH, Gestion de projet, Achats et stocks, Centre d'applications, Hall thématique),
à 11 lignes de services métier (Marketing / Distribution et approvisionnement / Fiscalité et comptabilité / International / Emploi flexible / Logistique / IT / Propriété intellectuelle / Juridique / Think tank / Transaction d'actifs), au réseautage d'affaires et au recrutement,
ainsi qu'à une console d'administration de plateforme organisée en 5 catégories et 26 sections au total (la vue d'ensemble des données de plateforme est fusionnée dans le cockpit `/dashboard`). Toutes les capacités sociales et d'offre/demande sont
**entièrement locales et utilisables sans clé** ; pour publier des demandes / services sur la place amont (AIworkin), tenir le profil d'entreprise ou demander des qualifications, il suffit de lier une clé API AIPDD
— **ce système n'implique aucune crypto-monnaie, ne conserve jamais les comptes amont et réécrit localement tous les styles et interactions**.

> Pour la spécification de conception et de migration, voir [`docs/开源版整体设计方案.md`](docs/开源版整体设计方案.md).

| Spécification | Nombre |
|---|---|
| Routes de page (Next.js App Router) | 75 |
| Opérations HTTP (périmètre de l'instantané OpenAPI) | 1947 |
| Modèles de données Prisma | 528 |
| Modules métier backend | 91 |
| Langues d'interface | 8 (dont RTL intégral pour l'arabe) |
| Base de données | MySQL 8 ou PostgreSQL (au choix à l'installation) |

> Version actuelle **v1.4.0** ([notes de version](https://github.com/liujh0729-jpg/AI-enterprise-OEM/releases/tag/v1.4.0)) : comptes et connexion améliorés (codes de vérification e-mail / SMS, connexion par QR WeChat, mémorisation 30 jours), partage de documents étendu au personnel des fournisseurs, et nouveaux modules incluant l'espace de travail Base de connaissances, la place de modèles, l'atelier SEO, l'acquisition de prospects IA, WeCom SCRM et le matériel intelligent.

---

## 📸 Aperçu de l'interface

> Les captures ci-dessous proviennent du site de démonstration <https://enterprise.aiworkin.com> (vue super-administrateur, menus « Espace de travail / Services métier » à gauche).

**Espace de travail Agent** : le dialogue produit directement images / vidéos ; les onglets couvrent conversation, tâches planifiées, assistant, avatar numérique, compétences, experts et connecteur MCP (la porte d'autorisation « actions exécutables automatiquement » est rattachée à l'onglet connecteur MCP).
<img src="docs/screenshots/agent.png" width="900" alt="Espace de travail Agent">

**Outils marketing** : outils d'acquisition, de démarchage et de données sur un seul écran, chaque carte avec sa description et son entrée dédiée (Acquisition IA : radar de pistes → démarchage → fiche client → scénarios de vente → suivi → contrôle qualité et tableau de bord, la collecte et le démarchage étant exécutés par le plugin AIPDD Enterprise ; WeCom SCRM : synchronisation native des clients, envois de masse avec confirmation manuelle, SOP, barre latérale employé, mots sensibles et contrôle qualité IA ; mise en relation d'influenceurs, appels sortants / envoi d'e-mails Alibaba Cloud, optimisation GEO, optimisation SEO, acquisition par QR dynamique, Tencent Qidian, prospection de leads, méga-données mondiales, diffusion de contenu multiplateforme, conception d'enquêtes, SalesBuddy).
<img src="docs/screenshots/marketing-tools.png" width="900" alt="Outils marketing">

**Création de contenu** : texte-vers-image, image-vers-vidéo, clonage vidéo, avatar numérique, retouche et suppression de filigrane, extraction de texte, synthèse vocale, musique, doublage, montage, script inverse et texte de voix off, plus des packs d'images « optimisation de fiche produit » pour le e-commerce transfrontalier et national ; la « Communauté de modèles vidéo » parcourt les extraits par usage / récence / favoris, reproduit avec son propre modèle à partir d'un prompt et d'une image de référence (la reproduction est une tâche asynchrone, suivie dans l'onglet « Tâches de génération » de la page avec la vidéo finale ; consulter une recette payante crédite l'auteur en points, et l'admin peut compléter avec les modèles de la plateforme AIworkin) ; enfin un outil de création vidéo déployable localement.
<img src="docs/screenshots/content-creation.png" width="900" alt="Création de contenu">

**Services fiscaux** : documents de déclaration, plan de déclaration, gestion des dossiers comptables, capacités d'automatisation et flux de demandes ; le plan de déclaration est généré automatiquement selon la nature de contribuable et la fréquence de déclaration de l'entreprise signataire, avec suivi par impôt et accès au formulaire de déclaration.
<img src="docs/screenshots/tax-service.png" width="900" alt="Services fiscaux">

**Service client IA** : conversations, équipe de service, paramètres d'accueil, formules et connaissances, sites et intégration, accès par canal et statistiques sur un seul écran ; le statut d'accueil est en ligne / absent / hors ligne, seul « en ligne » participe à l'attribution automatique.
<img src="docs/screenshots/ai-service-desk.png" width="900" alt="Service client IA">

---

## 🗺️ Carte des fonctionnalités

| Groupe | Module | En une phrase | Identifiants amont |
|---|---|---|---|
| Accueil | Page d'accueil officielle (`/`) | Page d'atterrissage statique pour visiteurs non connectés : premier écran, carrousel de scénarios, sections métier, intégrations ouvertes, étapes d'utilisation et FAQ ; l'en-tête ne propose que « Connexion / Inscription », le pied de page lit le nom, le logo, l'ICP et les liens définis dans les paramètres du site ; textes et images sont maintenus dans l'admin « Paramètres système → Paramètres d'accueil » | Non |
| Accueil | Cockpit des dirigeants (`/dashboard`) | Identités et qualifications, mes tâches à faire, registres métier ; l'en-tête offre des raccourcis « Gérer les clés API / Recharger des points » et, si aucune clé AIPDD n'est liée, une entrée de liaison rouge ; le cockpit de l'administrateur de plateforme présente aussi la vue d'ensemble des données de plateforme, les validations en attente et la répartition des types de service des fournisseurs | Non |
| Espace de travail | Agent | Le dialogue produit directement images / vidéos, les résultats entrent dans les actifs numériques AIPDD du compte | AIPDD |
| Espace de travail | Base de connaissances (`/kb`) | Les sources entrent dans un espace de connaissances et sont compilées en pages wiki traçables, les `[[liens]]` font grandir un graphe de connaissances, recherche hybride et Q&R avec citations, l'onglet mémoire porte la mémoire à long terme et la mémoire opérationnelle | Non |
| Espace de travail | Workbuddy Cloud d'entreprise | Tâches planifiées (brief de tâche clarifié par IA), Agent, comptes cloud d'entreprise et comptes d'appel IA hébergés | Tencent Cloud |
| Espace de travail | Tableaux multidimensionnels | Tableaux de données structurés auto-construits, 8 types de colonnes, création de tableau en une phrase, colonnes / questions / vues IA, canal machine par clé API, synchronisation Feishu | Non |
| Espace de travail | Automatisation RPA | Tâches / comptes / scripts RPA cloud, navigateur Bit local qui réclame et exécute puis renvoie les résultats ; l'extension Chrome locale devient un **agent de navigation** — décrivez le résultat dans le panneau latéral et l'Agent agit en autonomie, en plusieurs étapes, sur les sites où vous êtes déjà connecté, et vous pouvez créer des tâches planifiées qui s'exécutent automatiquement à la fréquence définie | AIPDD / extension locale |
| Espace de travail | Création de contenu | Texte-vers-image / vidéo, avatar numérique, doublage et musique, montage, suppression de filigrane et super-résolution, packs d'optimisation de fiche produit, communauté de modèles vidéo, Drama Agent | AIPDD |
| Espace de travail | Outils marketing | Acquisition IA, WeCom SCRM, mise en relation d'influenceurs, appels sortants / e-mails Alibaba Cloud, optimisation GEO, optimisation SEO, acquisition par QR dynamique, Qidian, prospection de leads, méga-données mondiales, diffusion de contenu multiplateforme, conception d'enquêtes, bibliothèque de compétences marketing, SalesBuddy | Services tiers / plugin local |
| Espace de travail | Gestion des actifs numériques | Octets stockés dans l'OSS du site : recherche, étiquetage, envoi et suppression ; « Documents partagés » partage par compte au sein d'une même organisation (entreprise vérifiée ou fournisseur), les fichiers restent à l'auteur ; les actifs hébergés AIPDD historiques peuvent être migrés par lots dans l'admin | Non |
| Espace de travail | Service e-mail IA | Lecture multi-boîtes POP3 / IMAP, corps et pièces jointes non stockés, rédaction ou réponse automatique selon le script | Code d'autorisation e-mail |
| Espace de travail | CRM | Pistes, clients, opportunités, contrats de vente, encaissements, commandes, validations et rapports | Non |
| Espace de travail | Analyse intelligente BI | Jeux de données sélectionnés intégrés + sources externes en lecture seule, interrogation intelligente, graphiques, tableaux de bord | Non |
| Espace de travail | OA | Formulaires congé / note de frais / paiement / achat / usage du sceau et validation multi-niveaux, résultats réinjectés dans le métier | Non |
| Espace de travail | Plan OKR | Cycles, arbre d'objectifs de l'entreprise à l'individu, rapports hebdomadaires/quotidiens, notation de revue | Non |
| Espace de travail | Espace RH | Dossiers, absences, recrutement, paie et tableau de bord RH (les « employés / agents » de l'organisation sont un seul ensemble de personnes) | Non |
| Espace de travail | Gestion de projet | Projets / membres / jalons / itérations, tâches et dépendances, temps passé et validation des feuilles hebdomadaires, taux de coût et registres, collaboration externe et annuaire des entités, WBS et santé IA | Non |
| Espace de travail | Achats et stocks | Produits et variantes, stock d'entrepôt et mouvements, réceptions d'achat, créances/dettes et notes de frais, taux de taxe et politiques de prix, insights métier IA | Non |
| Espace de travail | Service client IA | Un compte porte plusieurs sites officiels, accueil humain + trois modes de réponse IA | Non |
| Espace de travail | Centre d'applications | Applications intégrées + place d'applications, quatre onglets avec recherche par mot-clé | Non |
| Espace de travail | Hall thématique | Discussions thématiques internes / publiques, l'initiateur peut clore et faire résumer par l'IA | Non |
| Services métier | Marketing / Distribution / Fiscalité / International / Emploi flexible / Logistique / IT / Propriété intellectuelle / Juridique / Think tank / Transaction d'actifs | Annuaire de fournisseurs → détail → signature ; canal de messages de demande et registres métier | Partiel |
| Réseautage d'affaires | Réseautage social | Amis / blocage, publications, groupes à la Douban, messages privés, CV professionnel | Non |
| Réseautage d'affaires | Recrutement | Place de recrutement (publication de postes et échange par message privé) + CV IA (profil, correspondance, optimisation, confirmation de candidature et entonnoir) | Local non / sync oui |
| Réseautage d'affaires | Place d'offre et de demande | Publication universelle de demandes / services, en deux temps : local sans clé + synchronisation amont facultative | Local non / sync oui |
| Services de modèles | Place de modèles (`/model-plaza`) | Modèles disponibles référencés uniformément par la plateforme : unité de facturation identique à l'amont, essai en ligne et registre d'usage, gateway compatible OpenAI via une clé `ek_` | Non |
| Services de modèles | Clé API / API-MCP-Skill / Paramètres de modèle / Plateforme de calcul AIPDD | Clé ek_ pour appeler `/api/v1`, connexion MCP, choix de modèle, et un lien externe direct vers la plateforme de calcul AIPDD en fin de liste | Partiel |
| Paramètres de gestion | Identités et qualifications / Employés·agents / Gestion des signatures / Mes forfaits / Centre de points / Mes invitations / Mécanismes de plateforme | Vérification, équipe, registre des signatures, points double devise, relations d'invitation, ainsi que Webhook, import/export, règles, partage, OIDC, synchronisation Feishu / WeCom, trace d'acceptation des conditions, suivi d'usage et bascule d'entité | Partiel |
| Matériel intelligent | Place du matériel / Ajout de matériel / MCP matériel / API matériel | Annuaire de modèles et kits de développement (téléchargement SDK / firmware, vérification SHA-256) ; connexion des appareils et état en ligne par battement de cœur ; outils MCP dédiés par modèle (contrôle par Agent, `hw__modèle__outil`) et API (`/api/v1/hardware/**`) ; SDK / exemples / simulateur dans le dépôt `hardware-devkit/` | Non |
| Console de plateforme | 26 sections / 5 groupes (voir ci-dessous) | Validation des enregistrements, qualifications fournisseurs et catégories, supervision des signatures, pool de comptes fiscaux, supervision GEO / QR dynamique, contrôle des risques de points, forfaits officiels, place de modèles, validation de publication, quotas de droits, suivi d'usage, matériel intelligent, versions des conditions, journal des mises à jour, mise à niveau de la plateforme, paramètres système | — |
| Aide et documentation | Centre d'aide `/help` | Base de connaissances versionnée par chapitres (Démarrage rapide / Outils de l'espace de travail / Contenu et marketing / Diffusion multiplateforme / Matériel intelligent / Métier et paramètres de gestion) ; l'aide générale est répartie par rôles (utilisateur entreprise/particulier, fournisseur, employé de fournisseur) mais tous y ont accès, la section administration de plateforme et déploiement/exploitation Alibaba Cloud n'étant visible que par l'administrateur de plateforme ; la même connaissance est exposée en outils MCP en lecture seule, on peut donc demander directement à l'Agent la documentation officielle | Non |

---

## 📖 Détails des fonctionnalités

### 1. Comptes, identités et sessions

- **Boucle de compte locale** : inscription (nom d'utilisateur / e-mail / téléphone au choix), connexion, récupération, changement de mot de passe, changement de liaison, suppression de compte ; journal de connexion et bannissement au niveau plateforme.
- **Méthodes de connexion et vérification à l'inscription** : la page de connexion affiche dynamiquement selon les interrupteurs d'administration « connexion classique (compte + mot de passe) / code par e-mail / code par SMS / QR WeChat » ;
  l'inscription affiche selon les modes activés par l'administrateur « nom d'utilisateur / e-mail / téléphone » ; l'inscription par e-mail ou SMS exige d'abord la validation d'un code (l'e-mail requiert un SMTP configuré, le téléphone un SMS Alibaba Cloud ;
  un canal non configuré ne peut pas être coché côté administration et n'apparaît pas côté site). Après avoir coché « connexion automatique pendant 30 jours », la session est prolongée à 30 jours.
- **Connexion / inscription par QR WeChat** : QR de l'« application web » de la plateforme ouverte WeChat ; si déjà lié, connexion directe, sinon, si l'inscription automatique est activée, le compte est créé et lié (nom d'utilisateur `wx_<8 derniers caractères de l'openid>`,
  pseudo et avatar récupérés et préremplis) ; si l'inscription automatique est désactivée, l'utilisateur est invité à confirmer son identité par compte/mot de passe ou code e-mail / SMS avant liaison ; le `state` du QR est à usage unique et valable 5 minutes,
  l'AppSecret est stocké chiffré et l'administration ne renvoie qu'un masque.
- **Administration « Paramètres système → Comptes et connexion »** : maintenance unifiée des modes d'inscription, des modes de connexion, du SMTP, du SMS Alibaba Cloud et des paramètres WeChat ; l'activation d'un canal exige au préalable les identifiants correspondants.
- **Normalisation en minuscules du nom d'utilisateur et de l'e-mail** : le classement MySQL est insensible à la casse, PostgreSQL y est sensible ; tout est stocké et dédupliqué en minuscules, pour un comportement identique sur les deux bases ; sur une base existante, backfill idempotent via
  `pnpm --filter aiworkin-enterprise-api db:normalize-usernames`.
- **Session auto-signée du site** : seules les sessions SSO émises localement sont acceptées (issuer `enterprise-sso`, clé dérivée de `JWT_SECRET` par HKDF),
  chaque requête vérifie l'état du compte et `tokenVersion` — changement de mot de passe, de liaison ou bannissement invalident immédiatement ; tout jeton de plateforme amont est refusé.
- **Revérification en règle des artefacts déjà persistés** : anciens partages publics, téléchargements de fichiers exportés, jetons de l'extension Chrome, tâches planifiées sans intervention, déclenchements planifiés / par événement des workflows, qualité de membre d'un projet d'organisation low-code — à l'usage, tout est revérifié selon les tables courantes « état du compte + relation d'appartenance à l'organisation » ; le départ d'un collaborateur ou un changement de rôle prend effet immédiatement (sans attendre le nettoyage asynchrone des membres de projet ni le cache) ; la réponse externe est uniformément « inexistant / expiré », sans révéler la cause.
- **Multi-identités et types de sujets** : administrateur de plateforme, utilisateur entreprise, fournisseur, employé de fournisseur (agent), quatre identités ;
  le sujet est entreprise, entreprise individuelle ou particulier. Après changement d'identité, la barre latérale est réorganisée : l'administrateur de plateforme ne voit que la console d'administration
  de plateforme (cinq groupes Utilisateurs et fournisseurs / Supervision de l'exploitation / Facturation et produits / Capacités et sécurité / Système et contenu ; la vue d'ensemble des données de plateforme est directement intégrée au cockpit de direction `/dashboard`),
  sans le « Réglages de gestion » du point de vue du compte personnel.
- **Authentification et qualifications** : les informations d'entreprise prennent effet dès soumission ; l'enregistrement d'un fournisseur requiert l'examen de la plateforme ; un employé doit lier ou être rattaché à un fournisseur.
- **Code d'invitation** : chaque compte possède un code d'invitation dédié ; le renseigner (facultatif) à l'inscription établit la relation d'invitation ; « Mes invitations » affiche le code, le lien d'inscription, qui vous a invité et le nombre de personnes invitées ; « Inviter à s'inscrire » dans le menu de l'avatar d'en-tête mène directement à cette page.

### 2. Cockpit

- Raccourcis en haut à droite de l'en-tête : **Gérer la clé API**, **Recharge de points**, puis seulement le bouton d'identité (pour l'administrateur « Console d'administration », pour les autres identités « Identité et qualifications ») ; sans clé API AIPDD liée, une pastille rouge **Lier la clé API AIPDD** apparaît à l'extrême gauche, menant directement au bloc de liaison de « Gestion des clés API », et disparaît une fois la liaison faite.
- Cartes statistiques : **« Mes tâches » toujours en tête** (nombre de tâches non traitées du centre de tâches, clic vers `/tasks`), **« Contrats en vigueur » toujours en queue**, les autres cartes ayant une page dédiée sont cliquables ; chaque identité a son propre jeu de cartes — entreprise (Mes tâches / Choses à faire / OA à approuver / Nouveaux messages / Contrats en vigueur), fournisseur (Mes tâches / Entreprises servies / Choses à faire / OA à approuver / Contrats en vigueur), employé (Mes tâches / Organisation de rattachement / Entreprises prises en charge / Choses à faire / OA à approuver), administrateur de plateforme (Mes tâches / Choses à faire / Nouveaux messages).
- Le premier bloc sous les cartes statistiques est la **navigation rapide** : la carte des raccourcis courants est cliquable en entier, le « Réglage » en haut à droite permet d'ajouter / retirer et de trier, persisté au niveau du compte ; suivent le **cockpit de croissance** de l'identité entreprise (progression des objectifs, encaissements, projets en livraison, conversion d'acquisition, transformation service client → piste), « Mes choses à faire » (total des non-terminés par bloc, les catégories de service non ouvertes étant masquées selon l'identité), **Top 5 de mes tâches** (chaque ligne mène au module source pour traitement), la vue d'ensemble « à traiter » et des nouveaux messages.
- **« À traiter » ne reconnaît qu'un seul référentiel, `bySource` du centre de tâches** (même source que `/tasks`) : ne liste que les éléments qui vous sont propres et comportent actuellement un nombre (consultations du site, OA, CRM, OKR, projets, workflows, contrats à confirmer, examens de plateforme) ; « invitations de liaison à confirmer » n'appartient à aucune source de tâche et est ajoutée sur une ligne distincte.
- Administrateur de plateforme : le cockpit est la vue d'ensemble des données de plateforme (inscriptions / entreprises / fournisseurs / signatures / documents métier divers et montants de taxe), les approbations à traiter (enregistrements de fournisseurs) et la répartition des types de service des fournisseurs ; la barre latérale mène directement à chaque bloc de supervision.

### 3. Espace de travail (21 entrées)

| Module | Points clés |
|---|---|
| **Mes tâches** | Centre de tâches unifié : regroupe sur un seul écran huit types de tâches — approbations OA, choses à faire OKR, tâches de projet, choses à faire CRM, sessions de service client, confirmations de signature, examens de plateforme, nœuds humains de workflow (collecte complète au niveau du compte, filtrage par source / groupe + recherche + pagination) ; chaque ligne n'affiche que la présentation de la tâche, l'état du centre et l'état du métier, et l'entrée « traiter » — le détail reste traité dans le module source. L'état du centre (à faire → en cours → terminé / annulé / expiré) est affiché séparément de l'état métier faisant autorité ; vous pouvez fermer / rouvrir (confirmation par mot de passe), et l'état métier final du module source clôt automatiquement ; le cockpit dispose en outre d'un panneau Top 5. |
| **Agent** | Dialoguer avec un modèle pour produire directement images / vidéos, les résultats étant automatiquement enregistrés dans les actifs numériques AIPDD de ce compte ; mémoire à long terme / base documentaire / mémoire opérationnelle sont fusionnées dans l'onglet « Base de connaissances → Mémoire » (base documentaire et mémoire à long terme unifiées dans la base de connaissances, l'Agent conservant un référentiel de recherche unique sur tout le site) ; la barrière d'autorisation « actions exécutables automatiquement » est rattachée à l'onglet des connecteurs MCP et gère deux types d'autorisation — les actions d'écriture de contrat et les outils d'un connecteur MCP auto-construit (les outils de connecteur sont refusés par défaut, dès lors qu'on coche toute une chaîne de connecteur ils sont ouverts ; non autorisé, on ne renvoie qu'un brouillon, et en mode sans intervention rien n'est exécuté). À l'upload d'une compétence / d'un plugin, un contrôle de sécurité IA est d'abord effectué (avec la clé et le modèle configurés dans « Réglages du modèle ») ; seuls les éléments conformes entrent en base, et ceux déclarant des permissions exigent une confirmation avant activation ; à l'exécution, des garde-fous encadrent le nombre d'appels, les appels répétés et la sortie. Modèles et clés se configurent dans « Services de modèle → Réglages du modèle ». |
| **Workflows** | Orchestration multi-étapes visuelle : glisser-déposer des nœuds et des liens sur le canevas, le catalogue de nœuds dérivant d'un registre de capacités unifié (actions de contrat, outils internes / métier / de connecteur / matériels / de compétence / de plugin, ainsi que les nœuds internes déclencheur / branche conditionnelle / parallélisme et jonction / IA / humain / Webhook), les formulaires de paramètres étant générés automatiquement à partir des contrats ; à la création, on peut choisir parmi 5 modèles de recettes internes (suivi d'acquisition / renouvellement de contrat / relance d'encaissement / contrôle qualité des tickets / ouverture d'intégration), qui préremplissent nom et description et apportent le diagramme de flux, le destinataire étant par défaut l'initiateur lui-même, prêt à l'emploi une fois copié ; vous pouvez aussi cliquer sur « Créer avec l'IA » et décrire le besoin en une phrase ou quelques échanges, le modèle texte réécrit alors le canevas courant à partir des nœuds existants du système (même validation DAG avant acceptation, et ce qu'il ne peut pas mapper est renvoyé au nœud « Agent IA »), puis cliquez « Appliquer au canevas » et enregistrez ; enregistrer le brouillon → essai pas à pas dans le Playground (entrée / sortie / durée / erreur de chaque étape) → publier une version figée. À l'exécution, détection de cycle du DAG et résolution des variables de modèle (`{{input.x}}` / `{{vars.x}}` / `{{nodes.id.x}}` / `{{actor.userId}}`) ; les nœuds humains sont suspendus puis réveillés par la fermeture dans « Mes tâches » ; un workflow déjà partagé entre dans le catalogue de l'Agent du site et des outils MCP sous `wf__<id>`. Avant tout déclenchement planifié / par événement métier / par événement de tâche, l'état du compte de l'initiateur et la qualité d'appartenance à l'organisation sont revérifiés selon les tables courantes ; après un départ ou une exclusion de l'organisation, le processus ne démarre plus automatiquement. La liste est regroupée par « les miennes + un onglet par sujet » (`Société A · partage société` / `Fournisseur C · partage fournisseur`, le nom du sujet provenant de votre organisation, les noms longs étant tronqués avec info-bulle) ; le domaine de données de workflow de chaque sujet est indépendant, jamais mélangé dans une même liste, et à la création on peut aussi choisir vers quelle société / quel fournisseur partager. |
| **Base de connaissances** | Versez comptes rendus de réunion, articles, transcriptions d'appels dans un espace de connaissance : le système les compile en pages wiki traçables ; les `[[liens]]` du corps font pousser automatiquement un graphe de connaissance, la recherche hybride (mots-clés + vecteurs) et le questions-réponses avec citations sont disponibles dès l'écriture, et sans grand modèle connecté toute la chaîne passe par un repli déterministe à base de règles ; les onglets couvrent espace de connaissance, documents, pages, questions-réponses, graphe, consommateurs et mémoire. Les traces d'activité de l'agent peuvent être condensées en **mémoire opérationnelle**, et le contexte d'avant réponse reflue aussi par ici ; mémoire à long terme et base documentaire sont unifiées dans la base de connaissances, l'Agent ne conservant que ce référentiel de recherche sur tout le site. |
| **Workbuddy Enterprise Cloud** | Tâches planifiées : un langage parlé est clarifié par l'IA en cahier des charges, découpé en lignes et distribué, avec synchronisation des messages de l'Agent ; Agent : création / version / session ; comptes Workbuddy Enterprise : les SecretId / SecretKey de l'utilisateur sont stockés chiffrés, plusieurs en parallèle possibles ; comptes d'appel IA : identifiants / clés API / cookies de plateformes tierces stockés chiffrés, autorisés par liaison à un compte cloud d'entreprise et utilisés via le canal machine selon la liaison. |
| **Tableaux multidimensionnels** | Tables de données structurées auto-construites selon le compte : colonnes personnalisées (huit types), saisie ligne par ligne, lecture/écriture possible via le canal machine à clé API ; fournit aussi une entrée de synchronisation avec les tableaux multidimensionnels Feishu et un rappel d'événements Feishu. |
| **Automatisation RPA** | Tâches RPA (créer une tâche lie script + compte + paramètres d'exécution), comptes RPA (identifiants stockés chiffrés), scripts RPA (Automa JSON / JS / Python, générables par un modèle textuel AIPDD à la demande) ; le navigateur Bit local revendique l'exécution via clé API et renvoie les résultats. **Agent de navigation (Chrome local)** — la même extension AIPDD Enterprise se connecte avec votre compte du site et devient un appareil en ligne : le LLM cloud peut décider étape par étape tandis que l'extension exécute dans votre navigateur (renvoie la carte de la page et des captures, s'arrête sur les actions sensibles pour une confirmation manuelle, arrêtable à tout moment, et ne reçoit jamais les identifiants des plateformes cibles), ou appuyez sur Alt+A pour ouvrir le **panneau latéral** de l'extension, décrivez le résultat en une phrase, et l'Agent planifie puis agit en autonomie, en plusieurs étapes, sur les sites où vous êtes déjà connecté et renvoie des résultats structurés ; trois modes Act / Crawl / Extract, avec des modèles issus de la place de marché de modèles du système et facturés en points plateforme. Vous pouvez enregistrer des **compétences** (connaissances personnelles / par site) et des **enregistrements → outils** (relus sur le même chemin d'exécution local que l'Agent, les champs de mot de passe jamais enregistrés), et une **MCP** par défaut est fournie : tant que l'appareil est vert (en ligne), l'Agent plateforme et les clients MCP externes peuvent lui confier des tâches via `/api/v1/mcp` avec les outils `browser_*`. Vous pouvez aussi lier une séquence d'actions déterministe (chrome_actions) pour une relecture sans LLM, ou la lancer et la planifier depuis Agent / MCP et l'onglet « tâches RPA matricielles » sur un appareil en ligne. Le panneau latéral permet aussi de créer des **tâches planifiées** (unique / fréquence récurrente) pour que cet appareil en ligne exécute automatiquement un objectif à l'échéance ; si l'appareil est hors ligne, ce tour est ignoré (sans rattrapage), et la désactivation du compte met la tâche en pause automatiquement. |
| **Création de contenu** | Une seule page de cartes-outils : texte→image, texte / image→vidéo, clonage vidéo, vidéo de double numérique, échange de personne / de produit dans une vidéo, retouche / suppression de filigrane, extraction de texte audio-vidéo, synthèse vocale, création musicale, doublage vidéo, montage court, rétro-ingénierie de script vidéo, script de présentation / article WeChat ; deux cartes d'optimisation de page produit (**optimisation pour le commerce transfrontalier** : packs d'images anglais Amazon / Etsy / site indépendant, image principale et images de détail pilotées par les raisons d'achat ; **optimisation pour l'e-commerce national** : packs de longs détails 750px Taobao / Tmall / JD / Pinduoduo / Douyin, textes respectant les mots extrêmes de la loi publicitaire), création du pack d'images → le grand modèle produit le plan (raisons d'achat, verrous de style, prompts image par image) → génération image par image, avec possibilité de saisir une « description par image » correspondant à l'ordre image principale 1..N / image de détail 1..N ; en fin, « Outils de création vidéo » (AIPDD Drama Agent, accepte la collage direct d'une clé API AIPDD / AIworkin). La super-résolution et la suppression de filigrane passent par Volcano AI MediaKit et n'apparaissent qu'après ajout d'un canal MediaKit avec clé dans les réglages de modèle ; la « Communauté de modèles vidéo » trie par usage / plus récents / plus de favoris et se cherche par mot-clé, on publie échantillon + image de référence + prompt, la consultation peut fixer des points (consultée, elle rapporte des points au publieur), et « utiliser l'effet » porte la recette dans le générateur pour la reproduire avec ses propres modèles. Les résultats générés entrent automatiquement dans les actifs numériques. |
| **Outils marketing** | Les entrées sont réparties en quatre groupes selon la chaîne métier : acquisition et conversion, contenu et croissance SEO, données et extraction de pistes, touche et gestion client, la carte entière étant cliquable. SCRM WeCom (le SCRM natif est la source unique de synchronisation client : miroir clients / étiquettes / groupes clients, codes vivants et messages de bienvenue, étiquetage automatique, envoi groupé client (confirmation manuelle obligatoire), héritage en poste / départ, SOP et H5 de barre latérale employé, blocage sortant / alerte entrante des mots sensibles, contrôle qualité IA à quatre dimensions ; une fois activé, l'import de clients Qidian se met automatiquement en pause pour éviter la double écriture), mise en relation avec des créateurs (filtrage par catégorie / plateforme / abonnés et consultation des contacts), appel sortant intelligent Alibaba Cloud (une liste de tableau multidimensionnel mappée en groupes de tâches d'appel), push e-mail Alibaba Cloud (synchronisation des contacts vers les listes de destinataires Alibaba Cloud), optimisation moteur GEO-AI (visibilité de la marque dans les questions-réponses IA, réservoir de sujets, recommandation de plateformes de publication), optimisation SEO (l'audit de site en scraping HTTP gratuit est disponible ; recherche de mots-clés et lexique, suivi de position, veille concurrentielle, analyse et construction de backlinks, grille SEO locale, pages en masse programmatiques, données structurées et soumission d'indexation IndexNow / Baidu Zhanzhang (JSON-LD exportable en .json), rapport SEO et partage masqué (export Markdown / HTML autonome), mots-clés du lexique et GSC « à portée de main » en un clic vers le suivi de position / vers une question de surveillance GEO, pistes de backlinks synchronisées en un clic vers les listes de destinataires de push e-mail Alibaba Cloud (synchronisation seule, pas d'envoi groupé), pages programmatiques enregistrées en un clic comme actifs de contenu ; avec une clé DataForSEO à la charge de l'utilisateur, déblocage du volume de recherche / position / backlinks réels ; sans clé, aucune falsification, seulement une invite de configuration ; l'interprétation IA passe par le modèle système et consomme des points ; les liens de domaine propre publiés avec succès dans le registre de diffusion peuvent être soumis à l'indexation en un clic), codes vivants pour l'acquisition (entrée fixe + distribution aléatoire / séquentielle / pondérée de sous-codes, quotas, fidélité des visiteurs, statistiques par canal, lien court sur votre propre domaine), Tencent Qidian (données client / exploitation WeCom / touche des membres, les clients pouvant être écrits dans le CRM de ce système), extraction de pistes Google, cinq outils de big data mondiaux (données d'entreprises / commerce mondial / professionnels mondiaux / créateurs mondiaux / POI mondiaux), gestion des ventes IA SalesBuddy ; **diffusion de contenu multiplateforme** — un contenu est diffusé simultanément vers 13 canaux via l'extension de navigateur AIPDD Enterprise (image-texte dynamique : Weibo / Xiaohongshu / Douyin / Kuaishou / Chaîne vidéo / Planet of Knowledge ; articles : Zhihu / Toutiao / Baijiahao / colonne Bilibili / compte WeChat / Jianshu / Douban), le corps étant rédigé dans un éditeur riche, nettoyé selon une liste blanche avant enregistrement, puis l'extension le rétrograde automatiquement selon la capacité du canal en HTML stylisé / Markdown / texte brut ; les états brouillon — à diffuser — distribué — succès / échec et les résultats par plateforme sont consultables dans le registre de ce système, l'action de publication s'effectue localement dans votre navigateur déjà connecté, les identifiants de compte de plateforme ne quittant pas la machine ; **conception et enquête par questionnaire** — conception question par question (choix unique / multiple / texte court / texte long / nombre / date / note), la publication génère un lien de réponse sans connexion et un QR, chaque réponse est automatiquement écrite dans un tableau multidimensionnel propre au questionnaire (filtrable, exportable, avec synchronisation Feishu), l'administration agrège par question la part des options et la moyenne des valeurs, et une fois publié avec des réponses les questions sont verrouillées pour garantir la cohérence du référentiel historique ; **bibliothèque de compétences marketing** — sept catégories de compétences (contenu / réseaux sociaux / e-mail / SEO / publicité / recherche / vente) et un contexte de marque, il suffit de remplir les paramètres pour exécuter, en l'absence de clé de modèle la sortie est à base de règles, les résultats se déposent en actifs de contenu, avec en outre connexion / appel des capacités de canal, évaluation d'exécution et tâches planifiées. |
| **Gestion des actifs numériques** | Entièrement synchronisé avec les actifs numériques AIPDD : recherche par fichier / image / vidéo / audio, étiquetage, envoi direct (l'envoi enregistre sur la plateforme, aucune copie locale) ; les cartes d'actifs tiennent toujours 4 par ligne, sans pavage extensible selon le nombre. Un onglet « Ressources partagées » permet de partager les actifs de ce compte avec d'autres comptes de la **même organisation** — entreprise certifiée : partage entre membres de l'entreprise ; fournisseur : partage entre le responsable et les employés en poste (reconnaissant à la fois les rattachements `org_staff` et `provider_staff`) ; le partage ne prend que les actifs du registre de ce compte, l'utilisateur cible doit figurer dans la liste de l'organisation, sélection multiple / totale et retrait à tout moment ; le partage n'enregistre qu'une relation d'appartenance, le fichier restant à l'uploadeur. |
| **Service e-mail IA** | Ajouter plusieurs boîtes (POP3 / IMAP) par compte connecté, lecture en temps réel de la boîte de réception et des brouillons, **corps et pièces jointes jamais persistés en base** ; configurables par scénario, le mode de réponse étant « brouillon seul » ou « brouillon et réponse automatique » ; les tâches planifiées de l'Agent préparent les réponses via l'outil e-mail selon le scénario ; la liste affiche les envois / brouillons du jour et le volume traité du mois. Autre onglet **modèles d'e-mail** : variables de modèle, aperçu en bac à sable, envoi d'un e-mail de test à une adresse donnée. |
| **CRM** | Gestion de la relation client au niveau du compte : pistes, clients, opportunités, contrats de vente, encaissements, commandes, approbations et rapports, avec historique de suivi et assistance IA ; membres et permissions réutilisent « Employés et agents » du compte. L'onglet **suivi des devis** génère des PDF modélisés (classique / moderne / minimaliste) à partir des devis de vente, le lien public portant l'historique de consultation et d'envoi. Une fois l'approbation de commande validée, création de projet idempotente selon « même organisation + même commande », le budget reprenant le montant de la commande et le chef de projet étant synchronisé, la fiche de commande affichant « projet créé automatiquement #id » ; la conversion piste→client réécrit le contact SCRM WeCom, et une session de service client IA peut être convertie en un clic en piste CRM. La fiche 360 du client comporte aussi un onglet « WeCom » : recherche du contact WeCom, de l'employé responsable, des étiquettes et de la dernière interaction par client. |
| **Analyse intelligente BI** | BI au niveau du compte : jeux de données CRM curés intégrés + sources externes PostgreSQL / MySQL en lecture seule ; prise en charge des questions-données intelligentes, des graphiques et des tableaux de bord. |
| **OA** | Demandes sur formulaire et approbation multi-niveaux selon l'organisation : congés, notes de frais, paiements, achats, apposition du sceau ; les membres viennent de « Employés et agents » et peuvent être liés aux données métier (CRM, etc.), le résultat d'approbation étant réécrit, avec en outre rappels planifiés et choses à faire. La nouvelle demande prend en charge la **rédaction IA en une phrase** : décrire l'objet suffit à faire correspondre automatiquement un modèle et préremplir les champs, à vérifier avant soumission. |
| **Planification OKR** | Selon l'organisation : cycles annuel / trimestriel / mensuel, arbre d'objectifs de l'entreprise à l'individu, plans hebdomadaires / quotidiens, rapports quotidiens et hebdomadaires et évaluation de rétrospective de cycle. L'onglet **décomposition IA** suit « cahier d'objectifs → clarification interactive → trois niveaux de propositions → vérification simulée → confirmation humaine en base » : le cahier enregistre l'objectif métier global et le triangle de fer du projet (périmètre / durée / budget / effectifs / matériel / équipement / services externes), un contrôle préalable est effectué avant décomposition (cycle, membres, livrables, sujets externes) ; l'IA ne produit à chaque tour que des questions structurées et des hypothèses, les responsables, sources d'indicateurs, montants et dates étant validés selon la liste blanche de l'organisation et la saisie utilisateur ; en l'absence de modèle, un plan à base de règles est utilisé avec la mention explicite « règles » ; ce n'est qu'après confirmation que sont créés objectifs, KR, tâches, associations de tâches, OKR personnels et projets ; les tâches portent critères d'acceptation, paliers de qualité et poids d'évaluation, avec en outre un aperçu du score calculé par KR / tâche. Chaque objectif ouvre un tiroir « détail » : progression, résultats clés, tâches liées (poids / valeur cible renseignée / critères d'acceptation) et historique de progression (source manuelle / automatique / planifiée / système et valeurs avant-après). |
| **Espace RH** | Cinq onglets de base : dossiers, absences et présence, recrutement, entretiens, offres et bilan, plus la **gestion des rendez-vous** (créneaux d'occupation, lien de réservation public, registre des rendez-vous), l'**intégration** (modèles par rôle → démarrage automatique à l'acceptation de l'offre → clôture par cases à cocher) et la **transcription vocale** (transcription d'entretien / de session, résumé IA, réécriture des scores) ; membres et permissions réutilisent « Employés / agents » de l'organisation, et le côté recrutement partage le même jeu de postes que la place de recrutement du réseautage d'affaires. |
| **Gestion de projet** | Fiche projet, membres et jalons, itérations et dépendances de tâches, flux d'heures et approbation du feuille de temps hebdomadaire ; l'IA produit des suggestions de décomposition WBS et une évaluation de la santé du projet, le résultat n'étant écrit en tâches qu'après confirmation humaine. L'onglet **coûts** calcule automatiquement le coût de main-d'œuvre selon « heures approuvées × taux en vigueur », les matériaux / équipements / services externes étant enregistrés ligne à ligne, l'occupation du budget et les heures à taux non configuré étant visibles en temps réel ; l'onglet **collaboration externe** maintient unifié l'annuaire des fournisseurs / OPC / particuliers / partenaires et les bons de coopération (brouillon → exécution → en attente de réception → règlement / annulation), la réception validée générant automatiquement un poste de coût externe. Les tâches acceptent trois modes de prise en charge : employé interne, reprise de tâche et partenaire externe, avec maintenance des critères d'acceptation, des paliers de qualité et des poids d'évaluation. Une tâche peut être **externalisée en besoin** : publier périmètre / livrables / budget / durée / référentiel d'acceptation vers des sujets externes, adopter après retour du devis et de l'engagement de délai, le système créant alors automatiquement un bon de coopération externe, réaffectant la tâche et intégrant cette coopération à l'acceptation et aux coûts. L'onglet **audit des heures** conserve les valeurs avant-après de chaque modification et agrège par personne, l'onglet **synchronisation des tâches** prend en charge la synchronisation bidirectionnelle Jira / Teambition / TAPD. Projets et tâches portent un tiroir « collaboration » : commentaires / réponses / @ collègues, étiquettes, liens de ressources et favoris, les commentaires étant nettoyés selon une liste blanche avant écriture, les @ limités aux membres en règle de l'organisation et générant une notification interne. La fiche projet comporte aussi deux onglets de synthèse « livraison » et « coûts » : la livraison montre tâches terminées / en cours / en retard et poids d'acceptation, les coûts montrent budget, coûts engagés, taux d'utilisation du budget, coopération externe et heures enregistrées (les actions de maintenance restant dans l'onglet « coûts » de la page projet). |
| **Stocks et ventes** | Produits / variantes / catégories / entrepôts, flux et transferts de stock, approbation des prélèvements, bons d'achat et réception, fournisseurs, créances et dettes et règlements, notes de frais, taux de taxe et stratégie de prix ; l'IA fournit des analyses métier selon quatre axes (stock / achats / créances / trésorerie), avec une sortie à base de règles sans clé de modèle configurée. |
| **Service client IA** | Service client au niveau du compte : un compte peut héberger plusieurs sites officiels, les visiteurs entrant par la fenêtre de service du site (iframe même domaine `/embed/service-desk`) et étant reçus par les employés / agents de l'organisation ; huit onglets : sessions, **tickets après-vente**, équipe de service, réglages de réception, formules et connaissances, sites et intégration, intégration de canaux, statistiques. Les tickets après-vente suivent une machine à états à traiter → examen → validé / réceptionné / expédié → terminé, avec une chronologie d'événements. L'état de réception distingue en ligne / absent / hors ligne, seuls les agents en ligne participant à l'attribution automatique ; l'IA applique selon les réglages un texte fixe, une suggestion de réponse ou une réponse automatique, le mode automatique pouvant à tout moment passer à un humain, et le mode purement IA ne transférant pas. |
| **Centre d'applications** | Entrée fusionnée des applications internes et de la place de marché : la page d'accueil recherche par mot-clé « ce que j'ai construit / ce que l'entreprise a construit / les applications de la place », plus quatre onglets : création d'entreprise, mes créations, mes adhésions, place de marché. Les entités d'application internes se déposent en tableaux multidimensionnels, les membres lisant et écrivant selon les permissions de rôle ; la place de marché est une vitrine en lecture seule d'un annuaire public externe, ce site n'hébergeant pas d'applications et n'assurant ni publication ni évaluation. |
| **Grand hall thématique** | Publier des discussions thématiques internes à l'entreprise ou publiques : en interne, participation des employés de l'organisation et des partenaires signataires / sous-traitants ; en public, ouvert à tous les comptes connectés ; l'initiateur peut clore (l'IA résume tous les propos et réponses), rouvrir la clôture, fermer ou supprimer ; les propos peuvent être signés par soi-même ou par un double numérique. |

### 4. Services métier (11 lignes de service + marché de l'offre et de la demande)

Forme unifiée : **bibliothèque de ressources de fournisseurs** (parcourir la liste → détail → lancer une signature) + **informations de demande / marché de services** + **registre métier**.
Un fournisseur doit d'abord s'enregistrer et être qualifié dans la catégorie correspondante pour que ses ressources soient exposées ; lorsqu'un bloc ne compte qu'un seul fournisseur, la liste n'est pas affichée et son détail est intégré directement.
Le marché de l'offre et de la demande est un marché public transversal, sans contrôle d'enregistrement par bloc ; les deux listes demande / service sont **paginées** (pas de défilement infini),
filtrables par **zone géographique (province / ville) et catégorie secondaire**, avec affichage des colonnes de catégorie (primaire / secondaire) sur la ligne ; au-delà des deux listes, un onglet **évaluations** (répartition des notes, registre des évaluations), les données d'évaluation servant aussi de source au score d'affichage du fournisseur.

Les listes **demande / service** de chaque marché de services et du marché de l'offre et de la demande disposent en outre d'une paire de filtres « **tout (demande / service)** / **publié par moi** » :
« tout » lit directement le pool public de la catégorie correspondante sur AIworkin ; « publié par moi » lit le registre de ce système (l'action de publication est d'abord enregistrée localement,
puis synchronisée vers la plateforme avec rappel de l'ID de contenu de la plateforme). Selon le référentiel utilisateur du 2026-11-09, « publié par moi » **n'est rendu que pour l'identité fournisseur** ;
l'identité entreprise ne fait jamais apparaître ce filtre (seulement « tout »). Un enregistrement officiellement publié sur AIworkin n'est ni modifié ni supprimé dans ce système,
qui ne conserve que « consulter » — les interfaces REST d'écriture de la plateforme (PATCH / DELETE) renvoient toujours 401 avec une clé API, et MCP n'a pas non plus d'outil de modification / suppression.
**Marché de services** (logistique / marketing / international / travail flexible / IT / propriété intellectuelle / juridique / think tank / actifs / approvisionnement / fiscalité) : les clés de menu sont toutes « marché de services ×× »,
le corps étant le même élément : tous les services = pool public de la plateforme, mes services publiés = registre local ; approvisionnement / fiscalité ont été renommés et intégrés depuis
« publication de services » le 2026-11-09 (utilisateur : « s'aligner sur les autres marchés, voir à la fois le pool public et mes publications de services »).
**L'onglet marché de l'approvisionnement s'affiche aussi côté entreprise** (2026-11-09) : le marché est visitable sur tout le site, l'entreprise ne pouvant simplement pas publier de services —
l'entrée « publier un service » n'est pas rendue selon l'identité, le filtre « mes services publiés » n'apparaît pas non plus, et le backend `assertPublishAllowed` intercepte selon le même référentiel.

| Bloc | Contenu |
|---|---|
| Services marketing | Visites de créateurs / vente en direct · canal de messages de demande |
| Réseau d'approvisionnement | Collaboration offre-demande B2B : stations de service, commande de marchandises, réservation de services hors ligne (devis réalisé par le fournisseur ou l'employé qu'il désigne) et marché de services du réseau d'approvisionnement |
| Services fiscaux | Documents de déclaration, plans de déclaration, gestion des jeux comptables, capacités d'automatisation, informations de demande et marché de services fiscaux ; le plan de déclaration est généré automatiquement selon la nature fiscale de l'entreprise signataire (général / petit) et la fréquence de déclaration (mois / trimestre / an) ; une fois la capacité de l'entreprise ouverte, Qixiangyun peut réaliser la déclaration automatique, la facturation automatique et la consultation des factures émises |
| Commerce transfrontalier | Fournisseurs de services transfrontaliers et outils de services à l'international |
| Travail flexible | Bibliothèque de ressources, demandes de main-d'œuvre (y compris l'entrée de main-d'œuvre) et paie flexible (activation au niveau plateforme, active par défaut) |
| Services logistiques | Transport terrestre national / transit transfrontalier · canal de messages de demande |
| Services IT | Mise en œuvre IA / développement logiciel / calcul / matériel / données · canal de messages de demande |
| Propriété intellectuelle | Bibliothèque d'institutions / agents, messages de demande et conseil / défense des droits |
| Services juridiques | Bibliothèque d'avocats / cabinets et messages de demande |
| Services think tank | Bibliothèque d'institutions / experts et messages de demande |
| Transactions d'actifs | Location-vente d'actifs et services d'intermédiation · canal de messages de demande |
| Marché de l'offre et de la demande | Marché public transversal : deux onglets **demande / service**, chacun avec deux filtres « **tout (demande / service)** (pool public de la plateforme AIworkin, lecture par le canal plateforme, consultable même sans clé liée) / **mes services publiés** (registre de ce système, rendu uniquement pour l'identité fournisseur) » ; la publication est d'abord enregistrée dans le registre local puis synchronisée vers la plateforme avec rappel de l'ID de contenu, les enregistrements publiés vers la plateforme n'étant que consultables dans ce système (les écritures REST et MCP de la plateforme ne permettent ni modification ni suppression) ; les deux listes sont paginées (pas de défilement infini) et filtrables par zone géographique et catégorie secondaire ; tous les comptes connectés peuvent publier, le contenu publié étant soumis au contrôle automatique de publication |

- **Signature** : l'entreprise initie → le fournisseur confirme → entrée dans le registre des signatures ; l'administrateur de plateforme peut résilier une signature en vigueur dans « supervision des signatures ».
- **Forfaits de services officiels** : la rubrique fournisseurs de chaque bloc affiche les forfaits officiels de la plateforme (prix de référence en RMB + prix en points converti selon le taux défini en administration), achat direct en points par l'entreprise ; après achat, la plateforme pilote la signature et la livraison point par point entre l'entreprise et plusieurs fournisseurs de qualité, le référentiel du forfait étant « ce forfait est livré par la plateforme en intégrant des fournisseurs de qualité », toute signature ne prenant effet qu'après confirmation du fournisseur (un fournisseur prédéfini ne fait qu'initier automatiquement, sans confirmer automatiquement), la progression de livraison lisant en temps réel l'état de signature. L'administration « forfaits de services » maintient le catalogue et la file de livraison (mise en correspondance, initiation pilotée, changement de sujet, remboursement partiel / total), le quota d'achat étant compté par entreprise, les forfaits ne participant pas à la gestion du cycle de livraison et d'expiration ; le côté utilisateur « mes forfaits » montre les forfaits achetés et la progression de livraison point par point.
- **Activation de capacités** : déclaration fiscale électronique / facturation électronique sont des capacités payantes, configurées par le fournisseur pour l'entreprise servie, l'entreprise soumettant la demande d'activation et la plateforme l'examinant ;
  l'activation / désactivation au niveau de l'entreprise et la mise en correspondance des comptes Qixiangyun sont unifiées dans l'administration « gestion fiscale ».
- **Tableaux de bord métier** : les listes **informations de demande** des blocs fiscalité / approvisionnement / international lisent toutes le registre de ce système (`market_listing_records`),
  et non plus directement le pool public de la plateforme ; l'action de publication est synchronisée vers la plateforme AIworkin via le canal MCP unifié, et le numéro d'ordre de la plateforme (ID de contenu)
  est rappelé dans le registre local, les enregistrements officiellement publiés vers la plateforme n'étant que consultables dans ce système. Les **rubriques de services** de ces blocs sont unifiées depuis
  le 2026-11-09 en « **marché de services ××** », lisant le registre de services de ce système (`provider_service_listings`) avec bascule possible entre
  « tous les services / mes services publiés » (tous = pool public de la plateforme), la publication étant également d'abord enregistrée puis synchronisée vers la plateforme avec rappel du numéro d'ordre.
- **Marché de l'offre et de la demande** : l'entrée de menu est sous « services métier », les interfaces réutilisant `/enterprise/market/:domain/...` avec
  `domain=HUB` pour le transversal : les deux onglets demande / service ont des filtres « tout / publié par moi » — « tout » ne lit que le **pool public** de la plateforme
  (pas d'échec d'authentification du canal même sans clé liée), « publié par moi » ne lit que le registre de ce système (`scope=mine`, rendu uniquement pour l'identité fournisseur) ;
  les deux prennent en charge le filtrage par zone géographique (province / ville) et catégorie secondaire (catégorie sélectionnable dans n'importe quel bloc métier, catégorie primaire affichée sur la ligne) ;
  la liste est affichée par page, la page suivante n'étant chargée qu'au changement de page, sans long défilement empilé à droite ;
  la publication écrit directement sur la plateforme avec la clé API AIPDD liée au compte courant tout en tenant un registre local, le contenu publié passant également par le contrôle automatique de sécurité de contenu Alibaba Cloud ;
  un enregistrement publié vers la plateforme ne peut être modifié ni supprimé dans ce système, seul « consulter » reste disponible.

### 5. Réseautage d'affaires (social / recrutement / offre et demande)

- **Réseautage d'affaires** : rencontrer des pairs (amis / blocage), publier des actualités (publiques / réservées aux amis), groupes à la Douban (découvrir / rejoindre, publication par catégorie,
  anonymat ligne à ligne, réponses par étage et recommandations, épinglage et mise en avant par le chef de groupe / l'administrateur et approbation d'adhésion), messagerie privée interne, CV professionnel (page HTML indépendante distincte du profil,
  envoyable en message privé, l'employeur l'ouvrant directement et pouvant l'exporter en PDF). Lorsqu'un compte est banni, les capacités sociales sont automatiquement bloquées.
- **Recrutement** : publier des postes à temps plein / partiel / stage / temporaire / détachement de main-d'œuvre dans le flux de la place de recrutement, la mise en relation se faisant par messagerie interne (CV joignable),
  ce système ne gérant ni base de CV ATS ni filtrage ; une fois une clé AIPDD liée, les postes peuvent être synchronisés en besoins de main-d'œuvre AIworkin (catégorie fixée au sous-arbre « travail flexible »).
- **Place de l'offre et de la demande** : publication générique de besoins / services, dans le flux local, consultable et mis en relation par message privé.
  La **publication en deux étapes** est le référentiel central de ce projet : par défaut publication locale sans clé ; en cochant « synchroniser vers AIworkin »,
  via le résolveur d'identifiants unifié, l'appel amont `POST /market/listings` est effectué avec la clé liée par l'utilisateur, et l'état d'examen / de retrait amont est reflété.

### 6. Réglages de gestion

| Module | Contenu |
|---|---|
| Identité et qualifications | Les informations utilisateur prennent effet dès soumission ; l'enregistrement fournisseur requiert un examen ; l'employé doit être lié ou rattaché |
| Gestion des employés / agents | Vue d'ensemble de l'équipe, approbation des rattachements et employés en poste ; inclut l'annuaire d'IM (Feishu / WeCom) avec synchronisation et rappel |
| Gestion des signatures | Vue d'ensemble des signatures et toutes les signatures (initiées par l'entreprise, confirmées par le fournisseur) |
| Centre de points | Double affichage points et AWcoin, recharge, cadeaux, flux et commandes ; les **codes promotionnels** peuvent déduire selon le montant de la commande ou être convertis en points (l'administrateur de plateforme maintient le réservoir de codes, le côté utilisateur l'échangeant et le créditant) |
| Mes forfaits | Forfaits officiels achetés et progression de livraison point par point : le forfait est livré par la plateforme en intégrant des fournisseurs de qualité, la plateforme pilotant la signature entre l'entreprise et le fournisseur, la progression lisant en temps réel l'état de signature |
| Mes invitations | Code d'invitation dédié, lien d'inscription, relations d'invitation et nombre |

### 7. Console d'administration de plateforme (`/admin`, 26 blocs)

La barre latérale est organisée en 5 grandes catégories ; la vue d'ensemble des données de plateforme est intégrée au cockpit de direction (`/dashboard`), la barre latérale ne conservant plus de bloc de vue d'ensemble distinct :

| Catégorie | Bloc | Description |
|---|---|---|
| Utilisateurs et fournisseurs | Utilisateurs inscrits | Tous les comptes : nom d'utilisateur, pseudo, e-mail, état du compte |
| Utilisateurs et fournisseurs | Utilisateurs entreprise | Utilisateurs ayant validé la certification d'entreprise (entreprise / entreprise individuelle) |
| Utilisateurs et fournisseurs | Enregistrement des fournisseurs | Examen des demandes d'enregistrement, l'approbation donnant automatiquement le rôle de fournisseur |
| Utilisateurs et fournisseurs | Gestion des fournisseurs | Fournisseurs enregistrés et leurs qualifications par type de service, désactivables / réactivables individuellement (la désactivation met les ressources hors ligne et bloque toute nouvelle opération de ce type) |
| Utilisateurs et fournisseurs | Activation des capacités fournisseur | Examen des demandes d'activation payante de l'automatisation fiscale |
| Supervision de l'exploitation | Travail flexible | Activation / désactivation au niveau plateforme du bloc « paie flexible » (activé par défaut) |
| Supervision de l'exploitation | Supervision des signatures | Registre de toutes les signatures, avec possibilité de résilier une signature en vigueur |
| Supervision de l'exploitation | Supervision du réseau d'approvisionnement | Vue d'ensemble plateforme des stations de service, commandes de marchandises et bons de réservation de services |
| Supervision de l'exploitation | Supervision des codes vivants | Liste des codes vivants de toute la plateforme : compte propriétaire, domaine d'entrée, scans cumulés ; retrait en cas d'infraction |
| Supervision de l'exploitation | Communauté créative | Examen et recommandation des workflows de la communauté, la recommandation créditant des points au publieur (règles configurables) |
| Supervision de l'exploitation | Communauté de modèles vidéo | Affichage complémentaire ou non des modèles de la plateforme AIworkin (synchronisation manuelle / planifiée, synchronisation immédiate et dernier résultat) |
| Supervision de l'exploitation | Gestion fiscale | Pool de comptes de clé API de déclaration Qixiangyun et mise en correspondance des numéros fiscaux, examen des demandes d'activation payante |
| Supervision de l'exploitation | Réglages de gestion GEO | Volume hebdomadaire des tâches de collecte GEO automatique (planifié / réel, détail par projet) |
| Facturation et produits | Points et recharge | Taux et paliers, récompenses d'inscription / d'invitation, plafonds de cadeau et contrôle des risques, tarifs et usage par module (prix préconfigurés pour AI insight / HRM / base de connaissances / marketing / recrutement / contrôle de compétences), ajustements de compte et commandes de recharge |
| Facturation et produits | Forfaits de services | Catalogue des forfaits officiels (mise en vente au niveau du bloc, prix RMB + prix en points selon le taux, éléments de livraison et choix « fournisseur prédéfini / attribution manuelle » ; le prédéfini n'initie qu'automatiquement et nécessite toujours la confirmation du fournisseur ; quota d'achat par entreprise) et gestion de la livraison : file d'achat, mise en correspondance point par point, initiation pilotée de la signature par la plateforme, changement de sujet, remboursement partiel / total |
| Facturation et produits | Place de marché des modèles | Catalogue de modèles et canaux amont : mise en vente par extraction depuis le baseURL du canal, tarification (unité / par palier / prix de cache / remise), registre d'usage et passerelle compatible OpenAI |
| Facturation et produits | Quotas de droits | Catalogue de droits et quotas de forfait : configuration par clé de fonction du total / cycle (jour / mois / an) et de la stratégie de dépassement, autorisation point par point par sujet entreprise ou fournisseur, usage consultable |
| Capacités et sécurité | Gouvernance des fonctions | Interrupteurs du catalogue de fonctions, liste noire de sortie réseau de l'Agent et plafond dur de la sandbox, registre d'examen des compétences / plugins et libération manuelle, barrière IA (barrière globale plateforme + couverture d'organisation + limitation par minute utilisateur×organisation) |
| Capacités et sécurité | Générer un Skill | Cocher les domaines métier MCP et les actions de ce système, appeler le modèle pour générer un paquet de compétence zip avec un `SKILL.md` à la racine ; après téléchargement, publication possible sur SkillHub pour gagner en visibilité, le catalogue croissant automatiquement avec les interfaces MCP |
| Capacités et sécurité | Contrôle de publication | Configurer l'AccessKey de sécurité de contenu Alibaba Cloud (stockage chiffré, retour masqué) et la région d'intégration ; publier une demande et publier un service sont des scénarios obligatoires, publication communautaire et publication de CV étant optionnelles. Une fois activé, les quatre actions de publication sont soumises à examen avant enregistrement, un block / review entraînant un refus direct et une écriture au registre d'examen ; un délai ou une panne amont dégrade en laissez-passer avec journalisation ERROR, sans bloquer la publication normale |
| Capacités et sécurité | Traçage d'usage | Registre des événements de page et d'action : volumes d'événements agrégés par jour, nombre de sujets indépendants et Top événements, pour l'analyse du taux d'usage et de la rétention |
| Capacités et sécurité | Matériel intelligent | Catalogue de modèles matériels, versions des kits (téléchargement de SDK / firmware) et maintenance des outils API / MCP par défaut des modèles ; les appareils connectés par l'utilisateur et les outils auto-construits sont dans la rubrique « matériel intelligent » côté utilisateur |
| Système et contenu | Versions des conditions | Gestion multi-versions des conditions de service / politique de confidentialité : corps enrichi, date d'effet, réacceptation obligatoire ou non ; l'enregistrement d'acceptation par l'utilisateur note version, date et IP |
| Système et contenu | Journal des mises à jour | Changelog au niveau produit : entrées ajout / optimisation / correction par version, publiées dans l'onglet « journal des mises à jour » de `/help` |
| Système et contenu | Mise à niveau de la plateforme | Récupération depuis GitHub Release ou envoi manuel d'un paquet de mise à niveau vers `update/`, l'Agent de plateforme comparant la version courante et le paquet et donnant risques et recommandations d'exécution ; après confirmation, sauvegarde forcée de la base, sauvegarde par défaut du code également et retour arrière automatique, un exécuteur indépendant réalisant en mode maintenance le déploiement / la construction / la migration / le redémarrage ; le registre de sauvegardes permet une restauration en un clic « base complète + code » ou « base uniquement » |
| Système et contenu | Paramètres système | Stockage de fichiers (OSS) et registre de capacité (occupation, tarification, migration par lots des actifs historiques), clé de plateforme AIPDD, paramètres de niveau plateforme, paramètres du site et de la page d'accueil (bascule par onglet, effet immédiat à l'enregistrement ; les paramètres de page d'accueil maintiennent textes, images et affichage des blocs de la page d'atterrissage du site officiel) |

### 8. Services de modèle

- **Gestion des clés API** : deux jeux de clés gérés séparément — la clé `ek_` de ce système sert à appeler les interfaces ouvertes (`/api/v1`) et la place de marché des modèles, création / copie / réinitialisation / révocation sur cette page,
  chaque clé pouvant recevoir un « quota de points » individuel (plafond de consommation cumulée des appels externes, refus au-delà, ou quota illimité) ;
  la clé API AIPDD (`sk-`) se lie sur la même page et ouvre les capacités amont de publication synchronisée, de synchronisation des données fournisseur et de ressources de mise en relation. Les clés sont stockées chiffrées, copiables à tout moment sur cette page par le seul titulaire, invisibles aux autres.
- **Place de marché des modèles** (`/model-plaza`) : catalogue unifié des modèles disponibles mis en vente par la plateforme — l'unité de facturation est alignée sur l'amont (dialogue / vecteur au Token, image à l'unité, vidéo et reconnaissance vocale à la seconde, synthèse vocale à l'appel),
  essai en ligne possible, registre d'usage consultable, et passerelle compatible OpenAI via la clé `ek_` ; catalogue, canaux amont et tarification sont maintenus dans l'administration « facturation et produits → place de marché des modèles ».
  L'administration comporte aussi un onglet « modèle par défaut » : désigner séparément le modèle par défaut de la plateforme pour texte / vision / image / vidéo / reconnaissance vocale / synthèse vocale / vecteur, configurer les limites de points par appel, par jour et par mois avec historique des changements ;
  les utilisateurs ayant effectué une recharge réelle créditée héritent automatiquement des capacités non configurées individuellement (seules les commandes de recharge payées comptent, cadeaux et ajustements exclus), l'appel étant facturé sur leurs propres points au prix catalogue.
- **API-MCP-Skill** (`/developer/api-mcp-skill`) : l'entrée unifiée des services de modèle, trois onglets dans cet ordre —
  **Skill** : liste des paquets de compétence générés par l'administrateur de plateforme par domaine métier (nom, description, domaine, nombre d'actions couvertes, modèle de génération, date de mise à jour), cliquer « télécharger » récupère le zip ;
  le paquet ne contient que la notice d'appel et des exemples, sans clé réelle, une régénération du même nom écrase l'ancien paquet, liste et téléchargement relevant du même interrupteur de menu.
  **MCP Server** : Codex, Claude Desktop, Cursor, les scripts maison et Workbuddy se connectent avec une même clé API ;
  le serveur analyse d'abord la mémoire d'agent de ce compte, puis exécute automatiquement selon l'autorisation les actions de ce site. La liste des interfaces dérive de la couche contrat, les nouveaux modules (ERP stocks et ventes, atelier SEO, acquisition IA, SCRM WeCom, tâches de projet, HRM, etc.) entrant automatiquement dans `list_operations` dès leur contrat ;
  les actions touchant directement les comptes (conclusions d'approbation, encaissements et décaissements, flux de stock — y compris approbations ERP de stock / achats / réception / notes de frais, règlement des créances et dettes, flux d'entrée-sortie) figurent sur une liste d'exclusion permanente et ne peuvent être confirmées que par le titulaire dans l'interface.
  **API** : la liste effective des interfaces exposées par ce système, dérivée de la couche contrat, de même source que `list_operations` du serveur MCP et la documentation OpenAPI.
  Les anciennes adresses `/developer/docs` et `/developer/mcp` conservent une redirection, respectivement vers `?view=api` et `?view=mcp`.
- **Réglages du modèle** : configuration partagée par l'Agent et la création de contenu — un canal intégré AIPDD utilise directement une clé sk-, mais on peut aussi brancher une autre passerelle compatible OpenAI et Volcano MediaKit, en choisissant un modèle par défaut par type ;
  le haut de page affiche l'état en vigueur du « modèle par défaut de la plateforme » (héritage selon l'éligibilité de recharge si rien n'est configuré individuellement) et le quota consommé du jour / du mois.
  L'administrateur de plateforme peut, dans « place de marché des modèles → canaux utilisateur », définir la portée de prise en charge de chaque canal de calcul (tous pris en charge par défaut) : un canal désactivé ne peut être ni ajouté ni modifié par l'utilisateur, qui ne peut pas non plus le sélectionner ;
  désactiver AIPDD n'arrête que son calcul (réglages du modèle / place de marché des modèles), les autres fonctions (services métier, etc.) restant pleinement disponibles avec la même clé API AIPDD.
- **Mécanismes de plateforme** : entrée unifiée des capacités transverses §5.8 — Outbox d'événements et abonnement Webhook (test, historique de livraison, renvoi des échecs ; le répertoire d'événements couvre les nœuds métier tâche, projet, piste / commande / encaissement CRM, besoin externalisé, coopération externe, etc.), import CSV (mappage de champs, simulation, réutilisation du schéma de mappage) et export par module (le fichier exporté ne fournit plus de lien public permanent, mais est restitué par un point de terminaison authentifié selon l'organisation courante), répertoire de rapports, moteur de règles (correspondance de conditions + appel Webhook / notification / insight / création de tâche), partage public (mot de passe, validité, désactivation ; chaque ouverture revérifie la qualité en règle du créateur, l'initiateur perdant la validité en cas de départ ou d'exclusion de l'organisation), source d'identité OIDC (test de découverte, création automatique de compte), stratégie de partage de pièces jointes, synchronisation du répertoire, des présences et des messages à carte de Feishu / WeCom, ainsi que la traçabilité d'acceptation des conditions (bandeau sur tout le site en cas de non-acceptation d'une nouvelle version), le traçage d'usage produit (événements de page / d'action et tableau de bord agrégé) et le sélecteur de sujet (bascule du périmètre HRM du même individu entre entreprise / fournisseur), le copilote sensible à la page (entrée flottante sur tout le site). Les onglets métier du site sont unifiés en capsules multi-lignes (`PanelTabs` / `TabStrip`), sans plus mélanger les Tabs antd.
- **Centre d'aide** : la base de connaissances chapitrée de `/help` est versionnée avec le code (fichiers de connaissance dans `backend/src/help`), couvrant l'usage de chaque module ; la même page propose un onglet « journal des mises à jour » affichant le changelog produit ; le corps de connaissance est exposé en trois actions MCP en lecture seule `Help_chapters / Help_topic / Help_search`, un utilisateur demandant directement à l'Agent pouvant aussi obtenir l'usage officiel.
- **Instantané OpenAPI** : `/api/openapi.json` (1947 opérations), vérifié par la CI comme conforme à l'instantané du dépôt.

### 9. Matériel intelligent

Bloc **matériel intelligent** indépendant dans la barre latérale (groupe de premier niveau, après les réglages de gestion) : l'utilisateur parcourt le matériel et les kits de développement, connecte ses appareils à la plateforme, et appelle selon le type de matériel des outils MCP **dédiés** (contrôle par Agent) et des API (contrôle programmatique) ; l'administrateur de plateforme maintient le catalogue de modèles, les versions des kits et les outils par défaut des modèles.

- **Place du matériel** (`/hardware`) : catalogue de modèles affiché par recommandation / tri, chaque modèle donnant spécifications, version du kit (canal stable / aperçu) et téléchargement ; le binaire du kit est envoyé directement sur l'OSS de ce site, le téléchargement étant comptabilisé et la page fournissant un SHA-256 à vérifier ; entrer dans le détail du modèle permet de voir la liste des outils API / MCP par défaut de ce modèle.
- **Ajouter du matériel** (`/hardware/devices`) : choisir un modèle pour connecter un appareil, générer un jeton d'appareil préfixé `hw_` (la valeur en clair n'est affichée qu'une fois à la génération, la base ne stockant que le SHA-256) ; après avoir renseigné l'adresse de service et le jeton selon le SDK / firmware du kit, l'appareil remonte en ligne par battement de cœur, la liste affichant trois états en ligne / hors ligne / jamais remonté (bascule en hors ligne après 180 secondes sans battement), avec consultation par appareil des flux de battement / commande / accusé de réception pour le diagnostic.
- **MCP matériel** (`/hardware/mcp`) : serveur MCP matériel indépendant `aiworkin-hardware-mcp` (point de terminaison `/api/v1/hardware/mcp`), totalement séparé du MCP de plateforme — les outils ne viennent que de la table d'outils matériels, nommés `hw__<code modèle>__<code outil>`, authentifiés par la clé `ek_` de « développeur → clé API ». Les outils d'écriture passent par une triple barrière d'autorisation : non cochés « exécutable automatiquement » sur cette page, issus d'une tâche planifiée sans intervention, ou appelant déclarant dryRun — tous ne renvoient qu'un brouillon sans envoi réel ; l'« essai » du titulaire n'est pas soumis à cette limite.
- **API matériel** (`/hardware/api`) : les mêmes outils passent par le canal machine `/api/v1/hardware/**` avec la clé `ek_`, listables et appelables en `curl` ; les paramètres et réponses des outils se réfèrent aux exemples JSON donnés sur la page.
- **Kit de développement (Dev Kit)** : le répertoire racine `hardware-devkit/` fournit un SDK et des exemples directement compilables — composant ESP-IDF pour ESP32, paquets Python à bibliothèque standard pure pour Jetson / Raspberry Pi, deux exemples exécutables, plus un appareil simulé Node sans dépendance (permettant de dérouler toute la boucle « battement → récupération de commande → accusé » sans matériel) et une documentation de protocole champ par champ ; les firmwares précompilés seront ajoutés après une première compilation sur matériel réel.
- **Maintenance en administration** : le bloc « matériel intelligent » de l'administrateur de plateforme comporte trois onglets « modèles de matériel / kits de développement / outils par défaut » — maintenance du catalogue de modèles, envoi des kits de chaque version, maintenance des outils API / MCP par défaut par modèle, la modification étant immédiatement visible côté utilisateur. Les outils auto-construits par l'utilisateur ne sont visibles et utilisables que par lui, n'entrent pas dans les outils par défaut des modèles et ne sont pas, dans la première version, mis en vente sur le marché.

Le canal d'appareil (`/api/public/hardware/heartbeat`, `/commands`, `/result`) n'accepte que le jeton d'appareil, sans connexion, et **échappe délibérément à l'interception par l'interrupteur de fonction** : lorsque l'administrateur désactive le bloc « matériel intelligent », le battement des appareils déjà connectés n'est pas coupé.

### 10. Points et facturation

- **Points** : recharge WeChat, cadeaux entre comptes, tarifs et déduction d'usage par module (stockage des actifs numériques, CRM / BI / OA / service client IA), flux et commandes de recharge consultables sur un seul écran ; des tarifs sont préconfigurés pour les postes AI insight / HRM / base de connaissances / marketing / recrutement / contrôle de compétences, prenant effet à la mise en ligne du module correspondant.
- **Base de stockage** : pièces jointes et actifs numériques sont envoyés directement vers l'OSS Alibaba Cloud de ce site (plus de transit amont) ; la page des actifs permet la suppression ligne à ligne, l'administration « paramètres système → stockage de fichiers » affichant la capacité, la tarification et la migration par lots des actifs historiques (interruptible et reprenable, réessayable en cas d'échec).
- **AWcoin** : affichage en lecture seule du solde et de l'origine, **jamais convertible**.
- **Configuration en administration** : taux et paliers de recharge, récompenses d'inscription / d'invitation, plafonds de cadeau et contrôle des risques, tarifs par module, ajustements de compte et consultation des commandes.

### 11. Multilingue, site et notifications

- **8 langues d'interface** : chinois simplifié · English · Tiếng Việt · 日本語 · العربية · Français · Español · Русский ;
  l'administrateur peut définir la langue par défaut du site, le visiteur la changeant à tout moment, l'arabe étant en RTL sur tout le site.
- **Priorité à trois niveaux du domaine du site** : administration « paramètres du site → domaine du site » > `SITE_URL` > adresse courante du visiteur ;
  les adresses absolues des points de terminaison MCP / API, des rappels IM, du script d'intégration du service client, de l'entrée des codes vivants et des liens d'invitation sont composées selon cette priorité (voir ci-dessous « domaine du site »).
- **Affichage des menus** : chaque menu de la barre latérale frontale (entrée du cockpit + chaque groupe, y compris le lien externe « plateforme de calcul AIPDD ») peut être masqué individuellement dans l'administration « paramètres du site → affichage des menus côté utilisateur » ; un groupe dont tous les menus sont masqués disparaît automatiquement (masquage du menu seulement, le lien restant accessible).
- **Affichage des onglets de bloc** : les onglets « informations de demande » et « marché de services » des 12 pages de bloc « services métier » (marketing / approvisionnement / fiscalité / international / travail flexible / logistique / IT / propriété intellectuelle / juridique / think tank / transactions d'actifs / marché de l'offre et de la demande) peuvent être masqués par bloc dans l'administration « paramètres du site → onglets des blocs de services métier (cocher pour masquer) » ; même référentiel que l'affichage des menus — masquage cohérent pour toutes les identités (administrateur inclus), contrôle d'affichage uniquement (liens directs et interfaces non limités).
- **Entrée de l'extension de navigateur en haut** : l'icône unifiée de la barre supérieure, aux côtés des notifications et du compte de service WeChat, est l'unique entrée de téléchargement et d'installation du client de niveau plateforme (AIPDD Enterprise) — partagée par la diffusion marketing, l'acquisition IA, l'agent de navigation (Chrome local) et les futurs flux de pages produit / SEO, au lieu de fenêtres « installer l'extension » propres à chaque fonction. Le tiroir comporte quatre onglets : téléchargement et installation (version courante, version minimale compatible, navigateurs pris en charge, paquet d'installation, étapes), guide d'utilisation (entrées de chaque capacité métier et FAQ), journal des mises à jour, sites autorisés (consulter / révoquer les sites auxquels l'extension est fiée). L'ouverture déclenche automatiquement une détection par poignée de main (pas de bouton de rafraîchissement manuel) : si elle n'est pas installée, un guide étape par étape est fourni ; si la version est trop ancienne, l'icône porte un point d'alerte et invite à la mise à jour ; lorsque la détection est limitée par le navigateur, on peut confirmer manuellement « je l'ai installée », mais une poignée de main réelle est toujours vérifiée avant toute exécution métier. Si la plateforme n'a publié aucun paquet d'extension, ou si l'administrateur a désactivé « paramètres du site → entrée d'extension de navigateur en haut », toute l'icône n'est pas rendue ; l'adresse du paquet est composée selon la configuration du domaine du site, sans jamais coder en dur un domaine client.
- **Messages système** : six catégories d'événements remontées de façon centralisée — service client, demandes et opportunités, identité et signature, fiscalité et déclaration, automatisation et intégration, compte et plateforme.

---

## 🧱 Stack technique et architecture

- **Backend** : [Hono 4](https://hono.dev) + `@hono/zod-openapi`, Prisma 5.22, MySQL 8 / PostgreSQL, Zod 4, Node.js ≥ 24
- **Frontend** : Next.js 16 (App Router) + React 19 + Ant Design 6 / Pro Components + `@tanstack/react-query` 5
- **Couche contrat** : `packages/contracts` est la source unique de vérité du front/back, de MCP et d'OpenAPI (1947 opérations, codes d'erreur, catalogue MCP)
- **Authentification** : trois canaux séparés — session SSO auto-signée du site (clé dérivée par HKDF + vérification de version du compte) + clé `ek_` des interfaces ouvertes + clé `sk-` AIPDD amont
- **Permission des données** : toutes les données sont rattachées à la clé d'organisation `(orgType, orgUserId)` ; liste / détail / export / pièce jointe / IA / tâche planifiée revérifient uniformément avant usage « compte en règle + organisation en règle » (`HrmScopeService.isStanding`), la prise d'effet étant immédiate au départ ou au changement de rôle, sans dépendre d'un nettoyage asynchrone ou du cache ; les permissions de lignes et de colonnes BI entrent dans le même référentiel pour la requête réelle, l'aperçu, les graphiques et les questions IA (filtrage de ligne par les espaces réservés `${userId}` / `${deptId}`, les colonnes masquées par la permission de colonne étant retirées des résultats et avant tout envoi au modèle) ; le contexte d'organisation passe uniquement par le service unifié de résolution de locataire (`TenantScopeService.preferred`), CRM / BI / OA et HRM / OKR partageant le même référentiel de « sujet courant » — la sélection du sélecteur de sujet en haut est prioritaire tant que la relation reste valide, et après bascule la portée des données est cohérente entre les modules

```
Navigateur ── Next.js（SSR/CSR, reverse proxy same-origin /api/backend/*）
             │
             ├── API Hono（/api/backend métier, /api/v1 interfaces ouvertes et MCP, /api/public points publics）
             │        ├── Compte / identité / session   ├── Espace de travail（CRM·BI·OA·OKR·RPA·tableaux…）
             │        ├── 11 lignes de services métier   ├── Social / recrutement / offre et demande
             │        ├── Base points et stockage OSS     └── Console de plateforme
             │        └── Canaux amont（AIPDD / AIworkin, clé utilisateur ou clé plateforme）
             └── Prisma ── MySQL 8 / PostgreSQL（514 modèles, 52 migrations）
```

## 📁 Structure des répertoires

```
oem-enterprise/
├── backend/                 # API Hono
│   ├── prisma/              # schema.prisma（514 modèles）+ migrations/（52）+ seed
│   └── src/                 # 91 modules métier
│       ├── http/ account/ identity/ auth/    # assemblage（routes.ts est la racine de composition, les routes étant réparties par domaine dans route-groups/）、compte、identité、session
│       ├── aiworkin/ content/ agent-memory/  # canaux amont、Agent、création de contenu et actifs numériques
│       ├── ecom-pdp/ domestic-pdp/           # packs d'images d'optimisation de page produit transfrontalier / national
│       ├── crm/ bi/ oa/ okr/ data-table/ rpa/ workbuddy/ livecode/ lowcode/
│       ├── social/ sns/ supply/ marketing/ logistics/ tax/ flex/ overseas/
│       ├── legal/ ip/ think-tank/ asset/ smart-service/                       # lignes de services métier
│       ├── points/ oss/ asset/               # facturation par points et stockage
│       ├── mcp/ openapi/                     # interfaces ouvertes et serveur MCP
│       ├── hardware/                         # matériel intelligent（modèles / kits / appareils / outils / MCP matériel indépendant）
│       ├── admin/ platform/                  # console de plateforme et paramètres du site
│       └── common/ shared/                   # adaptation de dialecte、codes d'erreur、authentification、identifiants amont
├── frontend/                # application Next.js（73 routes de page, /social /admin, etc.）
├── packages/contracts/      # contrats partagés front/back、codes d'erreur、catalogue MCP
├── hardware-devkit/         # sources du kit de développement matériel（composant ESP-IDF / SDK Python / exemples / simulateur / documentation de protocole）
├── scripts/                 # scripts d'installation、migration、vérification et de fumée
├── infra/                   # nginx / exemples de déploiement
└── docs/                    # conception globale、instantané OpenAPI、baseline de routes、captures d'écran et ressources QR
```

L'assemblage HTTP du backend se fait en deux couches : `http/routes.ts` n'est que la racine de composition (appelant 27 fonctions d'enregistrement par domaine), les routes concrètes étant réparties
par module dans `http/route-groups/` (crm, okr, project, erp, hrm, oa, kb, data-table, marketing, scrm, admin…) ;
les trois grands services OKR, mécanismes de plateforme et projet sont eux aussi découpés par domaine en fichiers + façade mince, `okr.service.ts` / `mechanism.service.ts` /
`project.service.ts` ne conservant que le renvoi des méthodes publiques, l'implémentation métier se trouvant dans les `*.base.ts` du même répertoire et dans les services spécialisés.

---

## 🚀 Démarrage rapide (développement local)

Prérequis : Node ≥ 24, pnpm ≥ 10, une instance **MySQL 8 ou PostgreSQL** accessible (au choix).

### Option A : installation en une commande (recommandé, base au choix)

```bash
pnpm install
pnpm setup            # interactif : choisir MySQL / PostgreSQL → saisir la connexion → écrire backend/.env → générer le client → créer les tables
# ou non interactif : pnpm setup --db postgres --host 127.0.0.1 --port 5432 --user app --password *** --database enterprise --yes
pnpm dev:api & pnpm dev:web
```

`pnpm setup` effectue : ① écrire `DATABASE_URL` et `DB_PROVIDER` dans `backend/.env` ; ② MySQL via l'historique de migration `prisma migrate deploy`, PostgreSQL en dérivant `schema.postgres.prisma` depuis `schema.prisma` puis `prisma db push` ; ③ générer le client Prisma selon le dialecte choisi.

> Le client Prisma et les instructions de création de tables sont générés par dialecte : après un changement de base, réexécuter `pnpm setup` (ou `pnpm --filter aiworkin-enterprise-api prisma:generate:pg`).

### Option B : configuration manuelle

```bash
# 1) installer les dépendances (déclenche prisma generate)
pnpm install

# 2) configurer les variables d'environnement du backend
cp backend/.env.example backend/.env
#   éditer backend/.env : renseigner DATABASE_URL (MySQL ou PostgreSQL), DB_PROVIDER, JWT_SECRET, EXTERNAL_CRED_KEY
#   (JWT_SECRET / EXTERNAL_CRED_KEY sont des chaînes aléatoires locales ; en leur absence le backend refuse de démarrer)

# 3) configurer les variables d'environnement du frontend
cp frontend/.env.example frontend/.env.local

# 4) initialiser la base (migration/db push + génération du client)
#   MySQL :
pnpm --filter aiworkin-enterprise-api prisma:migrate:deploy
pnpm --filter aiworkin-enterprise-api prisma:generate
#   PostgreSQL (schéma dérivé) :
pnpm --filter aiworkin-enterprise-api db:push:pg

# 4b) (facultatif) injecter les données de démonstration : profils d'entreprise / annuaire de fournisseurs / avocats·PI·travail flexible / approvisionnement et marketing, etc.
#     uniquement pour l'affichage annuaire et détail ; les identités de démonstration ne sont pas des comptes connectables, après connexion utilisez le compte local créé à l'étape 5.
pnpm --filter aiworkin-enterprise-api prisma:seed

# 5) lancer le backend (1690 par défaut) et le frontend (15890 par défaut)
pnpm dev:api
pnpm dev:web
```

Ouvrez `http://127.0.0.1:15890` dans le navigateur et inscrivez un compte local pour entrer dans le social et la place de l'offre et de la demande.
Le frontend proxy `/api/backend/*` vers le backend via le serveur Next.js, en conservant la même origine côté navigateur.

### Créer l'administrateur de plateforme (obligatoire au premier déploiement)

L'administrateur de plateforme **n'est pas** créé automatiquement à l'installation / au démarrage ; il faut l' créer explicitement avec `backend/scripts/seed-admin.ts` (idempotent, `--reset` réinitialise le mot de passe) :

```bash
# 1) définir ADMIN_USERNAME / ADMIN_PASSWORD dans backend/.env
# 2) exécuter (première création ; un compte du même nom est ignoré)
pnpm --filter aiworkin-enterprise-api exec tsx scripts/seed-admin.ts
```

Après création, connectez-vous avec ce compte, l'entrée de la console de plateforme apparaît dans la barre latérale ; sans création, seul un utilisateur ordinaire peut être inscrit, sans accès à la console de plateforme.

### Variables d'environnement clés

| Variable | Description |
|---|---|
| `DATABASE_URL` | Chaîne de connexion : MySQL `mysql://user:pass@127.0.0.1:3306/enterprise` ou PostgreSQL `postgresql://user:pass@127.0.0.1:5432/enterprise?schema=public` |
| `DB_PROVIDER` | `mysql` / `postgres` : base du branchement dialecte SQL natif (auto-incrément du numéro de document, extraction de colonne JSON) ; déduit du protocole `DATABASE_URL` à défaut |
| `PORT` | Port d'écoute du backend, `1690` par défaut |
| `JWT_SECRET` / `JWT_ISSUER` | Clé de signature de session locale, à remplacer par une valeur aléatoire en production |
| `EXTERNAL_CRED_KEY` | Clé dérivée AES-256-GCM des clés AIPDD / identifiants de déclaration externe, configurée séparément sans repli sur JWT_SECRET |
| `AIPDD_PLATFORM_KEY` | Repli de déploiement de la clé API AIPDD de niveau plateforme (canal de données de base) ; une fois enregistrée dans l'administration « configuration système → clé de plateforme AIPDD », le chiffré en base fait foi |
| `AIWORKIN_BASE_URL` / `AIWORKIN_ENABLED` | Adresse du marché amont et interrupteur (une fois désactivé, seule la boucle locale est disponible) |
| `CORS_ORIGIN_PATTERNS` | Origines cross-domain autorisées (séparées par des virgules) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Identifiants lus par le script `seed-admin` pour créer l'administrateur de plateforme (création non automatique au démarrage) |

> Toutes les clés ne sont stockées que dans le `.env` local (déjà dans `.gitignore`), aucune interface ne renvoyant jamais la valeur en clair d'une clé AIPDD.

### Compatibilité des bases (MySQL / PostgreSQL)

Le choix se fait à l'installation, la période d'exécution se basant sur `DB_PROVIDER` (déduit du protocole `DATABASE_URL` à défaut), le métier étant équivalent sur les deux bases. Pour aplanir les différences de dialecte, les traitements suivants ont été appliqués :

- **Source unique de vérité du schéma** : `prisma/schema.prisma` (MySQL) fait foi ; à l'installation de PostgreSQL, `scripts/gen-prisma-schema.mjs` dérive de façon déterministe `schema.postgres.prisma` (`provider=postgresql`, `@db.TinyInt→@db.SmallInt`, `@db.DateTime→@db.Timestamp`). MySQL utilise l'historique de migration, PostgreSQL `prisma db push`.
- **Auto-incrément du numéro de document** : `document-number.ts` branche par dialecte — MySQL avec `INSERT IGNORE`+`LAST_INSERT_ID`, PostgreSQL avec `ON CONFLICT DO NOTHING`+`UPDATE … RETURNING`.
- **Extraction de colonne JSON** : `jsonText()` de `common/sql-json.ts` génère le chemin `->>` par dialecte (PostgreSQL `col->>'key'` / MySQL `col->>'$.key'`), utilisé par la requête de déduplication inter-tâches du big data et de l'extraction de pistes.
- **Questions / graphiques BI** : `internalScope()` de `bi/bi.internal.ts` émet les espaces réservés par dialecte (PostgreSQL `$1`/`ANY($2::text[])` / MySQL `?`) ; la citation des identifiants de graphique de `bi.query.service.ts` est choisie selon la base cible (guillemets doubles PG / backticks MySQL pour la base applicative ou la source externe).
- **Génération du client** : `postinstall` passe par `scripts/prisma-generate-auto.mjs`, générant selon `DB_PROVIDER`/`DATABASE_URL` avec le schéma par défaut ou dérivé, pour éviter qu'une réinstallation des dépendances n'écrase le client PG par la version MySQL.
- **Casse du nom d'utilisateur** : connexion et contrainte d'unicité suivent un référentiel **normalisé en minuscules** (le classement MySQL par défaut est insensible à la casse, PostgreSQL y est sensible), l'e-mail étant également stocké en minuscules, garantissant un comportement de connexion / déduplication cohérent sur les deux bases ; les comptes à casse mixte existant avant le changement restent connectables sur MySQL (couvert par la CI), et sur une base existante `pnpm --filter aiworkin-enterprise-api db:normalize-usernames` effectue un backfill en une fois (idempotent, valable sur les deux bases, les collisions étant ignorées et listées).

> Différence connue : la recherche en texte libre (mot-clé `contains`) est insensible à la casse sur MySQL et sensible sur PostgreSQL — le `mode:'insensitive'` de Prisma n'étant pas pris en charge sur le connecteur MySQL, toutes les requêtes de recherche ne sont pas uniformisées de force. Le contenu principal (chinois, etc.) étant sans casse, il n'est pas affecté ; pour unifier aussi la recherche latine, on peut créer la base PostgreSQL avec un classement ICU insensible à la casse, ou normaliser en minuscules les champs concernés avant recherche.

---

## 🐳 Docker Compose (avec MySQL)

Le `docker-compose.yml` à la racine orchestre trois services **MySQL + backend + frontend**, pratiques pour une prise en main immédiate :

```bash
# toutes les dépendances de service ont une valeur de démonstration locale par défaut（${VAR:-default}）, lancement direct :
docker compose up --build
# pour un mot de passe / domaine personnalisé, créer un .env à la racine pour surcharger MYSQL_* / JWT_SECRET / EXTERNAL_CRED_KEY, etc.
# backend http://localhost:1690  frontend http://localhost:15890
```

Au premier démarrage, le backend exécute automatiquement `prisma migrate deploy` pour créer les tables. Après le premier démarrage, il faut encore créer l'administrateur de plateforme dans le conteneur (le compose injecte
`ADMIN_USERNAME` / `ADMIN_PASSWORD`, par défaut `admin` / `admin-Startup-2026`, surchargeable dans le `.env` à la racine) :

```bash
docker compose exec api pnpm --filter aiworkin-enterprise-api exec tsx scripts/seed-admin.ts
```

Pour un déploiement en production, remplacez `JWT_SECRET` / `EXTERNAL_CRED_KEY`
par des valeurs fortement aléatoires et utilisez une base et un reverse proxy dédiés (`infra/nginx/` fournit des exemples de configuration).

---

## 🌐 Domaine du site (adresse d'accès externe)

Aucune adresse locale n'est codée en dur sur tout le site : les points de terminaison MCP / API, les rappels IM et les liens « traiter » des cartes, le script d'intégration du service client en ligne,
l'entrée des codes vivants, les liens d'invitation et les valeurs suggérées de rappel de paiement composent uniformément leurs adresses absolues selon la priorité suivante :

1. La valeur saisie dans « console d'administration → paramètres du site → domaine du site » (seul http/https est accepté, avec port possible, effet immédiat en base, sans redémarrage)
2. La variable d'environnement du backend `SITE_URL`
3. L'adresse courante du visiteur (`window.location.origin`, aucun réglage nécessaire pour un déploiement à domaine unique)

En développement local rien n'est à renseigner : en dev le proxy Next redirige `/api/*`, en production Nginx prend d'abord `/api/*`,
de sorte que des points de terminaison comme `https://votre-domaine/api/v1/mcp` sont valides dans les deux formes.
Après modification du domaine en administration, ce domaine est automatiquement intégré à la liste blanche CORS / vérification d'origine ; la modification de la variable `SITE_URL` elle-même nécessite toujours un redémarrage.

---

## 🔑 Liaison de la clé API AIPDD et canaux amont

- L'utilisateur lie une clé API (sk-) émise par la plateforme AIPDD dans le bloc « liaison de la clé API AIPDD » de la page « services de modèle → gestion des clés API » ;
  plusieurs utilisateurs peuvent lier la même clé (N:1, fusion par empreinte), le chiffré étant stocké en AES-256-GCM.
  L'ancienne page indépendante « liaison de la clé AIPDD » (`/developer/aipdd`) a été fusionnée dans la gestion des clés API, l'ancienne adresse redirigeant vers `/developer/keys`.
  Ces deux pages (gestion des clés API / réglages du modèle) relèvent du libre-service au niveau du compte et **ne sont pas affichées dans la barre latérale sous l'identité administrateur de plateforme** ; pour les configurer, basculez sur l'identité entreprise / individuelle (la clé de niveau plateforme se trouve dans « configuration système → clé de plateforme AIPDD »), un accès direct par lien restant possible.
- Le même bloc assume le guide d'inscription : une fois le code de parrainage AIPDD saisi par l'administrateur dans « paramètres du site », un nouvel utilisateur suivant le guide s'inscrit sur www.aipdd.work et saisit ce code
  pour obtenir du calcul offert (la commission de parrainage revenant à l'administrateur) ; la variable `AIPDD_REFERRAL_CODE` peut définir un code par défaut, `AIPDD_REGISTER_URL` remplacer l'adresse d'inscription (seul http/https est accepté).
- `backend/src/common/upstream-token.ts` est l'**unique entrée d'identifiant** pour accéder à l'amont : le code métier ne prend plus le jeton de session local pour un identifiant amont,
  mais le remplace par la clé liée par l'utilisateur ; un utilisateur non lié déclenchant une action amont reçoit un `403` d'orientation (la publication locale n'est pas affectée).
- **Les données de base passent par la clé de plateforme, pas par la clé utilisateur** : les données de référence comme le dictionnaire des provinces / villes et les entrées de dictionnaire de la plateforme, indépendantes de l'identité utilisateur, sont configurées par l'administrateur dans
  « console d'administration → configuration système → clé de plateforme AIPDD » avec une clé de plateforme uniforme (même format `sk-` et vérification en ligne réelle,
  chiffré AES-256-GCM dans `system_settings.aipdd_platform_key`, retour masqué uniquement, priorité supérieure à la variable `AIPDD_PLATFORM_KEY`,
  et isolée en lecture-écriture par l'interface générale des paramètres système). Chaîne de résolution : clé de plateforme → clé liée par l'utilisateur → en l'absence des deux, repli régional sur le dictionnaire provinces / villes local intégré
  (`backend/src/shared/region-dictionary.ts`, source `GEO_CENTERS`), de sorte qu'une clé de plateforme non configurée ne bloque pas les formulaires,
  mais les entrées de dictionnaire de la plateforme nécessitent toujours une clé.
- Les **actions utilisateur** de publication de demande, synchronisation amont et mise en relation de ressources utilisent toujours leur propre clé liée, sans être affectées par la clé de plateforme.
- Avec `AIPDD_KEY_VERIFY=off`, la liaison ne fait pas de vérification en ligne réelle (utile pour une démonstration hors ligne) ; en mode en ligne, elle appelle la vérification amont.

---

## 🧪 Build, tests et CI

Les tests unitaires backend s'exécutent sous `backend/test/jest-unit.json` (ts-jest), les tests de composants frontend avec Vitest + Testing Library (jsdom), la CI exécutant en outre les modèles d'environnement, l'instantané OpenAPI et les vérifications d'upload et de migration :

```bash
pnpm --filter aiworkin-enterprise-api test          # tests unitaires backend（102 suites / 862 cas passés, 15 ignorés selon l'environnement）
pnpm --filter aiworkin-enterprise-web test          # tests de composants frontend（objectifs / décomposition IA / fiche client 360 / fiche projet 360）
pnpm test:uploads                                   # vérification d'upload des pièces jointes et images de facture
pnpm test:environment                               # modèle de déploiement et référentiel des variables d'environnement
pnpm api:docs:check                                 # l'instantané OpenAPI est-il conforme à la couche contrat
pnpm lint                                           # normes de code + mise en forme prettier, barrière dure CI
pnpm build                                          # contracts → backend tsc → frontend next build
```

- **Plafond de tas du build frontend** : `build`, `typecheck` et `lint` passent uniformément par `frontend/scripts/with-heap.mjs`, avec par défaut
  `--max-old-space-size=10240` (un tas d'environ 4 Go par défaut provoque un OOM — code de sortie 134 — lors d'une compilation à froid de 55 pages ou d'un lint sensible aux types) ;
  surchargeable via `NODE_HEAP_MB`, transmis tel quel s'il est déjà configuré explicitement.
- **CI (GitHub Actions)** : installation des dépendances → build contracts → baseline de routes et d'architecture (`check-architecture`, avec vérification de connexion directe à la barrière IA) → modèles d'environnement →
  instantané OpenAPI → typecheck → **barrière dure des normes de code (`pnpm lint`, avec mise en forme prettier)** → tests unitaires backend → tests de composants frontend → vérification d'upload →
  **exécution de `prisma migrate deploy` (0001→0052) sur une base MySQL 8 vide** → build front et back.
- **Baseline d'évasion de types** : `pnpm audit:escapes` génère `docs/escape-report.md` / `docs/escape-report.json` ;
  `pnpm check:escape-budget` contrôle selon `.escape-budget.json` (total et catégories en baisse seulement) et `.escape-allowlist.json`
  (échec en cas de dérive du numéro de ligne des entrées enregistrées), la CI étant branchée (après l'auto-test de l'instrument, avant les autres barrières).
- **Référentiel de fin de ligne** : `backend/.prettierrc` définit `endOfLine: "auto"`, vérifié selon la fin de ligne existante du fichier ; Windows avec
  `core.autocrlf=true` extrait en CRLF, l'index du dépôt et la CI étant en LF, aucun faux positif des deux côtés. Les autres options de mise en forme restent les règles prettier par défaut.
- **Scripts d'intégration dépendant de la base** : `pnpm test:regression` / `test:query-plans` / `test:performance` / `test:geo-recovery`
  visent une base locale PostgreSQL vide jetable (`createdb` + `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`),
  incompatibles avec le dialecte MySQL par défaut, conservés pour exécution locale à la demande.
- **Scripts de fumée** (PowerShell, ASCII pur, nom d'utilisateur aléatoire garantissant l'idempotence) :

```powershell
pwsh scripts/smoke-m5.ps1   # boucle du bloc social（relations / actualités / groupes / messages privés / CV / héritage du bannissement）
pwsh scripts/smoke-m6.ps1   # place de l'offre et de la demande：publication locale sans clé + synchronisation amont 403 sans clé liée
pwsh scripts/smoke-site-url.ps1            # normalisation du domaine du site / CORS / écho public + page 200
pwsh scripts/smoke-aipdd-platform-key.ps1  # clé AIPDD de plateforme：aucune fuite du chiffré + repli du dictionnaire régional
```

---

## 🧹 Simplifications par rapport à l'édition commerciale amont

Cette édition open source est le produit d'une démarche « fusion + désensibilisation + localisation », et **n'inclut pas** explicitement :

- le backend NestJS de SNS d'origine et le visuel bleu-blanc d'aiworkin.com (l'architecture d'information est conservée, tous les styles étant réécrits en AntD) ;
- les activités liées à la monnaie awcoin (récompense / règlement, etc.) (la place de l'offre et de la demande ne reflète que l'état amont, sans monnaie ; l'AWcoin du centre de points n'est qu'un affichage en lecture seule) ;
- les mécanismes de plateforme de consultation / demande de clé `sk-` déléguée, d'émission sur place `DEV_AUTO_LOGIN`, etc. (les données de démonstration sont fournies avec `prisma:seed`,
  mais les identités de démonstration ne permettent pas de connexion en un clic, il faut une inscription locale normale) ;
- le service d'annuaire Java amont : la source de données devenant la table locale `users`.

---

## 💬 Communauté

Pour rejoindre le groupe de discussion du système de services d'entreprise IA, scannez le QR code ci-dessous. Vos retours de problèmes et suggestions d'amélioration sont les bienvenus ; les bonnes suggestions seront implémentées et le code source partagé.

<div align="center">
<img src="docs/assets/wechat-group-qr.png" width="260" alt="Groupe de discussion du système de services d'entreprise IA · QR WeChat">
</div>

---

## 📄 License

Released under the [Apache License 2.0](LICENSE).
