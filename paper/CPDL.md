This section introduces the proposed Modality Decoupling and Coupling Network (MDCN) and details its key components. As shown in Figure \ref{fig:2}, a pretrained CLIP \cite{CLIP_2021} is used as the backbone for text feature extraction. MDCN first introduces Context Prompt Decoupling Learning (CPDL), which semantically decouples modality-contextual text prompts into person-related and modality-related prompts and uses modality orthogonality to eliminate cross-modal feature redundancy. 

This effective decoupling ensures that modality information is clearly distinguished from identity information. 

This decoupling ensures that modality information is effectively distinguished from identity information. 


Then, MDCN distinguishes modality-specific, modality-shared, and modality-contextual features through three network branches constrained by Semantic Coupling Learning (SCL). High-level semantic information is embedded via modality coupling and modality-contextual alignment and effectively guide the image encoder to focus on key attributes. Meanwhile, common ReID losses are used to boost the discriminative power of the learned features. Finally, MDCN introduces Modality Relational Knowledge Distillation (MRKD), which uses hierarchical cosine angular distillation to distill valuable high-level semantic relationships from modality-specific and modality-shared branches into modality-contextual image features. This enhances the modality-aware distinguishability in modality-contextual representation and ensures a more refined representation of cross-modal information.

Formally, we define the VI-ReID dataset as 
$\mathcal{D}_I = \{\mathcal{X}_v, \mathcal{X}_r, \mathcal{Y}_v, \mathcal{Y}_r\}$,  
where $\mathcal{X}_v = \{x_v^i\}_{i=1}^{N_v}$ and $\mathcal{X}_r = \{x_r^i\}_{i=1}^{N_r}$ denote the sets of visible and infrared images, respectively. Here, $x_v^i$ and $x_r^i$ represent the $i$-th visible and infrared samples, while $N_v$ and $N_r$ indicate the corresponding sample counts of the two modalities. The identity label sets are given as $\mathcal{Y}_v = \{y_v^i\}_{i=1}^{N_v}$ and $\mathcal{Y}_r = \{y_r^i\}_{i=1}^{N_r}$, which share a unified identity class space across modalities. 


{Existing learnable text prompts are designed either for modality differences or for identity descriptions, yet they inevitably entangle the two during optimization. A modality-related prompt absorbs identity cues from paired visual features, while an person-related prompt is forced to accommodate the visual discrepancy across modalities. 


Consequently, the resulting supervision fails to separate what makes a person unique from what makes an image infrared or visible. 

To address these issues, CPDL introduces modality-contextual text prompts that semantically bridge person-related and modality-related cues, and then explicitly decouple them. This design prevents the passive entanglement described above, allowing the model to capture spectral distribution differences between visible and infrared modalities while better preserving identity information.}


(Existing methods employ text prompts that primarily focus on modality differences, entangling identity-related and modality information. The direct use of these prompts to guide the model results in modality-shared and modality-specific features losing crucial identity information and introducing noise, ultimately limiting discriminative capability. )

(To address these issues, CPDL introduces modality-contextual text prompts to explicitly infuse modality-aware capabilities and semantically decouples them into person-related and modality-related prompts. This effective decoupling ensures that modality information is clearly distinguished from identity information. )

Existing methods typically rely on learnable text prompts, which primarily focus on modality differences, resulting in entanglement between identity-related and modality-related information. Directly using such prompts to guide the model causes modality-shared and modality-specific features to lose crucial identity information and introduces noise, thereby limiting discriminative capability. 

To address these issues, CPDL introduces modality-contextual text prompts, which explicitly enhance modality-aware capabilities and semantically decouple the prompts into person-related and modality-related prompts. This separation ensures a clear distinction between identity and modality information, improving the discriminative power of the learned features.

> Existing methods typically rely on learnable text prompts that primarily focus on modality differences, leading to entanglement between identity-related and modality-related information. Directly applying such prompts to guide the model can cause modality-shared and modality-specific representations to lose crucial identity information and introduce noise, thereby limiting the model's discriminative capability. To address this issues, CPDL introduces modality-contextual text prompts, which explicitly enhance modality-awareness and semantically decouple the prompts into person-related and modality-related components. This separation ensures a clear distinction between identity and modality information, enabling the model to produce more discriminative representations.


以上括号内容都是引言的内容，但是我想写到CPDL方法首段。你有什么推荐是要跟引言一样，还是进行稍微修改。


 CPDL introduces modality-contextual text prompts that semantically bridge person-related and modality-related cues, and then explicitly decouple them. This design prevents the passive entanglement described above, allowing the model to capture spectral distribution differences between visible and infrared modalities while better preserving identity information.





