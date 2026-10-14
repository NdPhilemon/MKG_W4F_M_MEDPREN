# Audit et stabilisation — 12 octobre 2026

Ce document conserve le diagnostic de stabilisation initial. L’intégration Cloudinary a ensuite été réalisée le 14 octobre 2026, sans modifier les pages, styles, couleurs, reçus ni fonctions métier. Sa configuration et son ordre de déploiement sont détaillés dans `DEPLOIEMENT_CLOUDINARY.md`.

## Diagnostic constaté avant correction

1. **Cause du retour Visiteur après F5 :** `restoreSession()` était appelée avant l’initialisation de `const SESSION_KEY` et `const PERSISTENT_SESSION_KEY`. L’accès à ces constantes levait une `ReferenceError`, masquée par un `catch` vide. Le cache métier excluait correctement l’authentification, mais la session séparée n’était jamais restaurée au démarrage. `render()` et `routeFromHash()` démarraient donc en Visiteur.
2. **Identité instable :** `currentRole()` dépendait d’abord de `db.users` récupéré à distance ; `ensureLocalPrimaryAdmin()` pouvait remplacer l’utilisateur actif, notamment en mode « Ouvrir comme ». Plusieurs critères concurrents déterminaient les droits.
3. **Mot de passe en clair :** le login affectait `localUser.password=secret`, ensuite persisté dans le cache métier. Le frontend et le backend contenaient aussi un mot de passe Admin de secours. L’écran de changement de mot de passe modifiait seulement ce cache, pas `ADMIN_PASSWORD` dans Vercel.
4. **Boucle de requêtes :** lorsque le catalogue était vide, `renderStorefront()` programmait `refreshPublicCatalog()`, qui rappelait `renderStorefront()`.
5. **Écrasements et pertes :** le serveur ignorait `baseRevision` et remplaçait des tableaux complets. Un push acquittait toutes les opérations en attente, même celles créées pendant son exécution. Un pull pouvait écraser une modification locale intervenue pendant la requête. Une réponse tardive pouvait aussi être appliquée après un changement de session.
6. **Écritures non atomiques :** données métier, commandes et révision étaient écrites séparément. La récupération d’une commande était transactionnelle, mais un push ultérieur pouvait écraser son attribution.
7. **Autorisations incomplètes :** les vendeurs recevaient les commandes d’autres agents ; les protections d’affichage ne constituaient pas un contrôle serveur. Une commande publique existante n’était pas suffisamment liée à son propriétaire. `/api/upload` acceptait les requêtes sans authentification.
8. **Actions sans file :** certains transferts, notifications et approbations utilisaient seulement `save()`. La synchronisation dépendait alors d’un envoi global implicite.
9. **PWA :** les navigations étaient déjà en priorité réseau, mais les erreurs HTTP pouvaient remplacer le cache HTML ; `clients.claim()` n’était pas attendu et le nettoyage supprimait les caches sans limiter leur préfixe. `/` n’avait pas l’en-tête explicite de non-cache.
10. **Runtime :** Firebase était initialisé à l’import de `api/sync.js`, hors du `try/catch` du handler. Une configuration manquante pouvait empêcher complètement le chargement de la fonction.

## Architecture retenue

- Jeton HMAC signé côté serveur, valable **30 jours**, conservé dans `localStorage` sous une clé dédiée. Aucun mot de passe Admin n’est conservé. `sessionStorage` sert seulement à migrer une ancienne session, puis sa clé est supprimée.
- Session restaurée avant routage et rendu ; identité authentifiée conservée séparément des listes métier. Le serveur relit le compte et ses permissions à chaque opération protégée : modifier le rôle dans le navigateur ne donne aucun droit serveur.
- Cache métier séparé par compte (`mkg-data-…`). Une déconnexion retire la session ; les changements non envoyés sont archivés pour leur propriétaire et récupérés à sa prochaine connexion. Les archives et caches restent des données locales sensibles sur un appareil partagé.
- Une première connexion nécessite Internet. Une session existante reste utilisable hors connexion, y compris après rechargement. Un jeton expiré ou refusé bloque l’accès distant et demande une reconnexion ; il ne supprime pas les changements locaux et ne force pas un retour Visiteur.
- Les erreurs réseau sont retentées avec délai croissant. Un 401 suspend les essais automatiques jusqu’à la reconnexion. La synchronisation ne change pas la route active.
- Les changements sont calculés depuis le dernier état confirmé. Les modifications d’éléments différents se fusionnent ; les variations de stock s’additionnent dans une transaction et un stock négatif est refusé. Deux modifications incompatibles du même champ renvoient **409**, en conservant la version locale et sa file.
- Chaque lot privé possède un identifiant durable et un accusé serveur, pour éviter de réappliquer une vente/variation de stock après une réponse réseau perdue. Les opérations ajoutées pendant l’envoi restent en attente.
- Les écritures métier, commandes concernées, accusé et révision sont atomiques. La prise d’une commande et sa révision sont également dans une même transaction.
- Les images passent toujours par `uploadMediaIfNeeded()` → `/api/upload` ; le serveur refuse les données `data:` dans les changements synchronisés. Une nouvelle image exige Internet et n’est ajoutée à l’état métier qu’après réception de son URL Cloudinary.

