# Analyse gabarit chaussée

Outil web pour automatiser l'analyse de largeurs de chaussée et de BAU
(bande d'arrêt d'urgence) le long d'un tracé routier, à partir de fichiers
DXF ou IFC (cadwork/Lexocad), avec comparatif existant / projet et export
Excel (formules live) et DXF (calques structurés).

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

## Architecture

```
backend/    API Python (FastAPI) : extraction, calculs, export
frontend/   SPA React + TypeScript (Vite) : upload, correction, résultats, export
```

### Backend (`backend/app`)

- `models/domain.py` — vocabulaire partagé (ElementType, Side, StateKind,
  SourceMethod, WidthSample, Band, Threshold, RatioResult, ComparisonRow).
  Tout le pipeline (DXF, IFC, calculs, export) ne manipule que ces types :
  DXF et IFC sont interchangeables une fois l'extraction faite.
- `extraction/`
  - `geometry.py` — géométrie 2D de polylignes (projection, intersection de
    rayon perpendiculaire), utilisée par l'axe de référence et le mode
    heuristique DXF.
  - `axis_reference.py` — construit la référence spatiale/PK partagée à
    partir du fichier "Axes + profils" (DXF : polyligne d'axe ancienne
    génération + calibration par labels PK ou repères de profil séquentiels ;
    IFC : `IfcAlignment` si présent, sinon axe PCA de secours).
  - `dxf_common.py`, `dxf_extractor.py` — extraction DXF existant/projet,
    deux méthodes auto-détectées :
    - **Calques nommés** (idéal) : layers `AXE-*`/`COTE-*`, cotes textuelles
      lues directement, confiance maximale.
    - **Heuristique géométrique** : identification des vraies polylignes
      d'axe (entités `POLYLINE`, jamais les `LWPOLYLINE` fragmentées),
      ordonnancement gauche→droite par rapport à l'axe de référence, largeur
      = intersection rayon perpendiculaire à chaque station. La
      classification sémantique (BAU/Voie/...) de chaque bande reste une
      **suggestion à faible confiance** (gabarit "route" ou "autoroute"
      configurable) — jamais déduite de la seule magnitude numérique,
      conformément au risque documenté (élargissements ponctuels, zones
      d'insertion).
  - `ifc_geometry.py`, `ifc_extractor.py` — extraction IFC :
    `IfcRoad → IfcRoadPart → IfcPavement`, typage via `IfcPavementType`
    (jamais déduit du nom seul — toujours proposé à confirmation), largeur
    calculée depuis le maillage (`ifcopenshell.geom`) en projetant les
    sommets sur l'axe de référence partagé et en regroupant les sommets par
    proximité de station ("anneaux" transversaux), largeur = étendue latérale
    de l'anneau (robuste aux sommets dupliqués d'un solide à épaisseur).
- `calculations/ratios.py`, `comparison.py` — ratios de conformité (%
  sous/entre/au-dessus des seuils, profils incomplets naturellement exclus)
  et comparatif existant/projet avec interpolation PK et statut
  Amélioré/Inchangé/Dégradé.
- `export/excel_export.py` — classeur Données / Seuils / Résultats /
  Comparatif ; seules les valeurs brutes sont écrites, tous les ratios et le
  comparatif (delta, statut) sont des **formules Excel natives**
  (`COUNTIFS`, `COUNT`, `IF`, `IFERROR`) référençant l'onglet Seuils, plus
  mise en forme conditionnelle sur le statut.
- `export/dxf_export.py` — export DXF en calques structurés
  `EXISTANT_*`/`PROJET_*`/`RATIOS_*`/`COMPARATIF_*` par côté/élément/état,
  avec choix Points et/ou Polylignes. Il s'agit d'un diagramme schématique
  largeur-vs-PK (le pipeline ne conserve que des largeurs scalaires après
  extraction, pas la géométrie de bord complète).
- `api/` — `store.py` (état projet en mémoire), `pipeline.py` (orchestration
  extraction), `routes.py` (endpoints REST).

### Frontend (`frontend/src`)

SPA à onglets : upload des 3 fichiers → lancement extraction (choix du
gabarit route/autoroute) → **Correction manuelle** (tableau des bandes
détectées, dropdowns côté/élément, badge de confiance coloré selon la même
légende que le classeur Excel de référence : Entrée manuelle / Menu déroulant
/ Récupération entrées / Récupération automatique) → **Résultats** (ratios)
→ **Comparatif** → **Seuils** (éditables) → **Export** (Excel, DXF avec
options Points/Polylignes et calques à inclure).

## Distribution : exécutable Windows autonome (recommandé)

Pas de serveur, pas de compte à créer, pas d'installateur (donc pas de
blocage IT) : un `.exe` portable, construit automatiquement par GitHub
Actions et publié sur la page **Releases** du dépôt.

