MKG-W4F M'MEDPREN v28 — Stable Auto Sync

Corrections vérifiées:
- session par onglet via sessionStorage; un onglet Visiteur ne peut plus déconnecter un onglet Admin;
- événements localStorage/BroadcastChannel fusionnent uniquement les données métier et préservent la session;
- navigation protégée avec la bonne variable id;
- synchronisation manuelle retirée;
- modifications envoyées automatiquement après ~300 ms;
- retour Internet = envoi automatique;
- vérification légère de revision MongoDB toutes les ~3 s, pull complet uniquement si la revision change;
- catalogue public rafraîchi uniquement en mode Visiteur.

- La session et syncAuth ne sont plus enregistrées dans localStorage partagé.
- À la connexion interne, l'application récupère d'abord l'état MongoDB si aucune opération locale n'est en attente, évitant d'écraser le serveur avec un état public/stale.
