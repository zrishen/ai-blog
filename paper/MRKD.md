\hl{SCL produces three complementary feature spaces through prompt coupling and cosine alignment, refining the spatial structure of visual features and enhancing semantic-aware discriminability across all three feature types. However, no single feature space alone suffices for robust retrieval, since each implicitly captures valuable high-level semantic relationships both within and across modalities. As shown in Figure~3, the modality-specific space exhibits compact intra-modal distributions with small angular variations, while nearly orthogonal structures appear across modalities. In contrast, the modality-shared space reveals stable cross-modal correlations but relatively weaker intra-modal discriminability. To exploit these complementary cues, we use the modality-contextual features $f_{co}$ to absorb such implicit knowledge from the other two spaces, equipping it with both intra-modal compactness and cross-modal consistency. $f_{co}$ is supervised by the full modality-contextual prompt $C$, which fuses person-related and modality-related semantics, making it a holistic representation naturally suited for integrating diverse relational knowledge without introducing redundancy.}

To extract and transfer this implicit relational knowledge, we introduce MRKD based on Relational Knowledge Distillation (RKD) \cite{RKD_2019}. We employs hierarchical cosine angular distillation, which encodes angular relationships from different feature spaces into transferable knowledge representations. 

\hl{For a given mini-batch, we construct triplet samples \xbox{\((f^{i}, f^{j}, f^{k})\)}, where \xbox{\(f^{j}\)} serves as an anchor reference point. The positive or negative relationship is defined according to whether the samples come from the same modality. Specifically, a pair is considered positive if both samples belong to the same modality (both visible or both infrared), and negative if they belong to different modalities (one visible and one infrared). This modality-based definition allows us to explicitly capture intra-modality consistency and inter-modality discrepancy.}

We compute the cosine values of the angles formed in the feature representation space:



>Additionally, integrating modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships within and across modalities, leading to distortion of cross-modal high-level semantics during information integration, which further weakens the effectiveness of identity retrieval.

>MRKD adopts a semantic-guided hierarchical cosine angular distillation method, which integrates intra-modality semantic relationships from the modality-specific feature space and inter-modality semantic relationships from the modality-shared feature space into the modality-contextual space. In this way, MRKD explicitly alleviates cross-modal discrepancies and intra-modal interference while preserving discriminative representations.


















>Although SCL learns modality-specific, modality-shared, and modality-contextual features under the guidance of decoupled semantic prompts, these feature spaces contain complementary high-level semantic relationships that cannot be fully exploited by simple feature integration. 

As shown in Figure ref{fig:m2}, the modality-specific space exhibits compact intra-modal distributions with small angular variations, while nearly orthogonal structures appear across modalities. In contrast, the modality-shared space reveals stable cross-modal correlations but relatively weaker intra-modal discriminability.

>To integrate these complementary relationships without distorting cross-modal semantics, we introduce MRKD based on Relational Knowledge Distillation (RKD)~\cite{RKD_2019}. Specifically, MRKD employs hierarchical cosine angular distillation to transfer intra-modality semantic relationships from the modality-specific space and inter-modality semantic relationships from the modality-shared space into the modality-contextual space. This process enhances modality-contextual representations while alleviating cross-modal discrepancies and intra-modal interference.


**Other 2:** The description of the three feature spaces in Section 3-C is difficult to follow. In particular, **concepts such as angle, distribution, and discriminability require more concrete explanation**, ideally by explicitly defining positive and negative relationships.

**Other 3:** The **selection mechanism** of the three samples $f^i, f^j, f^k$ used in **MRKD** should be explicitly defined.

\hl{For a given mini-batch, we construct triplet samples \xbox{\((f^{i}, f^{j}, f^{k})\)}, where \xbox{\(f^{j}\)} serves as an anchor reference point. The positive or negative relationship is defined according to whether the samples come from the same modality. Specifically, a pair is considered positive if both samples belong to the same modality (both visible or both infrared), and negative if they belong to different modalities (one visible and one infrared). This modality-based definition allows us to explicitly capture intra-modality consistency and inter-modality discrepancy.}


