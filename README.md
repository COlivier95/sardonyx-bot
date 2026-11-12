# Bot d'alerte Seiko Sardonyx

Surveille Mercari Japon (et Mercari Shops), Yahoo! Auctions, Yahoo!フリマ, Rakuma et Reddit r/Watchexchange toutes les 5 minutes, et envoie une notification sur ton téléphone dès qu'une nouvelle annonce correspond à l'un des trois modèles :

- 7820-5000 (CHG803), 6020-5260 (CGT073 / AGT023), 6020-5280 (CGT031)
- ou un titre Seiko / Chariot / Dolce qui parle de sardonyx, agate (瑪瑙, メノウ) ou cadran « façon bois » (木目)

Aucun filtre de prix : chaque alerte affiche le prix en yens et en dollars, c'est toi qui décides.
Sont exclus : Credor, horloges de table, bijoux, et les annonces qui indiquent clairement un cadran noir (黒文字盤, ブラックオニキス…).

Coût : 0 $. GitHub Actions est gratuit pour un dépôt public, et ntfy est gratuit.

## Mise en place (10 minutes)

1. **Téléphone** : installe l'app **ntfy** (App Store ou Google Play). Touche « + », et abonne-toi au sujet :
   `sardonyx-56f4e754cdab`
   (Ce nom sert de mot de passe : ne le partage pas.)
2. **GitHub** : crée un compte gratuit sur github.com si tu n'en as pas, puis un nouveau dépôt **public** (par ex. `sardonyx-bot`).
3. Dépose les fichiers du dossier dans le dépôt : « Add file » → « Upload files », glisse **tout le contenu** du dossier, y compris le dossier `.github`. Si le dossier `.github` n'est pas pris, crée le fichier à la main avec « Add file » → « Create new file », nom `.github/workflows/scan.yml`, et colle son contenu.
4. Dans le dépôt : **Settings → Secrets and variables → Actions → New repository secret**
   - Name : `NTFY_TOPIC`
   - Secret : `sardonyx-56f4e754cdab`
5. Onglet **Actions** → active les workflows si GitHub le demande → « Scan sardonyx » → **Run workflow**.
   Une minute plus tard, tu reçois « ✅ Bot sardonyx actif » avec le nombre de recherches réussies sur Mercari et Yahoo.

Ensuite tout tourne seul, même ordinateur éteint.

## À savoir

- GitHub lance la tâche toutes les 5 minutes en théorie ; aux heures chargées, l'écart peut monter à 10–15 minutes.
- Si Mercari ou Yahoo bloque le bot pendant ~30 minutes, tu reçois « ⚠️ … ne répond plus », puis « ✅ … répond de nouveau ».
- Pour ajouter ou retirer un mot-clé : modifie la liste `KEYWORDS` en haut de `scan.mjs` (bouton crayon sur GitHub).
- Pour mettre en pause : Actions → Scan sardonyx → « … » → Disable workflow.
- Le fichier `seen.json` mémorise les annonces déjà signalées, pour ne jamais t'alerter deux fois.
