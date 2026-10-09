MKG-W4F M'MEDPREN v25 — Synchronisation MongoDB stable

Correction principale :
MongoDB ajoute un champ interne `_id`. La v24 pouvait le récupérer puis le renvoyer à MongoDB,
ce qui provoquait une erreur lors des synchronisations suivantes.

La v25 :
- retire `_id` de toutes les réponses API ;
- retire `_id` avant toutes les écritures ;
- nettoie les anciennes données locales ;
- garde les opérations hors connexion en file en cas d'erreur.

Déploiement :
1. Remplacer index.html, sw.js et api/sync.js.
2. Commit sur la branche Production.
3. Attendre Vercel.
4. Cliquer Synchroniser maintenant.
5. Vérifier que /api/sync?scope=public montre une revision qui augmente.
