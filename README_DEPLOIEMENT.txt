MKG-W4F M'MEDPREN v24 — Correctif synchronisation & rapidité

CORRECTIONS PRINCIPALES
- Migration automatique des données locales depuis v21/v23 vers v24.
- L'administrateur déjà connecté recrée automatiquement ses informations de synchronisation.
- Le bouton "Synchroniser maintenant" force une vraie confirmation MongoDB.
- L'heure de synchronisation n'est mise à jour qu'après confirmation du serveur.
- L'interface affiche la révision MongoDB réelle (r1, r2, ...).
- Les erreurs de synchronisation sont affichées clairement.
- Les opérations hors connexion restent en file et repartent au retour d'Internet.

PERFORMANCES
- Vérification légère de la révision serveur toutes les ~4 secondes.
- La base complète n'est téléchargée que si la révision a réellement changé.
- Une sauvegarde locale sans changement en attente ne déclenche plus un POST complet.
- Délai automatique de push réduit à ~450 ms.
- Timeout réseau pour éviter les écrans bloqués.

DEPLOIEMENT
1. Conserver MONGODB_URI dans Vercel.
2. Remplacer TOUS les fichiers de la v23, notamment index.html, sw.js et api/sync.js.
3. Vérifier que sync.js est bien dans le dossier api/.
4. Commit / déployer sur la branche Production.
5. Ouvrir l'application, se connecter administrateur, puis cliquer une fois "Synchroniser maintenant".
6. Le message attendu est : "Synchronisation MongoDB réussie · serveur r1" (ou supérieur).
7. Vérifier ensuite /api/sync?scope=public : revision doit être > 0.