Formally, for a mini-batch, we construct triplets $(f^i, f^j, f^k)$, where $f^j$ serves as the anchor. When both $f^i$ and $f^k$ share the same modality as the anchor, the resulting angle captures intra-modality consistency; when they belong to different modalities, the angle reflects inter-modality discrepancy. We compute the cosine of these angles in the feature space:


Formally, for a mini-batch, we construct triplets \xbox{$(f^i, f^j, f^k)$}, where \xbox{$f^j$} serves as the anchor. The angle formed by these three points encodes the geometric relationships in the feature space. Specifically, angles between features from the same modality reflect intra-modality structure, indicating how features of the same modality are oriented relative to each other, while angles involving features from different modalities capture inter-modality relationships, reflecting the alignment or discrepancy between modalities. We compute the cosine of these angles as:


Formally, for a mini-batch, we construct triplets $(f^i, f^j, f^k)$, where $f^j$ serves as the anchor. The angle formed by $f^i$, $f^j$, and $f^k$ encodes the geometric relationships in the feature space. Specifically, the angle between $f^i$ and $f^j$ relative to $f^k$ reflects intra-modality structure when $f^i$ and $f^k$ belong to the same modality, indicating how features of the same modality are oriented with respect to each other. When $f^i$ and $f^k$ come from different modalities, the angle captures inter-modality relationships, reflecting the alignment or discrepancy between modalities. We compute the cosine of these angles as:

>Formally, for a mini-batch, we construct triplets $(f^i, f^j, f^k)$, where $f^j$ serves as the anchor. The angle formed by $f^i$, $f^j$, and $f^k$ encodes the geometric relationships in the feature space. Specifically, when $f^i$ and $f^k$ belong to the same modality as the anchor $f^j$, the angle reflects intra-modality structure, showing how features of the same modality are oriented relative to each other. When $f^i$ and $f^k$ belong to different modalities relative to $f^j$, the angle captures inter-modality relationships, reflecting alignment or discrepancy between modalities. The cosine of these angles is computed as:


Formally, for a mini-batch, we construct triplets $(f^i, f^j, f^k)$, where $f^j$ serves as the anchor. 当i和k与锚点模态一致时, 角度关系表示intra-modality consistency, 当模态不一样是表述inter-modality discrepancy. We compute the cosine of angles formed in the feature space:


This ensures intra-modality consistency and inter-modality discrepancy are explicitly encoded. We compute the cosine of angles formed in the feature space:


We compute the cosine values of the angles formed in the feature representation space:


To integrate these complementary relationships without distorting cross-modal semantics, we propose MRKD. Through hierarchical cosine angular distillation, MRKD transfers intra-modality semantic relationships from the modality-specific space and inter-modality semantic relationships from the modality-shared space into the modality-contextual space. This process enhances modality-contextual representations while alleviating cross-modal discrepancies and intra-modal interference.


Although SCL learns modality-specific, modality-shared, and modality-contextual features under the guidance of decoupled semantic prompts, these feature spaces contain complementary high-level semantic relationships that cannot be fully exploited by simple feature integration.

As shown in Figure~\ref{fig:m2}, the modality-specific space exhibits compact intra-modal distributions with small angular variations, while nearly orthogonal structures appear across modalities. In contrast, the modality-shared space reveals stable cross-modal correlations but relatively weaker intra-modal discriminability.

To integrate these complementary relationships without distorting cross-modal semantics, we introduce MRKD based on Relational Knowledge Distillation (RKD)~\cite{RKD_2019}. Specifically, MRKD employs hierarchical cosine angular distillation to transfer intra-modality semantic relationships from the modality-specific space and inter-modality semantic relationships from the modality-shared space into the modality-contextual space. This process enhances modality-contextual representations while alleviating cross-modal discrepancies and intra-modal interference.



