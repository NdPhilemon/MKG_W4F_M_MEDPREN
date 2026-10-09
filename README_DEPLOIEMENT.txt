MKG-W4F M'MEDPREN v23 — MongoDB Sync

Déploiement Vercel:
1. Garder MONGODB_URI dans Settings > Environment Variables (Production + Preview).
2. Recommandé: ajouter ADMIN_PASSWORD=202020 et ADMIN_EMAIL=ndagonywaphilemon@gmail.com dans Vercel.
3. Remplacer tous les fichiers du projet par ceux de ce dossier, y compris api/sync.js et package.json.
4. Déployer / Redeploy. Vercel installera automatiquement le package mongodb.
5. MongoDB Atlas > Network Access doit autoriser les connexions de Vercel (pour un premier test: 0.0.0.0/0).
6. Connectez-vous comme administrateur puis cliquez Synchroniser maintenant une première fois pour initialiser MongoDB avec l'état de l'application.

Fonctionnement:
- Les données restent locales hors connexion.
- Les changements sont poussés automatiquement au retour d'Internet.
- Les autres appareils récupèrent les changements toutes les ~7 secondes quand l'application est ouverte.
- Les visiteurs reçoivent le catalogue/publicités et retrouvent leurs propres commandes.
- La prise en charge d'une commande est atomique côté MongoDB et nécessite Internet.
- Les images sont compressées avant synchronisation pour limiter l'espace Atlas.