> However, as illustrated in Figure \xbox{\ref{fig:1}} (a), existing methods employ text prompts that primarily focus on modality differences, entangling identity-related and modality information. The direct use of these prompts to guide the model results in modality-shared and modality-specific features losing crucial identity information and introducing noise, ultimately limiting discriminative capability. Additionally, integrating modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships within and across modalities, leading to distortion of cross-modal high-level semantics during information integration, which further weakens the effectiveness of identity retrieval.

To address the above deficiencies, as illustrated in Figure \ref{fig:1} (b), we propose a design idea of modality-contextual text prompts that explicitly introduce modality-aware capabilities. 

We find that although this enhances the flexibility of multimodal attribute localization, it also introduces new complexities in maintaining cross-modal representation consistency. 

To alleviate this dilemma, we develop a Modality Decoupling and Coupling Network (MDCN), which integrates Context Prompt Decoupling Learning (CPDL), Semantic Coupling Learning (SCL), and Modality Relational Knowledge Distillation (MRKD).

Specifically, CPDL introduces modality-contextual text prompts to explicitly infuse modality-aware capabilities and semantically decouples them into person-related and modality-related prompts. This effective decoupling ensures that modality information is clearly distinguished from identity information. 

> Specifically, CPDL introduces modality-contextual text prompts to embed modality-aware capabilities and semantically decouples them into person-related and modality-related prompts. 

>This decoupling ensures that modality information is effectively distinguished from identity information. 



\hl{Although person-related information is inherently modality-independent, we keep $P_v$ and $P_r$ separate for the two modalities. If a single unified $P$ were shared, it would be forced to reconcile the large visual discrepancy between visible and infrared appearances, diluting modality-specific identity cues. By preserving separate prompts, complete identity information is retained within each modality. In the subsequent coupling stage, these representations are cross-aligned and converge to a unified, modality-invariant identity representation.}


Here, “person-related” denotes identity-discriminative semantic information, not modality-invariant representation. In contrast, M_v and M_r explicitly capture modality-related factors, preventing them from being mixed into the person-related prompts. 



Notably, $P_v/P_r$ denotes identity-discriminative semantic information rather than an already modality-invariant representation. In contrast, M_v and M_r explicitly capture modality-related factors, preventing them from being mixed into the person-related prompts.

Therefore, $P_v/P_r$ preserve identity semantics, while $M_v/M_r$ explicitly capture modality discrepancies.

Notably, $P_v/P_r$ denote identity-discriminative semantic information rather than an already modality-invariant representation, while $M_v/M_r$ explicitly capture modality-related factors to prevent modality discrepancies from being mixed into the person-related prompts.


Here, “person-related” denotes identity-discriminative semantic information rather than an already modality-invariant representation. In contrast, $M_v$ and $M_r$ explicitly capture modality-related factors, preventing them from being mixed into the person-related prompts. Therefore, $P_v/P_r$ preserve identity semantics, while $M_v/M_r$ model modality discrepancies.


Since visible and infrared images differ significantly in appearance, we keep P_v and P_r separate to retain identity-related semantics from each modality before alignment. In contrast, M_v and M_r explicitly capture modality-related factors, preventing them from being mixed into the person-related prompts. Therefore, P_v/P_r and M_v/M_r play different roles: the former focus on identity semantics, while the latter focus on modality discrepancies. 

The final modality-invariant identity representation is then learned through coupling and alignment in SCL.


In CPDL, we introduce learnable modality-contextual text prompts with the textual description “A photo of a $[X]_1, [X]_2, \ldots, [X]_m$ person from $[Z]_{1}, [Z]_{2}, \ldots, [Z]_{m}$ modality”, where $[X]_i$ and $[Z]_i$ ($i \in [1, m]$) represent trainable word tokens corresponding to the person and modality, respectively. $m$ indicates the number of tokens, with their dimensionality matching the word embedding space. To clearly distinguish modality information from identity information,
we semantically decouple a modality-contextual text prompt into two parts: a person-related text prompt, “A photo of a $[X]_1, [X]_2, \ldots, [X]_m$ person”, and a modality-related text prompt, “A photo of a person from $[Z]_{1}, [Z]_{2}, \ldots, [Z]_{m}$ modality”. The decoupling corresponds to the $[X_i]$ and $[Z_i]$ ($i \in [1, m]$) components in the modality-contextual prompt, ensuring semantic alignment while distinguishing modality information from identity information. These prompts are independently constructed for each identity across different modalities. We define the complete set of learnable prompts as
$\mathcal{D}_T = \{\mathcal{P}_v^i, \mathcal{P}_r^i, \mathcal{M}_v^i, \mathcal{M}_r^i, \mathcal{C}_v^i, \mathcal{C}_r^i\}$,
where $\mathcal{C}$ denotes the modality-contextual prompt set, and $\mathcal{P}$ and $\mathcal{M}$ represent the decoupled person-related and modality-related prompt sets, respectively.


