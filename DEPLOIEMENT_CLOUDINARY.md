# Déploiement Cloudinary et accès Administrateur

Cette version conserve Firestore pour les données métier et utilise Cloudinary uniquement pour les nouvelles images. Elle ne migre et ne supprime aucune ancienne image Firebase Storage.

## 1. Configurer l’Administrateur de test

Le code ne contient aucun mot de passe de secours. Dans Vercel, ouvrez le projet **MKG-W4F M’MEDPREN**, puis **Settings → Environment Variables** et créez ou remplacez :

| Nom | Valeur | Environnement |
|---|---|---|
| `ADMIN_EMAIL` | `ndagonywaphilemon@gmail.com` | Production ; Preview si vous y testez |
| `ADMIN_PASSWORD` | le mot de passe communiqué, puis à renouveler après le test | mêmes environnements |
| `SESSION_SECRET` | secret aléatoire indépendant d’au moins 32 caractères | mêmes environnements |

Choisissez le type **Sensitive/Secret** pour `ADMIN_PASSWORD` et `SESSION_SECRET`. L’adresse email peut être une variable normale. Ne mettez jamais ces valeurs dans `index.html`, GitHub, une capture d’écran ou un message public. Le mot de passe communiqué pour ce test doit être changé après validation, puisqu’il a été partagé dans une conversation.

Les trois variables Administrateur sont obligatoires. Si `SESSION_SECRET` manque ou fait moins de 32 caractères, l’email et le mot de passe peuvent être corrects mais la création de la session échoue avec `SESSION_NOT_CONFIGURED`.

Une modification de variable Vercel ne change pas un déploiement existant : ouvrez **Deployments**, choisissez le dernier commit puis **Redeploy**. Une rotation de `SESSION_SECRET` déconnecte toutes les sessions existantes ; c’est attendu.

## 2. Créer Cloudinary Free et trouver les identifiants

1. Ouvrez [Cloudinary](https://cloudinary.com/) et cliquez **Sign up for free**.
2. Après la création, ouvrez la **Cloudinary Console**. Le **Cloud name** apparaît dans les informations de l’environnement produit.
3. Ouvrez **Settings** (roue dentée) → **API Keys**.
4. Copiez l’**API Key**.
5. Révélez/copiez l’**API Secret** uniquement au moment de le saisir dans Vercel. Ne l’envoyez pas dans cette conversation et ne le commitez jamais.

L’application n’utilise aucun upload preset public. `/api/upload` authentifie l’utilisateur, contrôle ses permissions, valide l’image, génère une signature SHA-256 côté serveur et appelle l’API Cloudinary. Le navigateur ne reçoit jamais `CLOUDINARY_API_SECRET`.

## 3. Ajouter Cloudinary dans Vercel

Dans **Vercel Dashboard → projet → Settings → Environment Variables**, créez :

| Nom | Type | Cible conseillée |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | Config/Plain : valeur du compte Cloudinary actif | Production |
| `CLOUDINARY_API_KEY` | Config/Plain : clé du même compte Cloudinary | Production |
| `CLOUDINARY_API_SECRET` | Sensitive/Secret | Production |

Pour tester un déploiement Preview, ajoutez aussi les trois variables à **Preview**. Le code range automatiquement les médias dans `mmedpren/production/...`, `mmedpren/preview/...` ou `mmedpren/development/...`. Utilisez si possible des identifiants Cloudinary de test séparés pour Preview/Development. Sans ces variables, le site continue à fonctionner, mais tout nouvel upload renvoie une erreur explicite `MEDIA_NOT_CONFIGURED` et aucune URL fictive n’est écrite dans Firestore.

Après chaque ajout/modification, déclenchez un **Redeploy**. Les variables sont lues par les fonctions au démarrage du nouveau déploiement.

Le code fourni par la console Cloudinary est un exemple Node.js autonome. Dans cette application, son équivalent est réparti entre `api/upload.js` et `lib/cloudinary.js` : upload signé côté serveur, puis URL de livraison avec `f_auto,q_auto,c_limit,w_1600`. L’API Secret reste uniquement dans Vercel.

Les trois valeurs doivent venir du même compte Cloudinary. Le test réel du 14 octobre 2026 sur la production a réussi et a retourné le cloud `gsn7ul7w`. Si le compte attendu est différent, remplacez ensemble le Cloud name, l’API Key et l’API Secret, puis redéployez.

## 4. Ordre exact de mise en production

1. Créer le compte Cloudinary et relever ses trois identifiants.
2. Configurer dans Vercel `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET` et les trois variables Cloudinary.
3. Vérifier que les variables Firebase existantes sont toujours présentes : `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
4. Pousser les fichiers corrigés sur GitHub `main`.
5. Dans Vercel **Deployments**, attendre le déploiement du commit et vérifier que le build passe.
6. Ouvrir `/api/health` : résultat attendu `{"ok":true,"provider":"firebase","firestore":true}`.
7. Se connecter avec l’adresse Admin configurée, actualiser la page, puis rouvrir l’onglet.
8. Ajouter un article avec photo ; vérifier dans Cloudinary **Assets/Media Library**, dans le catalogue, puis après F5.
9. Ouvrir la vitrine sur un second appareil et vérifier l’image.
10. Ajouter une publicité active et répéter le contrôle multi-appareils.

## 5. Checklist réelle après déploiement

- [ ] `/api/health` répond 200 avec `firestore:true`.
- [ ] Login Admin réussi ; F5 conserve le rôle et la page active.
- [ ] Vendeur sans permission ne peut pas envoyer une image ; un Gérant autorisé peut envoyer une photo produit mais pas une publicité.
- [ ] Une photo produit apparaît dans Cloudinary et Firestore ne contient qu’une URL `https://res.cloudinary.com/...`.
- [ ] L’article et sa photo sont visibles après F5 et sur un second appareil.
- [ ] Une publicité active apparaît dans la vitrine sur un second appareil.
- [ ] Créer, modifier le texte ou l’image, masquer/réactiver puis supprimer une publicité fonctionne et se propage en 2 à 3 secondes en conditions réseau normales.
- [ ] Hors connexion, les actions métier restent disponibles, mais toute nouvelle image demande Internet et n’est jamais conservée en Base64 dans le stockage local.
- [ ] Une erreur Cloudinary affiche un échec et ne confirme pas une publication.
- [ ] La nouvelle version PWA est chargée ; au besoin fermer/réouvrir l’application installée une fois.

Les tests automatisés utilisent une API Cloudinary et un Firestore simulés. Ils ne prouvent pas la validité de vos clés, droits IAM, quotas, réseau mobile ni du compte Cloudinary réel.

## 6. Retour arrière sans toucher à Firestore

1. Dans **Vercel → projet → Overview/Deployments**, choisissez **Instant Rollback** sur le dernier déploiement fonctionnel antérieur.
2. Ne supprimez aucun document Firestore, aucune collection et aucun média Cloudinary/Firebase Storage.
3. Vérifiez `/api/health`, le login et une lecture du catalogue.
4. Un rollback remet l’ancien code en service, mais les variables d’environnement restent configurées. Les URL Cloudinary déjà écrites dans Firestore sont des URL HTTPS et restent affichables par l’ancienne interface.
5. Après correction, utilisez **Undo Rollback/Promote** pour rétablir l’affectation automatique du domaine de production, puis déployez le nouveau commit.

En ligne de commande, l’équivalent est `vercel rollback`, puis `vercel promote <deployment>` après correction. La procédure Dashboard est préférable ici pour vérifier visuellement le projet et le domaine ciblés.