To integrate these complementary relationships without distorting cross-modal semantics, we propose MRKD, which transfers intra-modality semantic relationships from the modality-specific space and inter-modality semantic relationships from the modality-shared space into the modality-contextual space through hierarchical cosine angular distillation, thereby enhancing modality-contextual representations while alleviating cross-modal discrepancies and intra-modal interference.

To integrate these complementary relationships without distorting cross-modal semantics, we propose MRKD. It transfers intra-modality semantic relationships from the modality-specific space and inter-modality semantic relationships from the modality-shared space into the modality-contextual space through hierarchical cosine angular distillation, thereby enhancing modality-contextual representations while alleviating cross-modal discrepancies and intra-modal interference.


Although SCL learns modality-specific, modality-shared, and modality-contextual features under the guidance of decoupled semantic prompts, direct feature integration cannot fully exploit their complementary high-level semantic relationships. As illustrated in Fig.~3, the modality-specific space provides compact intra-modality structures and strong intra-modal discriminability, whereas the modality-shared space captures stable inter-modality correlations but shows weaker intra-modal discrimination. To integrate these complementary relationships without distorting cross-modal semantics, we propose Modality Relational Knowledge Distillation (MRKD). It transfers intra-modality semantic relationships from the modality-specific space and inter-modality semantic relationships from the modality-shared space into the modality-contextual space through hierarchical cosine angular distillation, thereby enhancing modality-contextual representations while alleviating cross-modal discrepancies and intra-modal interference.




As shown in Figure~3, the modality-specific space exhibits compact intra-modal distributions with small angular variations, while nearly orthogonal structures appear across modalities. In contrast, the modality-shared space reveals stable cross-modal correlations but relatively weaker intra-modal discriminability.

Specifically, the modality-specific feature space emphasizes intra-modality discriminability, while the modality-shared feature space encodes inter-modality consistency. 

Directly combining them may distort cross-modal semantic structures and introduce interference during information integration. 

To address this issue, we propose Modality Relational Knowledge Distillation (MRKD), which transfers intra-modality semantic relationships from the modality-specific space and inter-modality semantic relationships from the modality-shared space into the modality-contextual space through hierarchical cosine angular distillation. In this way, the modality-contextual representation can absorb complementary relational knowledge while alleviating cross-modal discrepancies and intra-modal interference.


Although SCL learns modality-specific, modality-shared, and modality-contextual features under the guidance of decoupled semantic prompts, these feature spaces contain complementary high-level semantic relationships that are difficult to fully exploit through direct feature integration. 

As illustrated in Figure~\ref{fig:m2}, the modality-specific space forms compact intra-modal distributions and maintains clear separation between visible and infrared modalities, reflecting strong intra-modality discriminability. In contrast, the modality-shared space captures stable inter-modality correlations, but provides relatively weaker intra-modal discrimination.

As illustrated in Figure \ref{fig:m2}, the modality-specific space emphasizes intra-modality discriminability, showing compact intra-modal distributions and separated cross-modal structures, while the modality-shared space captures inter-modality consistency but exhibits relatively weaker intra-modal discrimination. 

Directly combining these two spaces may distort cross-modal semantic structures and introduce interference during information integration. To address this issue, we propose Modality Relational Knowledge Distillation (MRKD), which transfers intra-modality semantic relationships from the modality-specific space and inter-modality semantic relationships from the modality-shared space into the modality-contextual space through hierarchical cosine angular distillation. In this way, the modality-contextual representation absorbs complementary relational knowledge while alleviating cross-modal discrepancies and intra-modal interference.


\begin{equation}
\begin{gathered}
  \cos \angle f^{i} f^{j} f^{k} = \langle e^{ij}, e^{kj} \rangle \\
  e^{ij} = \frac{f^i - f^j}{\|f^i - f^j\|_2}, \ 
  e^{kj} = \frac{f^k - f^j}{\|f^k - f^j\|_2}   