1. Pousser un tag de version déclenche la construction :
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
2. GitHub Actions (`.github/workflows/build-windows-exe.yml`) compile le
   frontend, empaquette le backend (FastAPI + `ezdxf` + `ifcopenshell`) avec
   PyInstaller en un seul fichier `AnalyseGabaritChaussee.exe`, et l'attache
   automatiquement à une Release GitHub.
3. Chacun télécharge ce `.exe` depuis la page Releases et le partage comme un
   simple lien de téléchargement à ses collègues.
4. Double-clic → une fenêtre console s'ouvre (moteur en cours d'exécution) et
   le navigateur par défaut s'ouvre automatiquement sur l'outil. Fermer la
   fenêtre arrête l'outil. Rien n'est installé sur la machine.

**Point d'attention** : un `.exe` non signé numériquement peut déclencher un
avertissement Windows SmartScreen ("Windows a protégé votre ordinateur") ou
être mis en quarantaine par un antivirus d'entreprise strict — c'est un faux
positif classique pour tout exécutable empaqueté par PyInstaller, pas un
signe de problème réel. La signature de code a un coût et nécessite une
identité d'éditeur ; elle n'est pas mise en place ici pour rester à coût
nul. Si ton service informatique bloque malgré tout ce fichier, il faudra
soit une exception IT, soit passer à l'option d'hébergement web ci-dessous.

## Alternative : lien web hébergé (Render, gratuit)

Le dépôt contient aussi un `Dockerfile` (frontend compilé + backend Python
dans une seule image) et un `render.yaml` (Render Blueprint) pour un
déploiement en un clic sur [Render](https://render.com), plan **Free**, si
un vrai lien web (plutôt qu'un fichier à télécharger) est préférable :

1. Crée un compte Render (gratuit).
2. Dashboard → **New +** → **Blueprint** → connecte le repo GitHub
   `Analyse-gabarit-chauss-e-`, branche `claude/road-analysis-dxf-ifc-abbi3t`
   (ou `main` une fois mergée).
3. Render détecte `render.yaml` et build/déploie automatiquement.
4. Tu obtiens une URL publique unique (`https://analyse-gabarit-chaussee.onrender.com`)
   qui sert à la fois l'application et l'API — aucune configuration
   supplémentaire (le backend sert le frontend compilé sur la même origine).

Le plan Free de Render met le service en veille après 15 min d'inactivité ;
le premier chargement après une veille prend ~30-50s le temps qu'il redémarre
— normal, gratuit, pas de carte bancaire requise.

## Démarrage en local (développement)

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # ajuster VITE_API_BASE si besoin
npm run dev
```

### Tests

```bash
cd backend
pip install -r requirements.txt
PYTHONPATH=. pytest tests/ -v
```

Les tests couvrent la géométrie de base, l'extraction DXF (calques et
heuristique) et IFC (avec fichiers synthétiques générés par `ezdxf` et
`ifcopenshell`), les calculs de ratios/comparatif, l'export Excel/DXF, et
le pipeline API complet (upload → extraction → correction → résultats →
export) via `TestClient`. Le flux a aussi été validé manuellement dans un
navigateur réel (Playwright) : upload, extraction, correction par menu
déroulant, résultats, comparatif, téléchargement Excel et DXF.

## Limites connues / suite possible

- **Aucune base de données** : l'état projet vit en mémoire côté serveur
  (MVP). À remplacer par un stockage persistant pour un usage multi-session.
- **Mode calque DXF** : les limites de calques (`AXE-*`/`COTE-*`) sont lues
  entité par entité sans fusion de fragments `LWPOLYLINE multiples en une
  polyligne continue — suffisant pour les cotes textuelles (méthode
  principale en mode calque) mais à renforcer si l'on veut aussi exploiter
  géométriquement les lignes d'axe déclarées.
- **IFC sans `IfcAlignment`** : l'axe de secours est reconstruit par PCA +
  binning, ce qui suit la courbure du tracé mais reste une approximation ;
  chercher aussi `IfcReferent`/propriétés custom de stationnement reste à
  faire si rencontré en pratique.
- **Export DXF "Ratios"/"Comparatif"** : diagramme schématique (PK, valeur)
  et non une reconstruction géométrique en plan — cohérent avec le fait que
  le pipeline ne conserve que des largeurs scalaires après extraction.
- Le classeur Excel joint par l'utilisateur (`Analyses largeurs
  chaussées.xlsx`) a servi de référence de vocabulaire et de convention (les
  4 niveaux de confiance, l'ordre canonique des éléments par gabarit
  route/autoroute) ; il ne définit pas per se un format d'échange à
  reproduire au bit près.
