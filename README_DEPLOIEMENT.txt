MKG-W4F M'MEDPREN v26 — Correctif catalogue visiteur

Cause corrigée :
Le produit existait bien dans MongoDB, mais le visiteur pouvait garder une copie locale vide.
La page considérait parfois la synchronisation déjà à jour et n'allait pas recharger le catalogue public.

v26 :
- force la récupération publique au démarrage visiteur ;
- retente automatiquement si la liste locale est vide ;
- rafraîchit immédiatement après passage en mode visiteur ;
- tolère stock/prix reçus comme nombres ou chaînes ;
- change le cache PWA vers v26 ;
- migre les anciennes données locales v21-v25.

Déploiement :
Remplacer index.html et sw.js, ou importer tout le ZIP.