During training, the person-related prompt is further divided into visible ($P^i_v$) and infrared ($P^i_r$) components. However, since **person-related information** is intended to be **modality-independent**, it is unclear how modality-specific characteristics (V and I) can be meaningfully separated again from an already disentangled person-related representation.



>感谢审稿人的宝贵意见。我们同意 person-related information 的最终目标是 modality-independent，但需要澄清的是，在 CPDL 阶段，$P_v$ 和 $P_r$ 并不是从一个已经完全 modality-invariant 的 person representation 中再次分离出的模态特定成分。相反，它们是两个 modality-conditioned person-related prompts，用于分别捕获 visible 和 infrared 图像中与身份判别相关的语义线索。

>这里的 “modality-conditioned” 并不意味着 $P_v$ 和 $P_r$ 用于建模显式的模态属性，而是表示身份语义是在 visible 或 infrared 的上下文中被学习的。由于 visible 和 infrared 图像在颜色、纹理、光谱响应等方面存在显著差异，同一身份在不同模态下可能依赖不同的视觉证据。如果在早期阶段强制使用一个统一的 person prompt，模型需要同时拟合两种差异较大的视觉分布，可能会导致某些模态下仍然具有身份判别性的线索被削弱或丢失。因此，我们保留 $P_v$ 和 $P_r$，以完整建模不同模态下的 identity-discriminative cues。

>与此同时，我们仍然显式引入 $M_v$ 和 $M_r$ 来建模 modality-related information，例如 visible/infrared 的成像差异、颜色/纹理分布差异以及传感器响应差异。这样做可以避免这些模态因素被 $P_v$ 和 $P_r$ 吸收，从而使 person-related prompts 更专注于身份线索，而 modality-related prompts 更专注于模态差异。

>因此，$P_v/P_r$ 与 $M_v/M_r$ 的作用并不重复：前者是模态条件下的身份语义锚点，后者是显式的模态语义锚点。最终的 modality-invariant identity representation 并不是在 CPDL 阶段直接得到的，而是在后续 SCL 的 modality coupling alignment 和 modality-contextual alignment 中，通过跨模态语义对齐逐步形成的。



>感谢审稿人的宝贵意见。我们需要澄清的是，CPDL 阶段的 person-related prompt 并不表示已经得到完全模态无关的身份表示，而是表示与身份判别相关的语义信息。最终的模态无关身份表示是在后续 coupling stage 中通过跨模态对齐逐步形成的。

>由于可见光图像和红外图像之间存在显著的外观差异，同一身份在两种模态下可能依赖不同的判别线索。如果在 CPDL 阶段直接使用一个统一的 person-related prompt，模型需要过早地协调两种差异较大的视觉分布，可能会削弱甚至丢失某些仍然与身份相关的模态内线索。因此，我们分别保留 $P_v$ 和 $P_r$，使它们分别从可见光图像和红外图像中学习身份相关语义，从而更完整地保留两种模态下的身份判别信息。

>同时，我们进一步引入 $M_v$ 和 $M_r$ 来显式建模模态相关信息，例如光谱响应、颜色/纹理差异以及传感器成像差异。这样可以避免这些模态因素被混入 $P_v$ 和 $P_r$ 中，使 person-related prompts 更专注于身份信息，而 modality-related prompts 更专注于模态差异。

>因此，$P_v/P_r$ 和 $M_v/M_r$ 的作用并不重复：$P_v/P_r$ 关注“这个人是谁”，而 $M_v/M_r$ 关注“该图像来自哪种模态以及该模态带来的外观差异”。随后，在 SCL 阶段，这些解耦后的 prompts 通过 modality coupling alignment 和 modality-contextual alignment 共同指导视觉特征学习，最终形成统一的模态无关身份表示。这个解释也与论文中 CPDL 将 modality-contextual prompts 解耦为 person-related 和 modality-related prompts，并由 SCL 进一步进行语义耦合对齐的设计一致

