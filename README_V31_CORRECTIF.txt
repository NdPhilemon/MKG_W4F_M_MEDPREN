MKG-W4F M'MEDPREN v31 — Correctif Admin Firebase

PROBLÈME IDENTIFIÉ DANS LA VIDÉO
La connexion Administrateur réussissait, puis le premier pull Firebase renvoyait users=[] et shops=[].
Le navigateur conservait sessionType=internal, mais activeUser() devenait null :
- badge = Visiteur
- Paramètres/Personnel/Rapports masqués
- menu Admin incomplet
- navigation incohérente.

CORRECTIONS
1. Firebase initialise et répare automatiquement Boutique principale + Administrateur principal.
2. privateState() garantit que l'Admin authentifié est toujours renvoyé.
3. Le frontend ne supprime plus l'utilisateur connecté si une réponse distante l'omet.
4. Le rôle Admin est maintenant déterminé aussi par la session authentifiée.
5. Suppression de la boucle refreshPublicCatalog() déclenchée depuis render(), source de clignotements.
6. Navigation interne mobile rendue horizontalement scrollable pour conserver tous les boutons.
7. health.js corrigé.
8. Script MongoDB -> Firebase corrigé.

APRÈS DÉPLOIEMENT
- Se déconnecter une fois puis se reconnecter Admin.
- Le badge doit afficher Administrateur.
- Les boutons doivent inclure Accueil, Ventes, Articles, Personnel, Boutique, Rapports, Commandes.
- La roue Réglages doit être visible.
- L'interface ne doit plus basculer vers Visiteur lors d'un pull Firebase.