\end{gathered},
\end{equation}
where $\langle \cdot, \cdot \rangle$ denotes the vector inner product. The unit vectors $e^{ij}$ and $e^{kj}$ represent the pure directional variations from the reference $f^j$ to $f^i$ and $f^k$, respectively.


\hl{In this geometric formulation, the angle \xbox{\(\angle f^{i}f^{j}f^{k}\)} encodes the modality relationship among the three samples. For example, when \xbox{\(f^{i}\)} and \xbox{\(f^{j}\)} are from the same modality (positive pair) and \xbox{\(f^{k}\)} is from the opposite modality (negative pair) relative to \xbox{\(f^{j}\)}, the angle measures whether the intra-modality feature direction is structurally decoupled from the inter-modality feature direction. A near-orthogonal angle indicates that intra-modality variations and inter-modality discrepancies lie in independent directions, reflecting strong modality discriminability. Conversely, when all three samples come from the same modality (all positive), the angle delineates the compactness of intra-modality feature distributions; when they come from three different modality combinations (mixed), the angle reveals the cross-modality distribution structure.}


>For different feature spaces, we employ a hierarchical angular distillation strategy. In the modality-specific feature space, we extract angular relationships for triplets $(f^i_{sp}, f^j_{sp}, f^k_{sp})$, where $f^j_{sp}$ is the anchor. Triplets are considered positive if $f^i_{sp}$ and $f^k_{sp}$ belong to the same modality as the anchor, capturing intra-modality structure, and negative if they belong to a different modality, reflecting inter-modality relationships. The angular relations are defined as:

补充上对于负样本我们采用inter-modality forgetting，就是在蒸馏过程中放弃inter-modality关系，仅仅选择正样本进行蒸馏学习。


>For different feature spaces, we employ a hierarchical angular distillation strategy. In the modality-specific feature space, we extract angular relationships for triplets $(f^i_{sp}, f^j_{sp}, f^k_{sp})$, where $f^j_{sp}$ is the anchor. Triplets are considered positive if $f^i_{sp}$ and $f^k_{sp}$ belong to the same modality as the anchor, capturing intra-modality structure. Triplets are considered negative if they involve a different modality, reflecting inter-modality relationships; during distillation, these negative triplets are ignored through an inter-modality forgetting, and only positive triplets are used for learning. The angular relations are defined as:


For different feature spaces, we employ a hierarchical angular distillation strategy. In the modality-specific feature space, we extract the angular relationships within each modality and enforce inter-modality forgetting, \hl{deliberately discarding cross-modal angular relationships during distillation. This prevents modality-specific features from being contaminated by cross-modal inconsistencies and preserves pure intra-modal discriminative cues.} Accordingly, intra-modal angular relation pairs are defined as follows:

For different feature spaces, we employ a hierarchical angular distillation strategy. In the modality-specific feature space, we extract angular relationships for triplets $(f^i, f^j, f^k)$, where $f^j$ is the anchor. Triplets are considered positive if $f^i$ and $f^k$ belong to the same modality as the anchor, capturing intra-modality structure, and negative if they belong to a different modality, reflecting inter-modality relationships. The angular relations are defined as:


For different feature spaces, we employ a hierarchical angular distillation strategy. In the modality-specific feature space, we extract the angular relationships within each modality and enforce inter-modality forgetting, \hl{deliberately discarding cross-modal angular relationships during distillation. This prevents modality-specific features from being contaminated by cross-modal inconsistencies and preserves pure intra-modal discriminative cues.} Accordingly, intra-modal angular relation pairs are defined as follows:

\begin{equation}
\begin{split}
\mathcal{R}_{sp_v}^{ijk}=[\cos \angle f^{i}_{sp_v}f^{j}_{sp_v}f^{k}_{sp_v},\cos \angle f^{i}_{co_v}f^{j}_{co_v}f^{k}_{co_v}] \\
\mathcal{R}_{sp_r}^{ijk}=[\cos \angle f^{i}_{sp_r}f^{j}_{sp_r}f^{k}_{sp_r},\cos \angle f^{i}_{co_r}f^{j}_{co_r}f^{k}_{co_r}]    
\end{split}.
\end{equation}