Le choix de `localStorage` conserve le fonctionnement PWA hors ligne et la réouverture d’onglet sans introduire un deuxième système d’authentification. Le jeton reste accessible au JavaScript de la page : ce choix ne remplace pas la prévention des injections HTML. Plusieurs interpolations ont été échappées ; aucun audit externe de sécurité n’est revendiqué.

## Tests exécutables

Commande : `npm test` avec Node.js 24. Les tests chargent le HTML et le JavaScript réels dans jsdom. Les handlers réels utilisent un substitut Firestore en mémoire, avec transactions sérialisées, lectures avant écritures et application atomique. Le service worker est exécuté dans un contexte simulant les API Cache/Fetch.

Résultat de la stabilisation initiale : **13 tests réussis, 0 échec**. La campagne finale Cloudinary ajoute les parcours d’upload, de publication multi-appareils, de panne fournisseur, de quota et de reprise hors ligne : **21 tests réussis, 0 échec**. Le contrôle `npm run verify` réussit également. Il porte volontairement un autre nom que `build` afin de conserver le déploiement statique zéro configuration de Vercel.

| Scénario demandé | Résultat local |
|---|---|
| 1. Visiteur → login Admin → dashboard | Réussi |
| 2. Refresh Admin et réouverture d’onglet | Réussi |
| 3. Refresh Articles, Rapports, Personnel, Boutique, Paramètres | Réussi |
| 4. Modification → envoi automatique → stockage serveur | Réussi avec Firestore simulé |
| 5. Appareil A → serveur → appareil B | Réussi avec deux contextes jsdom |
| 6. Modification hors ligne → rechargement → retour réseau | Réussi |
| 7. Réponse 500/401 ou réponse tardive | Session/route conservées ; réponse d’une ancienne session ignorée |
| 8. Déconnexion volontaire | Session supprimée ; éventuelle file privée archivée |
| 9. Nouveau HTML, cache hors ligne, API sans cache | Réussi dans la simulation du service worker |

Tests supplémentaires : ventes concurrentes et stock, modifications pendant un push, réponse perdue et retry idempotent, conflit conservé, refus des jetons falsifiés/expirés, compte suspendu, vendeur/gérant, propriété des commandes, première attribution gagnante, upload non authentifié, refus Base64, nettoyage des anciens mots de passe, catalogue vide sans boucle, actions utilisant uniquement `save()`.

La conservation du mode « Ouvrir comme » après rechargement et le parcours commande visiteur → récupération → finalisation → décrément du stock ont également été exécutés.

**Limite de validation :** ces tests ne contactent pas votre projet Firebase et ne déploient pas sur Vercel. Les permissions IAM, les certificats du compte de service, le bucket Storage, les limites réelles de Firestore et les comportements PWA sur vos téléphones doivent encore être vérifiés sur un environnement de recette. Une simulation ne constitue pas une confirmation de production.

## Fichiers à remplacer ou ajouter

| Fichier | Pourquoi |
|---|---|
| `index.html` | Ordre de démarrage, session, rôles, routage, caches par compte, file/retry, réponses tardives, nettoyage des secrets, upload et échappement HTML. Pas de changement de CSS ou de structure des pages. |
| `api/firebase-init.js` | Singleton de l’application par défaut et normalisation de la clé privée. |
| `api/health.js` | Réponse simple et absence de détails internes dans les erreurs publiques. |
| `api/sync.js` | Authentification serveur, transactions, droits, commandes, révisions, fusion, idempotence, limites de tentatives et validation des médias. |
| `api/upload.js` | Authentification/permission, quota durable, formats raster autorisés, taille limitée et upload signé vers Cloudinary. |
| `lib/cloudinary.js` **nouveau** | Validation binaire, signature SHA-256, appel fournisseur, vérification de réponse et URL optimisée. |
| `sw.js` | Cache v35, réseau prioritaire, fallback hors ligne, cycle de vie attendu, API sans cache. |
| `vercel.json` | Non-cache pour `/` et revalidation du module de fusion. |
| `sync-core.js` **nouveau** | Diff/fusion partagés entre navigateur et backend, sans logique de session. |
| `lib/session.js` **nouveau** | Signature, validation et expiration des jetons ; secret indépendant obligatoire. |
| `package.json` | Commande de tests et dépendance de développement jsdom. |
| `package-lock.json` **nouveau** | Versions exactes et installation reproductible. |
| `.gitignore` **nouveau** | Exclusion des dépendances installées, fichiers d’environnement et artefacts Vercel. |
| `ENV_VERCEL_FIREBASE.txt` | Modèle sans secret ; ajout de l’Admin de test et des trois variables Cloudinary. |
| `firebase.json` et `firebase/storage.rules` | Retrait de la configuration Firebase Storage devenue inactive, sans suppression des anciens médias. |
| `scripts/check-build.mjs` **nouveau** | Validation reproductible des scripts, imports, JSON et ressources locales avant déploiement. |
| `tests/stability.test.js` **nouveau** | Scénarios de régression et d’intégration Cloudinary simulée exécutables. |
| `DEPLOIEMENT_CLOUDINARY.md` **nouveau** | Configuration Cloudinary/Vercel, ordre de mise en production, checklist et rollback. |
| `AUDIT_TECHNIQUE.md` **nouveau** | Diagnostic, changements, validation et limites. |

