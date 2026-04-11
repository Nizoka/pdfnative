# Revue Architecturale Impitoyable

Périmètre analysé : `src/core`, `src/fonts`, `src/shaping`, `src/types`, `src/worker`, `src/index.ts`, `scripts/`.

## Défauts Prioritaires

### 1. `CRITICAL` — Duplication structurelle massive entre les deux builders

Références : [src/core/pdf-builder.ts#L247](src/core/pdf-builder.ts#L247), [src/core/pdf-builder.ts#L512](src/core/pdf-builder.ts#L512), [src/core/pdf-document.ts#L932](src/core/pdf-document.ts#L932), [src/core/pdf-document.ts#L1278](src/core/pdf-document.ts#L1278)

Défaut :
Les deux points d’entrée principaux réimplémentent la même mécanique d’assemblage PDF : gestion des objets indirects, `emitObj`, `emitStreamObj`, compression, chiffrement, calcul des ressources, émission des pages, catalog, trailer, xref. La différence métier réelle est le rendu du contenu, pas l’assemblage du fichier. Le dépôt paie pourtant cette mécanique deux fois.

Conséquence architecturale :
Chaque évolution transversale augmente le coût de maintenance en double et crée un risque de divergence silencieuse entre les deux builders. La duplication est située au pire endroit possible : le cœur binaire et normatif du produit.

Refactorisation proposée :
Extraire un module `pdf-assembler.ts` responsable uniquement de l’assemblage PDF à partir d’un modèle intermédiaire stable, par exemple `PdfAssemblyPlan`. Les builders ne devraient produire que des pages rendues, des ressources et des métadonnées, puis déléguer l’émission du binaire à un assembleur unique.

### 2. `CRITICAL` — `pdf-document.ts` et `pdf-builder.ts` sont des god modules

Références : [src/core/pdf-builder.ts#L65](src/core/pdf-builder.ts#L65), [src/core/pdf-builder.ts#L247](src/core/pdf-builder.ts#L247), [src/core/pdf-document.ts#L512](src/core/pdf-document.ts#L512), [src/core/pdf-document.ts#L767](src/core/pdf-document.ts#L767), [src/core/pdf-document.ts#L868](src/core/pdf-document.ts#L868), [src/core/pdf-document.ts#L1004](src/core/pdf-document.ts#L1004)

Défaut :
Ces modules cumulent simultanément les responsabilités suivantes : validation d’entrée, résolution du layout, pagination, rendu du contenu, gestion des tags PDF/UA, intégration PDF/A, intégration chiffrement, intégration compression, intégration watermark, gestion des annotations, gestion des destinations internes, assemblage des objets PDF.

Conséquence architecturale :
Le changement d’une règle de pagination, d’une contrainte PDF/A ou d’un détail de watermark force à toucher des fonctions monstrueuses qui n’ont aucune frontière conceptuelle nette. La complexité cyclomatique est artificiellement gonflée par l’empilement de préoccupations hétérogènes.

Refactorisation proposée :
Découper en couches explicites.

- `input-validation`
- `layout-resolution`
- `content-renderers`
- `pagination-planner`
- `resource-planner`
- `pdf-assembler`

Le builder doit devenir un orchestrateur mince, pas un conteneur de toutes les politiques du système.

### 3. `HIGH` — Le flux de dépendances annoncé est violé par `fonts/encoding.ts`

Références : [src/fonts/encoding.ts#L8](src/fonts/encoding.ts#L8), [src/fonts/encoding.ts#L160](src/fonts/encoding.ts#L160), [src/fonts/encoding.ts#L193](src/fonts/encoding.ts#L193), [src/fonts/encoding.ts#L271](src/fonts/encoding.ts#L271)

Défaut :
`encoding.ts` importe directement `thai-shaper`, `arabic-shaper`, `bidi`, `multi-font`. Ce module n’est plus un encodeur ; il devient une chaîne complète de rendu textuel. Le sous-système `fonts` dépend donc de `shaping`, alors que la séparation déclarée du dépôt suggère l’inverse.

Conséquence architecturale :
Le module concentre l’encodage WinAnsi, les métriques Helvetica, la segmentation arabe, la logique de fallback, la composition multi-font, le BiDi et le tracking des glyphes utilisés. C’est une violation nette de SRP et de DIP. Toute évolution de shaping casse potentiellement le sous-système de fonts.

Refactorisation proposée :
Transformer `encoding.ts` en composition explicite de services injectés.

- `winansi-encoder.ts`
- `glyph-widths.ts`
- `font-fallback.ts`
- `text-shaping-pipeline.ts`
- `encoding-context.ts`

Le pipeline de shaping doit être injecté dans l’encodeur ou orchestré par le niveau `core`, pas hardcodé dans `fonts`.

### 4. `HIGH` — `src/index.ts` expose massivement des détails d’implémentation internes

Références : [src/index.ts#L115](src/index.ts#L115), [src/index.ts#L117](src/index.ts#L117), [src/index.ts#L118](src/index.ts#L118), [src/index.ts#L132](src/index.ts#L132), [src/index.ts#L141](src/index.ts#L141), [src/index.ts#L149](src/index.ts#L149), [src/index.ts#L163](src/index.ts#L163)

Défaut :
La surface publique exporte des primitives de bas niveau qui relèvent clairement de l’implémentation interne : opérateurs texte PDF, primitives de compression, helpers d’assemblage tagué, primitives cryptographiques, encodeurs, parseurs, helpers de flux binaires.

Conséquence architecturale :
Le package public se retrouve couplé à ses propres internals. Chaque refactor interne devient potentiellement un breaking change. L’API publique est surdimensionnée, confuse, difficile à documenter et difficile à stabiliser.

Refactorisation proposée :
Réduire l’API publique à trois catégories.

- builders métier
- worker API
- types métier

Déplacer le reste vers un namespace `internal` non exporté publiquement, ou à minima vers des exports marqués `@internal` et exclus du contrat de compatibilité.

### 5. `HIGH` — `PdfLayoutOptions` est un mega-options bag qui concentre trop de politiques

Références : [src/types/pdf-types.ts#L176](src/types/pdf-types.ts#L176), [src/types/pdf-types.ts#L305](src/types/pdf-types.ts#L305), [src/types/pdf-types.ts#L365](src/types/pdf-types.ts#L365), [src/types/pdf-document-types.ts#L127](src/types/pdf-document-types.ts#L127), [src/types/pdf-document-types.ts#L133](src/types/pdf-document-types.ts#L133), [src/core/pdf-document.ts#L944](src/core/pdf-document.ts#L944)

Défaut :
`PdfLayoutOptions` mélange géométrie de page, palette, colonnes, tailles de fontes, conformité PDF/A, chiffrement, compression, templates header/footer et watermark. `DocumentParams` ajoute en plus un `layout` interne alors que `buildDocumentPDF` accepte aussi `layoutOptions` en argument, ce que `buildPDF` ne fait pas via `PdfParams`.

Conséquence architecturale :
Le système mélange configuration visuelle, stratégie documentaire, sécurité et conformité dans un seul sac de propriétés. L’API devient incohérente entre builders, et chaque nouvelle feature grossit le même type au lieu de s’inscrire dans une frontière dédiée.

Refactorisation proposée :
Scinder les options.

- `PageGeometryOptions`
- `TypographyOptions`
- `ColorOptions`
- `ComplianceOptions`
- `SecurityOptions`
- `HeaderFooterOptions`
- `WatermarkOptions`

Puis unifier le contrat des builders : soit les options sont toujours séparées, soit elles sont toujours incluses dans les params, mais pas les deux selon le builder.

### 6. `HIGH` — Le worker est couplé au builder tabulaire uniquement

Références : [src/worker/worker-api.ts#L8](src/worker/worker-api.ts#L8), [src/worker/worker-api.ts#L78](src/worker/worker-api.ts#L78), [src/worker/worker-api.ts#L89](src/worker/worker-api.ts#L89)

Défaut :
Le worker appelle directement `buildPDFBytes`. Il n’existe aucune abstraction de génération qui permettrait d’utiliser le même canal pour `buildDocumentPDFBytes` ou un futur builder.

Conséquence architecturale :
Le support off-thread est attaché à une implémentation concrète au lieu d’être attaché à une capacité. L’extension à d’autres types de documents impliquera une duplication de worker API ou une rupture de contrat.

Refactorisation proposée :
Introduire un protocole de génération sérialisable côté worker.

- `kind: 'table' | 'document' | ...`
- payload spécialisé
- stratégie de dispatch unique dans le worker

Le worker doit dépendre d’un registre de générateurs, pas d’un builder concret.

### 7. `HIGH` — `pdf-tags.ts` mélange cinq sous-domaines fortement spécialisés

Références : [src/core/pdf-tags.ts#L17](src/core/pdf-tags.ts#L17), [src/core/pdf-tags.ts#L92](src/core/pdf-tags.ts#L92), [src/core/pdf-tags.ts#L123](src/core/pdf-tags.ts#L123), [src/core/pdf-tags.ts#L219](src/core/pdf-tags.ts#L219), [src/core/pdf-tags.ts#L271](src/core/pdf-tags.ts#L271), [src/core/pdf-tags.ts#L433](src/core/pdf-tags.ts#L433)

Défaut :
Le même fichier porte les opérateurs de marked content, l’allocateur de MCID, la construction de l’arbre de structure, la génération XMP, la génération du profil ICC sRGB et la résolution de configuration PDF/A.

Conséquence architecturale :
La moindre évolution de conformité mélange accessibilité, métadonnées, color management et logique d’arbre structurel. Le module est trop fragile pour son niveau de criticité normative.

Refactorisation proposée :
Scinder en sous-modules strictement dédiés.

- `pdf-marked-content.ts`
- `pdf-structure-tree.ts`
- `pdf-xmp.ts`
- `pdf-icc.ts`
- `pdfa-config.ts`

### 8. `MEDIUM` — Taxonomie des scripts dupliquée à plusieurs endroits

Références : [src/shaping/script-detect.ts#L11](src/shaping/script-detect.ts#L11), [src/shaping/script-detect.ts#L23](src/shaping/script-detect.ts#L23), [src/shaping/script-detect.ts#L78](src/shaping/script-detect.ts#L78), [src/fonts/encoding.ts#L145](src/fonts/encoding.ts#L145), [src/shaping/multi-font.ts#L26](src/shaping/multi-font.ts#L26)

Défaut :
La connaissance des plages Unicode et des langues préférées est répliquée dans `needsUnicodeFont`, `detectFallbackLangs`, `detectCharLang`, `isArabicCodepoint`, plus indirectement dans le routage multi-font.

Conséquence architecturale :
L’ajout d’un script ou l’ajustement d’une plage Unicode impose des modifications synchronisées dans plusieurs fichiers. Le modèle de connaissance métier est diffus et fragile.

Refactorisation proposée :
Centraliser le registre des scripts dans une seule source de vérité, par exemple `script-registry.ts`, avec métadonnées normalisées.

- plages Unicode
- langue préférée
- besoin ou non de shaping
- besoin ou non de font Unicode
- priorité de fallback

Les autres modules doivent consommer ce registre, pas réimplémenter la taxonomie.

### 9. `MEDIUM` — `pdf-text.ts` souffre d’une explosion combinatoire d’API

Références : [src/index.ts#L118](src/index.ts#L118)

Défaut :
Le moteur texte expose `txt`, `txtR`, `txtC`, `txtTagged`, `txtRTagged`, `txtCTagged`, `txtShaped`. L’alignement et le tagging créent une multiplication de variantes au lieu d’un modèle paramétrable.

Conséquence architecturale :
Chaque nouveau mode de rendu se traduit par une nouvelle famille de fonctions. L’API est mécaniquement redondante et pousse la duplication vers les appelants.

Refactorisation proposée :
Remplacer ces variantes par un `renderText()` piloté par une configuration unique.

- alignement
- tagging
- `mcid`
- mode shaped ou non

Les helpers spécialisés peuvent subsister localement comme wrappers internes, mais pas comme surface principale.

### 10. `MEDIUM` — `pdf-image.ts` fusionne parsing binaire et sérialisation PDF

Références : [src/core/pdf-image.ts#L1](src/core/pdf-image.ts#L1)

Défaut :
Le module parse JPEG/PNG, contient des helpers binaires, décide des compromis de support alpha et construit ensuite directement les XObjects PDF. Le commentaire interne sur le cas PNG alpha montre lui-même une frontière floue entre responsabilités techniques et décisions de format PDF.

Conséquence architecturale :
Ajouter un nouveau format ou améliorer la stratégie alpha oblige à toucher un module qui mêle extraction d’informations, contraintes de parsing et assemblage PDF.

Refactorisation proposée :
Séparer nettement.

- `image-parsers/` pour la compréhension des formats binaires
- `pdf-image-xobject.ts` pour la traduction vers les objets PDF
- `image-capabilities.ts` pour les stratégies supportées et refusées

### 11. `MEDIUM` — `scripts/` duplique le modèle métier et contourne la surface publique

Références : [scripts/helpers/types.ts#L8](scripts/helpers/types.ts#L8), [scripts/helpers/types.ts#L35](scripts/helpers/types.ts#L35), [scripts/generators/financial-statements.ts#L5](scripts/generators/financial-statements.ts#L5), [scripts/generators/document-builder.ts#L6](scripts/generators/document-builder.ts#L6)

Défaut :
Les scripts redéfinissent des shapes métier (`LangSample`, `DocSample`, etc.) au lieu de composer les types du domaine principal. Ils importent en plus directement des modules internes (`src/core/...`) au lieu de s’appuyer sur une façade interne stable ou sur l’entrée de package.

Conséquence architecturale :
Le dépôt maintient deux surfaces d’intégration.

- l’API du package
- l’API implicite des modules internes

Les scripts deviennent sensibles à chaque refactor interne. La duplication de types ouvre la porte à la dérive sémantique et à l’incohérence de mutabilité.

Refactorisation proposée :
Créer une façade `scripts/runtime.ts` ou `src/internal-samples.ts` qui réexporte explicitement ce que les scripts ont le droit d’utiliser. Remplacer les types dupliqués par des compositions de types de `src/types`.

### 12. `MEDIUM` — L’orchestrateur de génération d’échantillons est fermé à l’extension

Références : [scripts/generate-samples.ts#L24](scripts/generate-samples.ts#L24), [scripts/generate-samples.ts#L31](scripts/generate-samples.ts#L31), [scripts/generate-samples.ts#L46](scripts/generate-samples.ts#L46)

Défaut :
`generate-samples.ts` importe chaque générateur individuellement et orchestre leur exécution via une séquence hardcodée d’appels `await`. Ajouter une nouvelle famille d’échantillons impose de modifier l’orchestrateur central.

Conséquence architecturale :
Le module viole OCP. La composition du pipeline n’est pas déclarative. L’ordre et le registre des générateurs ne sont pas modélisés.

Refactorisation proposée :
Déclarer un registre de générateurs.

- identifiant
- priorité d’exécution
- description
- fonction `generate`

L’orchestrateur ne doit plus connaître chaque module individuellement.

### 13. `MEDIUM` — `scripts/generators/document-builder.ts` est lui-même un god module de démonstration

Références : [scripts/generators/document-builder.ts#L13](scripts/generators/document-builder.ts#L13), [scripts/generators/document-builder.ts#L203](scripts/generators/document-builder.ts#L203), [scripts/generators/document-builder.ts#L267](scripts/generators/document-builder.ts#L267)

Défaut :
Ce générateur embarque un pipeline principal puis plusieurs sous-générateurs ad hoc (`generateReport`, `generateContract`, `generateChineseCatalog`, `generateThaiDoc`, `generateShowcase`) dans le même fichier. Il mélange orchestration, jeu de données, scénarios de démonstration et logique de sortie.

Conséquence architecturale :
Le module grossit sans limite. Les scénarios ne sont ni indexables ni réutilisables proprement. La maintenance des samples devient un système parallèle mal structuré.

Refactorisation proposée :
Passer à une architecture par scénarios, un fichier par sample complexe, enregistrés dans un manifeste commun.

### 14. `LOW` — Primitive obsession et constantes globales rigides dans le layout

Références : [src/core/pdf-layout.ts](src/core/pdf-layout.ts), [src/types/pdf-types.ts#L176](src/types/pdf-types.ts#L176)

Défaut :
Les hauteurs, tailles et largeurs par défaut sont disséminées en constantes globales et en objets littéraux, avec un couplage implicite à la pagination. Le layout reste piloté par des primitives dispersées plutôt que par un objet de configuration cohérent.

Conséquence architecturale :
Toute variation de style ou de densité de page est coûteuse, car elle doit être propagée mentalement dans tout le pipeline de calcul de hauteur disponible.

Refactorisation proposée :
Introduire des presets de layout structurés avec section `spacing`, `typography`, `palette`, `table`, `headerFooter`, puis calculer les métriques dérivées depuis ces presets.

## Modules Centralisateurs à Démanteler en Premier

### `src/core/pdf-document.ts`

Références : [src/core/pdf-document.ts#L932](src/core/pdf-document.ts#L932), [src/core/pdf-document.ts#L1004](src/core/pdf-document.ts#L1004), [src/core/pdf-document.ts#L1278](src/core/pdf-document.ts#L1278)

Pourquoi il est toxique architecturalement :
Il centralise le parsing des blocks, la pagination multi-pass, le rendu, les annotations, les destinations internes, le watermark, le chiffrement, la compression et l’assemblage PDF.

### `src/core/pdf-builder.ts`

Références : [src/core/pdf-builder.ts#L247](src/core/pdf-builder.ts#L247), [src/core/pdf-builder.ts#L512](src/core/pdf-builder.ts#L512)

Pourquoi il est toxique architecturalement :
Il duplique l’assembleur, fusionne rendu tabulaire et conformité documentaire, et reste couplé à trop de sous-systèmes.

### `src/fonts/encoding.ts`

Références : [src/fonts/encoding.ts#L23](src/fonts/encoding.ts#L23), [src/fonts/encoding.ts#L193](src/fonts/encoding.ts#L193), [src/fonts/encoding.ts#L271](src/fonts/encoding.ts#L271)

Pourquoi il est toxique architecturalement :
Il concentre toute la logique transversale du texte alors qu’il devrait n’être qu’un encodeur ou un composant du pipeline.

### `src/core/pdf-tags.ts`

Références : [src/core/pdf-tags.ts#L92](src/core/pdf-tags.ts#L92), [src/core/pdf-tags.ts#L219](src/core/pdf-tags.ts#L219), [src/core/pdf-tags.ts#L271](src/core/pdf-tags.ts#L271), [src/core/pdf-tags.ts#L433](src/core/pdf-tags.ts#L433)

Pourquoi il est toxique architecturalement :
Il agrège plusieurs domaines normatifs qui devraient évoluer séparément.

## Ordre de Refactorisation Recommandé

1. Extraire un assembleur PDF unique partagé par les deux builders.
2. Découper `pdf-document.ts` en pipeline `render -> paginate -> assemble`.
3. Réduire `encoding.ts` à une composition de services injectables.
4. Réduire drastiquement la surface publique de `src/index.ts`.
5. Scinder `PdfLayoutOptions` en options spécialisées et unifier le contrat des builders.
6. Centraliser le registre des scripts Unicode.
7. Créer une façade stable pour `scripts/` afin d’arrêter le couplage direct aux modules internes.