The relational knowledge distillation loss for the modality-specific feature space is:
\begin{equation}
\mathcal{L}_{r k d}^{sp}=\sum_{\left(i, j, k\right) \in B} l_{\delta}\left(\mathcal{R}_{sp_v}^{ijk}\right)+\sum_{\left(i, j, k\right) \in B} l_{\delta}\left(\mathcal{R}_{sp_r}^{ijk}\right),
\end{equation}
where $l_{\delta}$ denotes the Huber loss function. 

Conversely, for the modality-shared feature space, we enforce intra-modality forgetting. The cross-modal angular relation distillation pairs are formulated as:

Conversely, in the modality-shared feature space, we enforce intra-modality forgetting. Here, angular relationships within the same modality are ignored during distillation to focus on cross-modal consistency. Only triplets involving different modalities relative to the anchor are used, capturing inter-modality relationships. The cross-modal angular relation distillation pairs are formulated as:

>Conversely, in the modality-shared feature space, Triplets $(f^i_{sh}, f^j_{sh}, f^k_{sh})$ are considered positive if $f^i_{sh}$ and $f^k_{sh}$ belong to a different modality than the anchor $f^j_{sh}$, capturing inter-modality relationships. Triplets from the same modality as the anchor are treated as negative and are ignored during distillation via intra-modality forgetting. The cross-modal angular relation distillation pairs are defined as:

Conversely, in the modality-shared feature space, triplets $(f^i_{sh}, f^j_{sh}, f^k_{sh})$ are considered positive if $f^i_{sh}$ and $f^k_{sh}$ belong to a different modality than the anchor $f^j_{sh}$, capturing inter-modality relationships. Triplets from the same modality as the anchor are treated as negative and are ignored during distillation. Here, we apply intra-modality forgetting. The cross-modal angular relation distillation pairs are defined as:


Conversely, in the modality-shared feature space, we enforce intra-modality forgetting to focus on cross-modal relationships. Triplets $(f^i_{sh}, f^j_{sh}, f^k_{sh})$ are treated as positive when $f^i_{sh}$ and $f^k_{sh}$ come from a different modality than the anchor $f^j_{sh}$, capturing inter-modality structure. Triplets with $f^i_{sh}$ and $f^k_{sh}$ from the same modality as the anchor are considered negative and ignored during distillation. The corresponding cross-modal angular relation distillation pairs are defined as:

\begin{equation}
\begin{split}
\mathcal{R}_{sh_v}^{ijk}=[\cos \angle f^{i}_{sh_r} f^{j}_{sh_v} f^{k}_{sh_r},\cos \angle f^{i}_{co_r} f^{j}_{co_v} f^{k}_{co_r}] \\    
\mathcal{R}_{sh_r}^{ijk}=[\cos \angle f^{i}_{sh_v} f^{j}_{sh_r} f^{k}_{sh_v},\cos \angle f^{i}_{co_v} f^{j}_{co_r} f^{k}_{co_v}]
\end{split}.
\end{equation}

The relational knowledge distillation loss for the modality-shared feature space is:
\begin{equation}
\mathcal{L}_{r k d}^{sh}=\sum_{\left(i, j, k\right) \in B} l_{\delta}\left(\mathcal{R}_{sh}^v\right)+\sum_{\left(i, j, k\right) \in B} l_{\delta}\left(\mathcal{R}_{sh}^r\right).
\end{equation}

By combining the distillation objectives of modality-specific and modality-shared feature spaces, the complete loss in MRKD is:
\begin{equation}
\mathcal{L}_{mrkd}=\mathcal{L}_{r k d}^{sp}+\mathcal{L}_{rkd}^{sh}.
\label{eq:23}
\end{equation}