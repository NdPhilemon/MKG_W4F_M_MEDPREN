MKG-W4F M'MEDPREN v30 FIREBASE

1. Créer un projet Firebase.
2. Activer Firestore Database en mode Production.
3. Activer Firebase Storage.
4. Project Settings > Service accounts > Generate new private key.
5. Ajouter dans Vercel les valeurs de ENV_VERCEL_FIREBASE.txt.
6. Déployer tous les fichiers de cette archive.
7. Tester /api/health puis /api/sync?scope=public.

Résultat attendu /api/health: {"ok":true,"provider":"firebase","firestore":true,...}

Le document mmedpren/global est créé automatiquement au premier accès.
Les photos sont envoyées vers Firebase Storage avant synchronisation, au lieu de rester en Base64 dans Firestore.