Les deux nouveaux modules `sync-core.js` et `lib/session.js` sont indispensables au déploiement : ne pas remplacer seulement `index.html` et `api/sync.js`. Aucun ZIP complet n’est nécessaire. `node_modules` n’est pas à envoyer dans GitHub.

## Configuration et points restant à valider

1. **Avant déploiement :** définir `ADMIN_EMAIL`, un nouveau `ADMIN_PASSWORD` long et unique, et `SESSION_SECRET` aléatoire indépendant d’au moins 32 caractères dans Vercel. L’ancien mot de passe était présent dans les sources : il doit être remplacé. Conserver `SESSION_SECRET` entre les déploiements ; sa rotation impose une reconnexion. Une reconnexion initiale est attendue si les anciens jetons utilisaient le mot de passe comme clé de signature.
2. Vérifier les trois variables du compte de service Firebase et les trois variables Cloudinary. `FIREBASE_STORAGE_BUCKET` n’est plus requis. Les secrets ne sont ni journalisés ni renvoyés au navigateur. `/api/health` doit répondre `{ "ok": true, "provider": "firebase", "firestore": true }`.
3. **Anciennes files sans état de référence :** elles ne sont acceptées que si leur révision correspond encore au serveur. En cas de divergence, elles restent locales et nécessitent une réconciliation des données. Aucune ancienne file n’est supprimée automatiquement.
4. **Conflits sur un même champ :** conservés et signalés, sans choix arbitraire d’une version. Il n’y a pas encore d’écran dédié de résolution de conflit.
5. Le modèle existant conserve les données métier dans `mmedpren/global`. Sa croissance reste une limite structurelle : une séparation en documents par entité sera nécessaire pour un volume important. Les nouveaux accusés dans `mmedpren_sync_receipts` assurent l’idempotence ; leur rétention devra être administrée sans supprimer les accusés de lots encore susceptibles d’être rejoués. Les compteurs `mmedpren_auth_limits` sont temporisés logiquement, sans tâche automatique de purge.
6. Les codes d’accès du personnel restent consultables par l’administrateur et stockés côté serveur, conformément à l’interface existante. Ils ne sont pas renvoyés aux autres membres du personnel. Remplacer ce modèle par des codes à usage unique/hachés demanderait un changement de gestion des accès.
7. Les scripts historiques MongoDB/Firebase et MongoDB/Supabase sont conservés : ce sont des utilitaires manuels, pas des mécanismes de synchronisation actifs. Le script Supabase n’est pas exécutable avec les seules dépendances actuelles de `scripts/package.json`. Les anciens README restent des archives ; le présent rapport décrit le comportement corrigé.
8. Vérifier en recette les scénarios sur deux appareils réels après avoir configuré Cloudinary et redéployé Vercel. Aucune migration ni suppression des anciennes images Firebase Storage n’est requise.

## Intégration Cloudinary réalisée

**`api/upload.js`** conserve son contrat `{dataUrl, folder}` → `{ok, url}` et ses contrôles d’accès. Il appelle désormais un upload Cloudinary signé côté serveur. Le frontend continue d’utiliser **`uploadMediaIfNeeded()`** et les données métier gardent seulement `product.photo` / `ad.image` comme URL. Les fonctions de vente, stock, reçus et rapports restent indépendantes du fournisseur d’images.

## Références vérifiées

- Les transactions Firestore exigent les lectures avant les écritures et peuvent réexécuter leur callback : [documentation Firebase](https://firebase.google.com/docs/firestore/manage-data/transactions).
- Le SDK Admin contourne les Security Rules ; les contrôles métier doivent donc être appliqués dans les handlers : [documentation Firebase](https://firebase.google.com/docs/firestore/security/insecure-rules).
- Le cycle de vie et la stratégie réseau/cache du service worker suivent les mécanismes décrits par [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
