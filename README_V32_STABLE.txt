MKG-W4F M'MEDPREN v32 — stabilisation des fonctions de base

CORRECTIONS UNIQUEMENT
- La session Admin survit à une actualisation/reouverture grâce à un jeton serveur persistant.
- Le mot de passe Admin n'est plus conservé dans le stockage persistant après connexion; seul un jeton signé est gardé.
- Une image produit/publicité est envoyée à Firebase Storage avant de considérer l'enregistrement terminé.
- Une publicité ajoutée en ligne attend une synchronisation serveur confirmée.
- Les URL Firebase Storage remplacent les gros Base64 et sont enregistrées localement avant le push Firestore.
- Synchronisation automatique déclenchée ~120 ms après modification et contrôle distant toutes les ~2 s.
- En cas d'échec d'upload, l'interface ne prétend plus que l'image a été enregistrée.
- Aucun changement de design ni ajout de fonctionnalité métier.

APRÈS DÉPLOIEMENT
1. Se connecter une seule fois en Administrateur afin d'obtenir le nouveau jeton v32.
2. Actualiser la page: elle doit rester Administrateur.
3. Ajouter une publicité: attendre la fin de « Enregistrement… ».
4. Actualiser: la publicité doit rester visible et la session doit rester Admin.
5. Ouvrir un autre appareil en visiteur: la même publicité doit apparaître après quelques secondes.
