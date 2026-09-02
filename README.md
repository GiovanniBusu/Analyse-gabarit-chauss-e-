# Analyse gabarit chaussée

Outil web pour automatiser l'analyse de largeurs de chaussée et de BAU
(bande d'arrêt d'urgence) le long d'un tracé routier, à partir de fichiers
DXF ou IFC (cadwork/Lexocad), avec comparatif existant / projet et export
Excel (formules live) et DXF (calques structurés).

**Tout tourne dans le navigateur** (DXF et IFC parsés côté client, `web-ifc`
en WASM pour l'IFC) — aucun serveur, aucun compte à créer, déployé
gratuitement sur GitHub Pages. Une implémentation backend Python équivalente
existe aussi dans `backend/` (voir [Alternative backend](#alternative--backend-python--api-rest)).

## Principe

L'utilisateur charge **3 fichiers obligatoires** (chacun DXF ou IFC) :

1. **Axes + profils** — fichier de base servant de référence spatiale et de
   calibration PK, partagé par les deux états suivants.
2. **Existant** — état actuel de la route.
3. **Projet** — état projeté à comparer.

L'outil détecte automatiquement les largeurs BAU/Voie/Trottoir/etc. par côté
et par PK, propose une classification automatique de chaque élément détecté
(avec un niveau de confiance visible), et permet à l'utilisateur de corriger
manuellement toute classification erronée via un menu déroulant — sans avoir
à retoucher le fichier source. Les ratios de conformité et le comparatif
existant/projet se recalculent immédiatement après chaque correction.

## Distribution : GitHub Pages (recommandé, gratuit)

1. Chaque push sur `main` déclenche `.github/workflows/deploy-pages.yml`,
   qui build `frontend/` et publie `frontend/dist` sur GitHub Pages.
2. Réglage unique, une fois : **Settings → Pages → Source : GitHub Actions**
   sur le dépôt.
3. L'URL publique (`https://<owner>.github.io/<repo>/`) est un simple lien à
   partager — fonctionne dans n'importe quel navigateur, aucun blocage IT
   possible puisqu'il n'y a ni serveur ni exécutable.

Tout le calcul (parsing DXF/IFC, géométrie, ratios, export Excel/DXF) tourne
sur la machine de chaque utilisateur : pas de limite de RAM serveur partagée,
pas de redémarrage de conteneur qui perd l'état en cours de route.

## Architecture (frontend, moteur principal)

```
frontend/src/
  engine/
    geometry.ts              polylignes 2D : projection, intersection de rayon perpendiculaire
    axisReference.ts         référence spatiale/PK partagée (station <-> PK)
    dxf/
      dxfReader.ts            lecteur DXF ASCII écrit à la main (TEXT/MTEXT, POLYLINE
                               ancienne génération vs LWPOLYLINE, table LAYER)
      dxfWriter.ts            écrivain DXF R12 (POINT, POLYLINE) pour l'export
      dxfCommon.ts            classification de textes (cluster par calque/couleur/hauteur/style)
      axisReferenceDxf.ts     axe depuis calibration PK / repères de profil séquentiels
      dxfExtractor.ts         extraction existant/projet, calques nommés OU heuristique géométrique
    ifc/
      webIfcClient.ts         wrapper web-ifc (ouverture modèle, lecture d'attributs,
                               géométrie par produit, conversion Y-up -> plan (x, y))
      ifcGeometry.ts          largeur par maillage : projection sur l'axe, regroupement en
                               "anneaux" transversaux par proximité de station
      ifcExtractor.ts         IfcPavement -> IfcPavementType (jamais déduit du nom seul) ->
                               (côté, élément) suggéré à faible confiance
      axisReferenceIfc.ts     IfcAlignment si présent, sinon axe PCA de secours (borné, voir
                               limites connues)
    export/
      excelExport.ts          classeur Données/Seuils/Résultats/Comparatif, ratios en
                               formules Excel natives (exceljs)
      dxfExport.ts            calques EXISTANT_*/PROJET_*/RATIOS_*/COMPARATIF_*
    pipeline.ts               orchestration : détecte DXF vs IFC par extension, axe partagé,
                               extraction existant + projet
    worker/
      extraction.worker.ts     exécute pipeline.ts hors du thread principal (fichiers réels
                               volumineux -> UI jamais bloquée)
      extractionClient.ts      wrapper Promise côté thread principal
  calculations/
    ratios.ts, comparison.ts  ratios de conformité et comparatif — mêmes fonctions que
                               backend/app/calculations, utilisées ici pour ne jamais dépendre
                               d'un aller-retour serveur après l'extraction
  components/, App.tsx        upload des 3 fichiers -> extraction -> Correction manuelle
                               (dropdowns côté/élément, badge de confiance) -> Résultats ->
                               Comparatif -> Seuils (éditables) -> Export
```

Chaque module JS/TS ci-dessus est un port direct du module Python équivalent
dans `backend/app/` (mêmes noms de fonctions, mêmes algorithmes) — les deux
implémentations sont vérifiées produire des résultats identiques sur les
mêmes fichiers de test (voir Tests plus bas).

### Convention d'axes IFC (Y-up vs Z-up)

`web-ifc` calcule la géométrie monde en **Y-up** (comme Three.js), alors que
l'IFC natif est en **Z-up**. `webIfcClient.ts` reconvertit chaque sommet à la
sortie du calcul de géométrie : `(x_webifc, y_webifc, z_webifc) → (x, -z, y)`
pour retrouver le plan (x, y) natif IFC utilisé partout ailleurs dans le
pipeline (même convention que `backend/app/extraction/ifc_geometry.py`, qui
lit directement les coordonnées Z-up d'`ifcopenshell`).

## Démarrage en local (développement)

```bash
cd frontend
npm install
npm run dev
```

### Tests

Validation manuelle (pas de suite automatisée côté frontend pour l'instant) :
chaque module du moteur a été vérifié en isolation avec `npx tsx` contre les
mêmes fixtures DXF/IFC synthétiques que `backend/tests/` (générées via
`ezdxf`/`ifcopenshell` en Python, consommées ici en TypeScript), puis le
pipeline complet a été validé dans un vrai navigateur (Playwright) : upload
DXF et IFC, extraction, correction manuelle par menu déroulant, résultats,
comparatif, téléchargement Excel (formules vérifiées avec `openpyxl`) et DXF
(relu avec `ezdxf`, lecteur indépendant strict).

## Limites connues / suite possible

- **Mode calque DXF** : les calques `AXE-*`/`COTE-*` sont lus entité par
  entité sans fusion de fragments multiples en une polyligne continue —
  suffisant pour les cotes textuelles (méthode principale en mode calque)
  mais à renforcer si l'on veut aussi exploiter géométriquement les lignes
  d'axe déclarées.
- **IFC sans `IfcAlignment`** : l'axe de secours est reconstruit par PCA +
  binning sur un nombre borné de sommets (500 produits / 200k sommets max —
  voir `ifc/axisReferenceIfc.ts` et `ifc/ifcGeometry.ts`), ce qui suit la
  courbure du tracé mais reste une approximation ; chercher aussi
  `IfcReferent`/propriétés custom de stationnement reste à faire si
  rencontré en pratique.
- **Export DXF "Existant"/"Projet"** : reconstruction en plan (vraies
  coordonnées x, y) à partir des points de bord proche/lointain que
  l'extracteur calcule déjà en projetant sur l'axe — disponible pour le mode
  heuristique DXF (lignes POLYLINE) et pour l'IFC, tous deux dotés d'une
  géométrie de bord réelle. Le mode calque DXF (cotes textuelles seules, pas
  de ligne de bord) ne peut pas produire cette reconstruction et retombe sur
  l'ancien diagramme schématique (PK, valeur) pour les bandes concernées. Le
  calque `AXE` est toujours ajouté en référence. **Export DXF
  "Ratios"/"Comparatif"** : reste un diagramme schématique (PK, valeur) dans
  tous les cas — ce sont des grandeurs dérivées (un ratio, un delta), pas une
  géométrie de bord en soi. Le backend Python (alternative) n'a pour l'instant
  que l'export schématique historique, pas cette reconstruction en plan.
- **Fichiers IFC très volumineux** : tout le parsing se fait dans la RAM du
  navigateur de l'utilisateur ; un fichier de plusieurs centaines de Mo peut
  être limité par la mémoire disponible sur sa machine plutôt que par un
  serveur, mais reste théoriquement possible selon sa machine.
- Le classeur Excel joint par l'utilisateur (`Analyses largeurs
  chaussées.xlsx`) a servi de référence de vocabulaire et de convention (les
  4 niveaux de confiance, l'ordre canonique des éléments par gabarit
  route/autoroute) ; il ne définit pas per se un format d'échange à
  reproduire au bit près.

## Alternative : backend Python + API REST

Une implémentation équivalente existe en Python (FastAPI, `ezdxf`,
`ifcopenshell`), utile si une extraction serveur plus robuste sur de très
gros fichiers IFC est préférable à un traitement 100% navigateur.

### Backend (`backend/app`)

- `models/domain.py` — vocabulaire partagé (ElementType, Side, StateKind,
  SourceMethod, WidthSample, Band, Threshold, RatioResult, ComparisonRow).
- `extraction/` — mêmes algorithmes que la version TypeScript ci-dessus :
  `geometry.py`, `axis_reference.py`, `dxf_common.py`/`dxf_extractor.py`,
  `ifc_geometry.py`/`ifc_extractor.py`.
- `calculations/ratios.py`, `comparison.py` — ratios de conformité et
  comparatif existant/projet avec interpolation PK.
- `export/excel_export.py`, `export/dxf_export.py` — mêmes exports que la
  version TypeScript (openpyxl / ezdxf au lieu d'exceljs / écrivain DXF
  maison).
- `api/` — API REST **stateless** : `POST /api/extract` (multipart, les 3
  fichiers) renvoie bandes + échantillons en une réponse ; correction
  manuelle, ratios et comparatif se calculent ensuite côté client (ou via
  les mêmes fonctions Python) ; `POST /api/export/excel` et
  `/api/export/dxf` prennent les données complètes dans le corps de la
  requête plutôt que de dépendre d'un état serveur — un redémarrage du
  conteneur ne perd donc rien en cours de session.

### Démarrage backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Distribution du backend

Deux options déjà configurées dans le dépôt :

- **Exécutable Windows autonome** (`.github/workflows/build-windows-exe.yml`,
  `backend/desktop_app.py`, `backend/desktop_app.spec`) : un `.exe` portable
  construit par GitHub Actions et publié sur la page Releases du dépôt —
  aucune installation, mais peut déclencher un avertissement Windows
  SmartScreen (fichier non signé) ou être bloqué par un antivirus
  d'entreprise strict.
- **Hébergement web gratuit sur Render** (`Dockerfile`, `render.yaml`) :
  Dashboard Render → New + → Blueprint → connecter le repo. Le plan Free met
  le service en veille après 15 min d'inactivité (redémarrage ~30-50s au
  réveil).

### Tests backend

```bash
cd backend
pip install -r requirements.txt
PYTHONPATH=. pytest tests/ -v
```

Couvre la géométrie de base, l'extraction DXF (calques et heuristique) et
IFC (fichiers synthétiques `ezdxf`/`ifcopenshell`), les calculs de
ratios/comparatif, l'export Excel/DXF, et le pipeline API complet via
`TestClient`.
