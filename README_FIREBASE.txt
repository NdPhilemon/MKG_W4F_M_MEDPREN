MKG-W4F M'MEDPREN — FIRESTORE + CLOUDINARY

1. Créer un projet Firebase.
2. Activer Firestore Database en mode Production.
3. Project Settings > Service accounts > Generate new private key.
4. Ajouter dans Vercel les valeurs de ENV_VERCEL_FIREBASE.txt.
5. Configurer Cloudinary selon DEPLOIEMENT_CLOUDINARY.md.
6. Déployer les fichiers du dépôt.
7. Tester /api/health puis /api/sync?scope=public.

Résultat attendu /api/health: {"ok":true,"provider":"firebase","firestore":true,...}

Le document mmedpren/global est créé automatiquement au premier accès.
Firebase Storage n'est plus utilisé. Les nouvelles photos sont envoyées vers Cloudinary avant synchronisation ; Firestore ne reçoit que leur URL HTTPS. Les anciennes URL Firebase Storage déjà présentes restent affichables : ne supprimez pas leur bucket avant une migration séparée.