>Thank you for the insightful comment. We agree that the final person representation should be modality-independent. However, we would like to clarify that the person-related prompt in CPDL does not mean that a fully modality-invariant identity representation has already been obtained at this stage. Instead, it denotes identity-discriminative semantic information. The final modality-invariant identity representation is progressively learned in the subsequent coupling stage through cross-modal alignment.

>In CPDL, we keep Pv and Pr separate because visible and infrared images exhibit large appearance discrepancies, and the identity information expressed in the two modalities may not be identical. If a single shared person-related prompt P were enforced at this early stage, it would need to fit two heterogeneous visual distributions simultaneously, which may weaken the identity-related information preserved in each modality. Therefore, Pv and Pr are learned separately from visible and infrared images to better preserve identity-discriminative semantics before cross-modal alignment.

>Meanwhile, Mv and Mr are introduced to explicitly model modality-related factors, such as spectral response, color/texture distribution, and sensor-specific appearance patterns. This separation prevents modality-related factors from being absorbed into Pv and Pr. Thus, Pv/Pr and Mv/Mr are not redundant: the former focus on identity-discriminative semantics, while the latter focus on modality discrepancies.

>In the subsequent SCL stage, these decoupled prompts jointly guide visual feature learning through modality coupling alignment and modality-contextual alignment. In this way, identity-related semantics from both modalities are progressively aligned, leading to a unified modality-invariant identity representation. We will revise the manuscript to make this clarification more explicit.



感谢审稿人的指出。这里的 “person-related” 并不表示该 prompt 在 CPDL 阶段已经形成了完全的 modality-invariant 表示，而是指其主要编码与身份判别相关的语义信息，并尽量与显式的 modality-related 信息区分开来。由于 visible 和 infrared 图像在颜色、纹理和成像机制上存在显著差异，如果强制使用一个统一的 $P$ 来同时描述两种模态中的身份信息，可能会过早压缩甚至丢失某些模态下特有但仍然与身份相关的判别线索。因此，我们分别构建 $P_v$ 和 $P_r$，使其作为 visible-aware 和 infrared-aware 的 identity semantic anchors，以完整保留两种模态中的身份信息。随后，在 SCL 的 coupling/alignment 过程中，$P_v$ 和 $P_r$ 被进一步跨模态对齐，从而引导模型学习统一的 modality-invariant identity representation。


感谢审稿人的宝贵意见。我们同意 person-related information 的最终目标是 modality-independent，但需要澄清的是，在 CPDL 阶段，$P_v$ 和 $P_r$ 并不是从一个已经完全 modality-invariant 的 person representation 中再次分离出的 modality-specific 成分。相反，它们是两个 modality-conditioned person-related prompts，用于分别捕获 visible 和 infrared 图像中与身份相关的语义线索。

这种设计的原因在于，visible 和 infrared 图像之间存在较大的视觉差异，同一身份在两种模态下可能通过不同的外观线索体现出来。如果在早期阶段强制共享一个统一的 person prompt，模型需要同时拟合两种差异显著的视觉分布，可能会削弱或丢失某些模态中特有的 identity-discriminative cues。因此，我们保留 $P_v$ 和 $P_r$，不是为了重新引入 modality noise，而是为了在不同模态中完整保留身份相关信息。

最终的 modality-invariant identity representation 并不是在 CPDL 中直接得到的，而是在后续 SCL 中通过 modality coupling alignment 和 modality-contextual alignment 逐步形成的。换言之，$P_v$ 和 $P_r$ 是对两种模态下身份语义的中间建模，后续 coupling stage 会对它们进行跨模态对齐，从而获得统一、稳健的 modality-invariant identity representation。


It is worth noting that, although person-related information is inherently modality-independent, we keep $P_v$ and $P_r$ separate to avoid reconciling the large visual discrepancy between visible and infrared appearances. This separation preserves complete modality-specific identity cues, which are later cross-aligned in the coupling stage to form a unified, modality-invariant identity representation.

It is worth noting that the term “person-related” refers to identity-discriminative information rather than an already fully modality-invariant representation at this stage. Due to the large appearance discrepancy between visible and infrared images, we maintain two modality-conditioned person-related prompts, $P_v$ and $P_r$, to preserve identity cues that are expressed differently in each modality. These prompts are not intended to reintroduce modality-specific noise, but to retain complete modality-dependent identity evidence before alignment. In the subsequent coupling stage, $P_v$ and $P_r$ are cross-aligned to produce a unified modality-invariant identity representation.