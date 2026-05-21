1.1	1.3	1.4

2.2	2.4

3.2	3.4	3.5	3.6







# Modality Decoupling and Coupling Network for Visible-Infrared Person Re-Identification

**Rishen Zhong, Guorong Lin, and Zhenhua Huang**

---

**Abstract—** 

Visible-Infrared person re-identification (VI-ReID) is a critical cross-modal retrieval task with substantial applications in urban surveillance and public safety. 

Existing methods primarily introduce text prompts that entangle modality and identity information, failing to clearly separate person uniqueness from modality differences. Additionally, the integration of modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships, leading to the distortion of implicit cross-modal information and weakening identity retrieval.

To address these issues, we develop a Modality Decoupling and Coupling Network (MDCN) that aims to fully extract both modality-shared and modality-specific features, while effectively integrating valuable high-level semantic relationships from both.Specifically, it consists of three core components: Context Prompt Decoupling Learning (CPDL), Semantic Coupling Learning (SCL), and Modality Relational Knowledge Distillation (MRKD). 

CPDL designs modality-contextual text prompts to explicitly introduce modality-aware capabilities and semantically decouples them into person-related and modality-related prompts, thereby effectively distinguishing between modality and identity information.

SCL utilizes decoupled semantic prompts as high-level priors and applies modality coupling and modality-contextual alignment to guide visual features. This encourages the model to emphasize modality uniqueness and differences across semantic levels while preserving high-level semantic context, enabling it to learn more stable modality-specific and shared representations.

MRKD employs hierarchical cosine angular distillation to project inter-modality and intra-modality relationships into a modality-contextual space, explicitly reducing cross-modal and intra-modal interference while preserving discriminative representations.

Extensive experiments on SYSU-MM01, RegDB, and LLCM benchmarks demonstrate that MDCN achieves state-of-the-art performance, validating its effectiveness in addressing the VI-ReID task.



<!-- SCL utilizes decoupled prompts as high-level semantic priors and incorporates modality coupling alignment and modality-contextual alignment to guide visual features semantically. Modality coupling alignment guides the model to emphasize modality uniqueness while mitigating cross-modal semantic gaps, and modality-contextual alignment maintains high-level semantic context, enabling the model to retain essential information while learning stable modality-specific and shared features.

SCL utilizes decoupled semantic prompts as high-level priors and applies modality coupling and modality-contextual alignment to guide visual features, promoting the model to emphasize modality uniqueness and differences across semantic levels, while preserving high-level semantic context, thereby learning more stable modality-specific and shared representations.

SCL utilizes decoupled semantic prompts as high-level priors and applies modality coupling and modality-contextual alignment to guide visual features. This encourages the model to emphasize modality uniqueness and differences across semantic levels while preserving high-level semantic context, enabling it to learn more stable modality-specific and shared representations.

SCL utilizes decoupled prompts as high-level semantic priors to guide visual features semantically. 

SCL utilizes decoupled semantic prompts as high-level priors and applies modality coupling and modality-contextual alignment to guide visual features. 这促使模型在不同语义层面强调模态特性和模态差异，同时maintains high-level semantic context，从而学习到更加稳定的模态特定和模态共享特征。

 emphasizing modality uniqueness, preserving high-level semantic context, and enabling stable modality-specific and shared representations.

SCL将解耦后的语义提示作为高层语义先验，implements modality coupling alignment and modality-contextual alignment对视觉特征进行语义引导，促使模型在语义层面强调模态特性和模态差异，从而学习到更加稳定的模态特定和模态共享特征。

SCL 将解耦后的语义提示作为高层语义先验,利用行人相关文本特征与相反模态的模态相关文本特征对视觉特征进行语义引导,促使模型在语义层面弱化模态差异并学习更加稳定的模态共享图像特征,从而促进模态共享特征与模态特异性特征的精准提取。 -->

<!-- Existing methods primarily introduce text prompts that emphasize solely modality differences and lack identity-related semantics. 

Additionally, the integration of modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships within and across modalities. This leads to the confusion of cross-modal high-level semantics and weakens the effectiveness of identity retrieval.  -->

<!-- MRKD employs hierarchical cosine angular distillation, which distills inter-modality cosine relationships from modality-shared features and intra-modality cosine relationships from modality-specific features into the modality-contextual space, thereby improving the modality-aware distinguishability of representations. 

Extensive experiments on SYSU-MM01, RegDB, and LLCM benchmarks demonstrate that MDCN achieves state-of-the-art performance, validating its effectiveness in addressing the VI-ReID task.

MRKD employs hierarchical cosine angular distillation to project inter-modality and intra-modality relationships into the modality-contextual space, explicitly mitigating cross-modal and intra-modal interference while preserving discriminative representations.

MRKD employs hierarchical cosine angular distillation to project inter-modality and intra-modality relationships into a modality-contextual space, explicitly reducing cross-modal and intra-modal interference while preserving discriminative representations.


Existing methods introduce text prompts that focus primarily on modality differences and lack identity-related semantics. 


SCL implements modality coupling alignment and modality-contextual alignment to guide the image encoder to emphasize key attributes based on high-level semantics, thus effectively extracting modality-shared and modality-specific features. 


 \hl{SCL utilizes these decoupled anchors to execute semantic coupling alignment, transforming them into high-level guidance to geometrically constrain visual features, which promotes the extraction of modality-shared and modality-specific features while enhancing robustness against real-world visual degradations.}

SCL将解耦后的语义提示作为高层语义先验，implements modality coupling alignment and modality-contextual alignment对视觉特征进行语义引导，促使模型在语义层面强调模态特性和模态差异，从而学习到更加稳定的模态特定和模态共享特征。

SCL 将解耦后的语义提示作为高层语义先验，通过模态耦合对齐（modality coupling alignment）与模态上下文对齐（modality-contextual alignment）对视觉特征进行语义引导。其中，模态耦合对齐促使模型在语义层面同时强调模态特性与模态差异，而模态上下文对齐则有效保留了跨模态的语义完整性与高层上下文信息，避免信息在解耦与耦合过程中丢失。两者协同作用，最终学习到更加稳定的模态特定特征与模态共享特征。

SCL 以解耦后语义提示为高层先验，采用模态耦合对齐与模态上下文对齐对视觉特征施加语义引导。前者强调模态内与模态间的特征差异与共性，后者则保留特征在跨模态传递过程中的原始判别结构与上下文语义，确保身份相关信息不被弱化。由此，模型能够在区分模态差异的同时，学习到鲁棒的模态特定与模态共享特征。

SCL将解耦后的语义提示作为高层语义先验，采用modality coupling alignment）与模态上下文对（modality-contextual alignment）对视觉特征进行语义引导。前者齐促使模型在语义层面强调模态特性和模态差异，而后者则有效保留了跨模态的语义完整性与高层上下文信息。由此模型可以在保留信息的同时，学习到更加稳定的模态特定和模态共享特征。

SCL 将解耦后的语义提示作为高层语义先验,利用行人相关文本特征与相反模态的模态相关文本特征对视觉特征进行语义引导,促使模型在语义层面弱化模态差异并学习更加稳定的模态共享图像特征,从而促进模态共享特征与模态特异性特征的精准提取。

SCL 将解耦后的语义提示作为高层语义先验，分别采用模态耦合对齐（modality coupling alignment）与模态上下文对齐（modality-contextual alignment）对视觉特征进行语义引导。前者促使模型在语义层面强调模态特性和弱化模态差异，后者则有效保留跨模态的语义完整性与高层上下文信息。由此，模型在保留关键信息的同时，能够学习到更加稳定的模态特定特征与模态共享特征。

SCL leverages the decoupled semantic prompts as high-level semantic priors and employs modality coupling alignment and modality-contextual alignment to semantically guide visual features. The former encourages the model to emphasize modality-specific characteristics and weaken modality differences at the semantic level, while the latter effectively preserves cross-modal semantic integrity and high-level contextual information. Consequently, while retaining critical information, the model is able to learn more stable modality-specific and modality-shared features.

SCL utilizes decoupled semantic prompts as high-level semantic priors and incorporates modality coupling alignment and modality-contextual alignment to guide visual features semantically. Modality coupling alignment guides the model to emphasize modality-specific features while reducing cross-modal semantic gaps, and modality-contextual alignment maintains cross-modal semantic consistency and high-level context, enabling the model to retain essential information while learning stable modality-specific and shared representations.


Specifically, modality coupling alignment encourages the model to focus on modality-specific characteristics while mitigating semantic discrepancies across modalities, whereas modality-contextual alignment preserves cross-modal semantic consistency and high-level contextual information. As a result, the model can retain essential information while learning more stable modality-specific and shared representations.

SCL implements modality coupling alignment and modality-contextual alignment to guide the image encoder to emphasize key attributes based on high-level semantics, thus effectively extracting modality-shared and modality-specific features. 

SCL utilizes these decoupled anchors to execute semantic coupling alignment, transforming them into high-level guidance to geometrically constrain visual features, which promotes the extraction of modality-shared and modality-specific features while enhancing robustness against real-world visual degradations.


方案 1（正式、平衡）
SCL utilizes decoupled prompts as high-level semantic priors and incorporates modality coupling alignment and modality-contextual alignment to guide visual features semantically. Modality coupling alignment guides the model to emphasize modality uniqueness while mitigating cross-modal semantic gaps, and modality-contextual alignment maintains high-level semantic context, enabling the model to retain essential information while learning stable modality-specific and shared features.

方案 2（更学术化、强调动作）
Modality coupling alignment steers the model to strengthen modality-specific features and reduce semantic discrepancies across modalities.

方案 3（简洁紧凑）
Modality coupling alignment promotes modality-specific features while bridging cross-modal semantic gaps.

方案 4（强调“平衡”）
Modality coupling alignment encourages the model to prioritize modality-specific characteristics without losing cross-modal semantic consistency.

Modality coupling alignment guides the model to emphasize modality-specific features while weaken cross-modal semantic gaps, 

and modality-contextual alignment maintains high-level semantic context, enabling the model to retain essential information while learning stable modality-specific and shared features.


弱化

模态差异并学习更加稳定的模态共享图像特征 

SCL 将解耦后的语义提示作为高层语义先验,利用行人相关文本特征与相反模态的模态相关文本特征对视觉特征进行语义引导,促使模型在语义层面弱化模态差异并学习更加稳定的模态共享图像特征,从而促进模态共享特征与模态特异性特征的精准提取。

MRKD employs hierarchical cosine angular distillation, which distills inter-modality cosine relationships from modality-shared features and intra-modality cosine relationships from modality-specific features into the modality-contextual space, thereby improving the modality-aware distinguishability of representations. Extensive experiments on SYSU-MM01, RegDB, and LLCM benchmarks demonstrate that MDCN achieves state-of-the-art performance, validating its effectiveness in addressing the VI-ReID task. -->

**Index Terms—** Person re-identification, high-level semantics, relational knowledge distillation.

---

## I. INTRODUCTION

PERSON re-identification (ReID) aims to match pedestrian images of the same individual across non-overlapping camera views. This enhances the operational efficacy of urban surveillance and public safety in applications such as locating missing persons and tracking criminals. Current research efforts [1], [2], [3], [4], [5], [6] have achieved significant progress in the visible spectrum modality. Notably, modern public safety systems extensively use adaptive spectral perception cameras that automatically switch to infrared modality in low-light conditions, effectively preserving pedestrian features at night. However, the significant domain differences between visible and infrared modality images lead to substantial performance degradation when applying conventional ReID frameworks. Therefore, visible-infrared person re-identification (VI-ReID) has emerged as a critical research area to overcome this technical challenge.

**Fig. 1:** Illustration of the differences between our method and existing VI-REID methods. Green represents the visible modality, while red represents the infrared modality. (a) Existing methods primarily rely on modality-related text prompts to compensate for modality-specific features and additional fusion to extract complete image features. (b) Our method employs modality-contextual text prompts to semantically decouple person-related and modality-related prompts and use both to guide the extraction of modality-shared and modality-specific features. In addition, Hierarchical Cosine Angular Distillation is introduced to integrate the effective high-level semantic information from both features.

The VI-ReID task aims to effectively alleviate inter-modal representation discrepancies while preserving identity-aware valuable information across modalities [7], [8]. Due to distinct spectral response mechanisms, significant differences exist across modalities in visual features such as color distributions, texture details, etc. The mainstream technologies for solving this problem are divided into Image-level and Feature-level methods [9]. Image-level methods aim to achieve pixel-level cross-modality translation or generate intermediate modalities [10], [11], [12]. Although these methods can effectively alleviate modal discrepancies, their training process is unstable and relies on large-scale cross-modality image pairs. Feature-level methods implement modality-shared representations in deep feature spaces through heterogeneous feature extraction networks and cross-modality metric learning algorithms [13], [14], [15]. However, relying solely on modality-shared features for retrieval ignores identity-aware discriminative information hidden within modality-specific features. This limitation restricts their ability to capture complex identity cues. As a result, researchers have started exploring implicit information within modality-specific features and combining it with modality-shared features to create more comprehensive representations [16], [17], [18]. These methods are referred as modality-compensated methods.

With the advancement of Vision-Language Pre-training (VLP) models, researchers have begun incorporating vision-language learning into feature-level methods to compensate for insufficient high-level semantics [19], [20], [21]. In particular, recent studies have shown that Contrastive Language-Image Pre-training (CLIP) models can bridge visual content with linguistic descriptions to enhance the perception of high-level semantics in pedestrians [22], [23], [24]. In this context, modality-compensated methods have been proposed. They introduce high-level semantic information to enhance modality perception, thereby further extracting modality-specific and modality-shared features to obtain more comprehensive pedestrian representations [25]. However, as illustrated in Figure 1 (a), these methods introduce text prompts that focus solely on modality differences and lack identity-related semantics. They only rely on modality-related text features to guide the model to compensate for modality-specific features, without fully exploiting the potential of CLIP. This leads to insufficient enhancement of discriminative capability, resulting in the loss of crucial identity cues and the introduction of noise during the extraction of modality-shared and modality-specific features, which ultimately limits the performance of cross-modal person re-identification. Additionally, the integration of modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships within and across modalities. This leads to the confusion of cross-modal high-level semantics during information integration, which distorts modality-specific cues and reduces the effectiveness of identity retrieval.


> (3.1)However, as illustrated in Figure 1 (a), existing methods introduce text prompts that focus solely on modality differences and lack identity-related semantics. They merely rely on modality-related text features to guide the model in compensating for modality-specific features, without fully exploiting the potential of CLIP. This leaves two key limitations unresolved. 
>
> 
> Because the text prompts entangle modality and identity information, the model cannot clearly separate what makes a person unique from what makes an image infrared or visible. Such entanglement causes the extraction of modality-shared and modality-specific features to lose crucial identity cues and to introduce noise, ultimately limiting discriminative capability. 
> 
> 
> Additionally, the integration of modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships within and across modalities. This leads to the confusion of cross-modal high-level semantics during information integration, which distorts modality-specific cues and reduces the effectiveness of identity retrieval.

To address the above deficiencies, as illustrated in Figure 1 (b), we propose a design idea of modality-contextual text prompts that explicitly introduce modality-aware capabilities. We find that although this enhances the flexibility of multimodal attribute localization, it also introduces new complexities in maintaining cross-modal representation consistency. To alleviate this dilemma, we develop a Modality Decoupling and Coupling Network (MDCN), which integrates Context Prompt Decoupling Learning (CPDL), Semantic Coupling Learning (SCL), and Modality Relational Knowledge Distillation (MRKD). Specifically, CPDL introduces modality-contextual text prompts to explicitly infuse modality-aware features and semantically decouples them into person-related and modality-related prompts. This effective decoupling ensures that modality information is clearly distinguished from identity information. SCL facilitates visual feature learning by leveraging the learned textual semantics. It employs a combination of modality coupling alignment and modality-contextual alignment strategies, directing the image encoder to focus on key attributes based on high-level semantic information. This approach ensures intra-modality consistency while enhancing inter-modality distinguishability, which facilitates the extraction of both modality-shared and modality-specific features. MRKD integrates high-level semantic relationships from multi-feature spaces into the modality-contextual feature space. It employs hierarchical cosine angular distillation to distill inter-modality cosine relationships from modality-shared features and intra-modality cosine relationships from modality-specific features into the modality-contextual space. This enhances the modality-aware distinguishability in modality-contextual representation and ensures a more refined representation of cross-modal information.

The main contributions of this paper are as follows:

1. We develop a novel MDCN method that introduces modality-contextual text prompts for VI-ReID and introduce CPDL to semantically decouple these prompts, effectively distinguishing between modality and identity information.
2. We explore CLIP's potential for processing modality information in VI-ReID and introduce SCL with modality coupling alignment and modality-contextual alignment to generate multiple feature spaces. This significantly enhances the image encoder's ability to highlight key attributes based on high-level semantics.
3. We design MRKD, which uses hierarchical cosine angular distillation to integrate high-level semantic relationships information from multiple feature spaces into a modality-contextual space. This enhances the ability to extract modality-aware distinguishability while reducing interference caused by modality inconsistencies.
4. We validate the performance of MDCN on three benchmark datasets, highlighting the superiority of our method and establishing a new technical pathway for the VI-ReID task.

---

## II. RELATED WORK

### A. Visible-Infrared Person Re-Identification

Person ReID is a critical pedestrian retrieval task [26]. Its core objective is to extract discriminative pedestrian representations. For instance, ATPR [27] leverages explicit attribute guidance and a dedicated Attribute Embedding mechanism to address intra-class attribute variability; while MP-ReID [28] utilizes appearance attributes to construct both explicit and implicit learnable prompts, generating more comprehensive and discriminative person descriptive features. Despite significant advances in visible-light ReID, these methods show limited generalization for VI-ReID tasks. VI-ReID aims to effectively alleviate inter-modal representation discrepancies while preserving identity-aware valuable information across modalities. Mainstream studies are divided into Image-level and Feature-level methods [9].

Image-level methods reduce modality differences through cross-modal style transfer or intermediate image generation [29], [17], [30]. For example, AlignGAN [10] and Hi-CMD [11] perform bidirectional conversion between visible and infrared images, transforming visible images into infrared and vice versa. MMN [12] introduces a nonlinear intermediate modality generator that bridges the visible-infrared crossmodal gap. In addition, DiVE [31] leverages a pre-trained diffusion model and a novel identity-modality decoupling paradigm to synthesize high-fidelity visible-infrared crossmodal paired data, significantly reducing the modality gap for VI-ReID. However, image quality remains challenging, and the reliability of fine-grained local feature remains problematic due to adversarial training instability and latent space noise. In contrast, our method avoids these issues by eliminating the need for image generation.

Feature-level methods create modality-shared representations in deep feature spaces through heterogeneous feature extraction networks and cross-modality metric learning algorithms [8], [13], [32]. Among them, MRCN [9] employs instance normalization and modality recovery-compensation to decouple modality-relevant features from modality-irrelevant ones. SGIEL [33] uses shape-erased feature learning with human parsing priors to decoupling shape-related and shape-erased features, encouraging the exploration of diverse modality-shared features. Although these methods have made significant progress, they primarily rely on modality-shared features for person re-identification and ignore important identity-relevant information embedded in modality-specific features. This limits the ability to fully exploit the potential of cross-modal retrieval performance. To address these issues, several modality-compensated methods, [16], [17], [18], [34] have been proposed. cm-SSFT [18] proposes a cross-modality shared-specific feature transfer algorithm to address for the lack of specific information. IDKL [16] employs implicit knowledge distillation to extract implicit discriminative knowledge from modality-specific features. D²RL [34] introduces a Dual-level Discrepancy Reduction Learning framework to generate a unified multi-spectral representation. However, these modality-compensated methods often lack high-level semantic information. On the contrary, our method leverages natural language descriptions to supervise cross-modal semantic representation learning, thereby embedding high-level semantic information into both modality-shared and modality-specific features.

### B. Vision-Language Pre-Training

Vision-Language Pre-Training (VLP) models are able to capture high-level semantic information from images by establishing semantic connections between natural language and visual content. However, prompt engineering for downstream tasks faces significant challenges, as it requires domain expertise, is time-consuming to design, and suffers from limited model generalization capability. To address this, Zhou et al. [35] propose CoOp, which utilizes a set of learnable prompts to replace manual text prompts. CoCoOp [36] further generates input-conditional tokens for each image and integrates them into the learnable prompts, enhancing the model's generalization ability. MaPLe [37] introduces a Vision-Language coupling strategy to strengthen the coupling between visual and language prompts. These methods enable VLP models to be directly applied to ReID tasks. For instance, CLIP-ReID [5] generates identity-related language descriptions through learnable prompts and guide the visual encoder to extract semantically rich features. It significantly improves the representation capability for ReID and provides abundant high-level semantic information. However, in VI-ReID, the domain gap between visible and infrared images limits the model's ability to generate detailed image descriptions via text tokens.

Several methods have explored applying VLP to the VI-ReID task [38], [39]. For example, TMAL [19] aligns visible-infrared features through learnable text descriptions and a dual-module approach, combining modality alignment and identity enhancement. Yu et al. [20] find that high-level semantic information in images from different modalities does not show significant modality differences, and they enhance cross-modality feature invariance with a three-stage text feature generation and fusion mechanism. However, these methods rely solely on modality-shared features for person retrieval and ignore the identity-aware discriminative information in modality-specific features, which limits further improvement in retrieval performance. As a result, researchers have combined modality-compensated methods with VLP, such as CLIP-MC [25] uses prompt learning to generate fine-grained text descriptions and recovers missing modality-specific information through Instance Text Prompt Generation. Although existing modality-compensated methods have made progress after incorporating high-level semantic information, they still face two limitations. First, after incorporating high-level semantic information, these methods often fail to effectively separate identity information from modality information. Second, the integration of modality-shared and modality-specific features in these methods generally overlooks the fusion of high-level semantic relationships both within and across modalities. To address these issues, our method fully extracts both modality-shared and modality-specific features, while effectively integrating high-level semantic relationships from both.

---

## III. METHOD

This section introduces the proposed Modality Decoupling and Coupling Network (MDCN) and details its key components. As shown in Figure 2, a pretrained CLIP [22] is used as the backbone for text feature extraction. MDCN first introduces Context Prompt Decoupling Learning (CPDL), which semantically decouples modality-contextual text prompts into person-related and modality-related prompts and uses modality orthogonality to eliminate cross-modal feature redundancy. This effective decoupling ensures that modality information is clearly distinguished from identity information. Then, MDCN distinguishes modality-specific, modality-shared, and modality-contextual features through three network branches constrained by Semantic Coupling Learning (SCL). High-level semantic information is embedded via modality coupling and modality-contextual alignment and effectively guide the image encoder to focus on key attributes. Meanwhile, common ReID losses are used to boost the discriminative power of the learned features. Finally, MDCN introduces Modality Relational Knowledge Distillation (MRKD), which uses hierarchical cosine angular distillation to distill valuable high-level semantic relationships from modality-specific and modality-shared branches into modality-contextual image features. This enhances the modality-aware distinguishability in modality-contextual representation and ensures a more refined representation of cross-modal information.

**Fig. 2:** Overview of the proposed method. The entire learning process of MDCN includes two stages: Stage I (CPDL) and Stage II (SCL+MRKD). CPDL: Given image samples across modalities, we design prompt decoupling learning to generate natural language descriptions corresponding to visible and infrared images respectively. SCL: Considering the semantic coupling of descriptions across different modalities, we introduce modality coupling alignment and modality-contextual alignment to effectively capture and learn their semantic details. MRKD: With the guidance of hierarchical cosine angular distillation, we distill inter-modality cosine relationships from modality-shared features and intra-modality cosine relationships from modality-specific features into the modality context space.

Formally, we define the VI-ReID dataset as $\mathcal{D}_I = \{\mathcal{X}_v,\mathcal{X}_r,\mathcal{Y}_v,\mathcal{Y}_r\}$, where $\mathcal{X}_v = \{x_v^i\}_{i = 1}^{N_v}$ and $\mathcal{X}_r = \{x_r^i\}_{i = 1}^{N_r}$ denote the sets of visible and infrared images, respectively. Here, $x_v^i$ and $x_r^i$ represent the $i$-th visible and infrared samples, while $N_v$ and $N_r$ indicate the corresponding sample counts of the two modalities. The identity label sets are given as $\mathcal{Y}_v = \{y_v^i\}_{i = 1}^{N_v}$ and $\mathcal{Y}_r = \{y_r^i\}_{i = 1}^{N_r}$, which share a unified identity class space across modalities. For simplicity of notation, the visible and infrared modalities are denoted by $t \in \{v, r\}$. Further details are provided in the following subsection.

### A. Context Prompt Decoupling Learning
> (3.1)Traditional learnable text prompts are designed either for modality differences or for identity descriptions, yet they inevitably entangle the two during optimization. A modality-related prompt absorbs identity cues from paired visual features, while an person-related prompt is forced to accommodate the visual discrepancy across modalities. Consequently, the resulting supervision fails to separate what makes a person unique from what makes an image infrared or visible.

> To address these issues, CPDL introduces modality-contextual text prompts that semantically bridge person-related and modality-related cues, and then explicitly decouple them. This design prevents the passive entanglement described above, allowing the model to capture spectral distribution differences between visible and infrared modalities while better preserving identity information.


Traditional learnable text prompts focus solely on modality differences and lack identity-related semantics. They rely on modality-specific text features to guide the model in compensating for modality-specific features, without fully leveraging the potential of CLIP. As a result, the discriminative capability is insufficiently enhanced, which leads to the loss of crucial identity cues and the introduction of noise during the extraction of modality-shared and modality-specific features. 

To address these issues, CPDL introduces modality-contextual text prompts and enforces modality orthogonality. This allows the model to capture spectral distribution differences between visible and infrared modalities while better preserving identity information.

In CPDL, we introduce learnable modality-contextual text prompts with the textual description "A photo of a $[X]_1,[X]_2,\ldots ,[X]_m$ person from $[Z]_1,[Z]_2,\ldots ,[Z]_m$ modality", where $[X]_i$ and $[Z]_i$ $(i\in [1,m])$ represent trainable word tokens corresponding to the person and modality, respectively. $m$ indicates the number of tokens, with their dimensionality matching the word embedding space. To clearly distinguish modality information from identity information, we semantically decouple a modality-contextual text prompt into two parts: a person-related text prompt, "A photo of a $[X]_1,[X]_2,\ldots ,[X]_m$ person", and a modality-related text prompt, "A photo of a person from $[Z]_1,[Z]_2,\ldots ,[Z]_m$ modality". The decoupling corresponds to the $[X]_i$ and $[Z]_i$ $(i\in [1,m])$ components in the modality-contextual prompt, ensuring semantic alignment while distinguishing modality information from identity information. These prompts are independently constructed for each identity across different modalities. We define the complete set of learnable prompts as $\mathcal{D}_T = \{P^i_v, P^i_r, M^i_v, M^i_r, C^i_v, C^i_r\}$, where $C$ denotes the modality-contextual prompt set, and $P$ and $M$ represent the decoupled person-related and modality-related prompt sets, respectively.

> (3.4)Although person-related information is inherently modality-independent, we keep $P_v$ and $P_r$ separate for the two modalities. If a single unified $P$ were shared, it would be forced to reconcile the large visual discrepancy between visible and infrared appearances, diluting modality-specific identity cues. By preserving separate prompts, complete identity information is retained within each modality. In the subsequent coupling stage, these representations are cross-aligned and converge to a unified, modality-invariant identity representation.

The CLIP framework consists of an image encoder $I(\cdot)$ and a text encoder $T(\cdot)$. The image encoder processes both visible and infrared image inputs, enabling the learnable tokens to comprehensively capture identity-discriminative information. We freeze the parameters of $I(\cdot)$ and $T(\cdot)$, and optimize only the text tokens $[X]_i$ and $[Z]_i$ $(i \in [1, m])$. Based on the contrastive learning strategy of CLIP-ReID [5], we employ image-text contrastive loss $L_{i2t}$ and text-image contrastive loss $L_{t2i}$ as optimization objectives:

$$
L^i_{i2t}(V^i, T^i) = -\log \frac{\exp(s(V^i, T^i))}{\sum_{a=1}^{n} \exp(s(V^i, T^a))}, \quad (1)
$$

$$
L^{y_i}_{t2i}(T^{y_i}) = -\frac{1}{|P(y_i)|} \sum_{p \in P(y_i)} \log \frac{\exp(s(V^p, T^{y_i}))}{\sum_{a=1}^{n} \exp(s(V^a, T^{y_i}))}. \quad (2)
$$

Here, the similarity metric is defined as $s(V^i, T^i) = V^i \cdot T^i$, $B$ denotes the batch size, and $V^i$ and $T^{y_i}$ are the embedding features produced by $I(\cdot)$ and $T(\cdot)$, respectively. $P(y_i) = \{ p \in \{1, \ldots, n\} \mid y_p = y_i \}$ contains the indices of all positive samples sharing the identity $y_i$, and $|\cdot|$ denotes the cardinality of a set.

We compute triplet image-text contrastive loss $L^i_{i2ttr}$ and text-image contrastive loss $L^i_{t2itr}$ incorporating three types of learnable text tokens:

$$
L^i_{i2ttr} = L^i_{i2t}(f^i_{Iv}, f^i_{Pv}) + L^i_{i2t}(f^i_{Iv}, f^i_{Mv}) + L^i_{i2t}(f^i_{Iv}, f^i_{Cv}) + L^i_{i2t}(f^i_{Ir}, f^i_{Pr}) + L^i_{i2t}(f^i_{Ir}, f^i_{Mr}) + L^i_{i2t}(f^i_{Ir}, f^i_{Cr}), \quad (3)
$$

$$
L^{y_i}_{t2itr} = L^{y_i}_{t2i}(f^{y_i}_{Pv}) + L^{y_i}_{t2i}(f^{y_i}_{Mv}) + L^{y_i}_{t2i}(f^{y_i}_{Cv}) + L^{y_i}_{t2i}(f^{y_i}_{Pr}) + L^{y_i}_{t2i}(f^{y_i}_{Mr}) + L^{y_i}_{i2t}(f^{y_i}_{Cr}). \quad (4)
$$

Here, $f^i_{Iv}$ and $f^i_{Ir}$ denote the image embeddings of $x^i_v$ and $x^i_r$, respectively, while $f^i_{Pv}$, $f^i_{Mv}$, and $f^i_{Cv}$ represent the text embeddings of the learnable prompts $P^i_v$, $M^i_v$, and $C^i_v$, respectively. Similarly, $f^i_{Pr}$, $f^i_{Mr}$, and $f^i_{Cr}$ denote the text embeddings corresponding to the infrared modality.

To establish differentiated feature spaces for text representations in visible and infrared modalities and eliminate inter-modal feature redundancy, we impose a modality orthogonality constraint on the decoupled modality-related prompts $M^i_v$ and $M^i_r$. This constraint forces the text embeddings of different modalities to maintain maximum separation in the feature space, formulated as:

$$
L^i_{mo} = \frac{1}{|P(y_i)|} \sum_{a \in P(y_i)} f^i_{Mv} \cdot f^a_{Mr}. \quad (5)
$$

Consequently, the overall loss for CPDL is:

$$
L_{cpdl} = L_{i2ttr} + L_{t2itr} + L_{mo}. \quad (6)
$$

By minimizing $L_{cpdl}$, gradients backpropagate through the frozen $I(\cdot)$, thereby optimizing the learnable prompt set $\mathcal{D}_T$.

### B. Semantic Coupling Learning
>(3.1, 1.1)Effectively embedding high-level semantics into visual representations is challenging in VI-ReID. Although CPDL provides clean, decoupled semantic anchors, single image-text alignment primarily captures modality-shared features and neglects a wealth of implicit information. To overcome this, SCL uses these anchors to introduce modality coupling and modality-contextual alignment. It restructures the image encoder into three parallel branches, each guided by different prompt pairings to focus on key semantic attributes.

>(3.2)By selectively pairing person-related and modality-related prompts, SCL directs each branch to a distinct aspect of the input. The modality-specific features $f_{sp}$ focus on identity cues within each modality, the modality-shared features $f_{sh}$ learn cross-modal invariance, and the modality-contextual features $f_{co}$ integrate both, thereby absorbing complementary relational knowledge from the other two feature spaces and facilitating the learning of implicit cross-modal information. The three branches thus produce complementary, non-redundant representations. During stage Ⅱ learning, the parameters of the learnable prompt set $\mathcal{D}_T$ and the text encoder $T(\cdot)$ are frozen, and the optimization focuses only on the image encoder. Via the text encoder, SCL derives three types of semantic text representations as guidance. Correspondingly, the output layer of the image encoder is restructured into three parallel branches to extract visual features from both visible and infrared images. The outputs of these branches are:

In the prompt-based VI-ReID task, effectively embedding high-level semantic information into visual representations has always been a challenge. Single text-image alignment allows the model to learn modality-shared features, but this approach ignores many other implicit informations. To address this, SCL employs modality coupling and modality-contextual alignments to guide the image encoder to emphasize critical attributes based on high-level semantics.

SCL enables the model to jointly learn modality-specific, modality-shared, and modality-contextual features. During learning, the parameters of the learnable prompt set $\mathcal{D}_T$ and the text encoder $\mathcal{T}(\cdot)$ are frozen, and the optimization focuses only on the image encoder. Via the text encoder, SCL derives three types of semantic text representations as guidance. Correspondingly, the output layer of the image encoder is restructured into three parallel branches to extract visual features from both visible and infrared images. The outputs of these branches are:

$$
f^i_{spv} = I_{sp}(I_s(x_v^i)), \quad f^i_{spr} = I_{sp}(I_s(x_r^i))
$$

$$
f^i_{shv} = I_{sh}(I_s(x_v^i)), \quad f^i_{shr} = I_{sh}(I_s(x_r^i)),
$$

$$
f^i_{cov} = I_{co}(I_s(x_v^i)), \quad f^i_{cor} = I_{co}(I_s(x_r^i)) \quad (7)
$$

>(2.2) where $I_s$ denotes the shared layers (the first three stages of ResNet-50), and $I_{sp}$, $I_{sh}$, and $I_{co}$ branch off from Stage 4, corresponding to the modality-specific, modality-shared, and modality-contextual layers, respectively. The image–text alignment cross-entropy loss $\xi$ is used to align visible and infrared modalities with textual information:

where $I_s$ denotes the shared layers, and $I_{sp}$, $I_{sh}$, and $I_{co}$ correspond to the modality-specific, modality-shared, and modality-contextual layers, respectively. The image–text alignment cross-entropy loss $\xi$ is used to align visible and infrared modalities with textual information:

$$
\xi(f^i_{spv}, f^{y_i}_{Pv}) = \sum_{i=1}^{n_v} q_i \log \frac{\exp(s(f^i_{spv}, f^{y_i}_{Pv}))}{\sum_{y_a=1}^{N_c} \exp(s(f^i_{spv}, f^{y_a}_{Pv}))}, \quad (8)
$$

where $n_v$ denotes the number of visible images in a batch.

For modality-specific feature learning, we employ modality coupling alignment within each modality, where person-related and modality-related prompts are coupled to compute and match visible and infrared image features. This facilitates intra-modal semantic alignment, as shown below:

$$
L^{sp}_{i2tce} = \xi(f_{spv}, f_{Pv}) + \xi(f_{spv}, f_{Mv}) + \xi(f_{spr}, f_{Pr}) + \xi(f_{spr}, f_{Mr}). \quad (9)
$$

During modality-shared feature learning, we use modality coupling alignment across modalities, where person-related and modality-related prompts are cross-modally aligned and coupled. This forces the model to capture high-level semantic information across different modalities and facilitates the learning of modality-shared pedestrian representations between visible and infrared images. The loss function is defined as:

$$
L^{sh}_{i2tce} = \xi(f_{shv}, f_{Pr}) + \xi(f_{shv}, f_{Mv}) + \xi(f_{shr}, f_{Pv}) + \xi(f_{shr}, f_{Mr}). \quad (10)
$$

In addition, since modality-contextual prompts encapsulate richer high-level semantic information, we further perform modality-contextual alignment. It aligns modality-contextual features with modality-contextual prompts to preserve feature integrity and mitigate information loss during decoupling and coupling. Its formula is as follows:

$$
L^{co}_{i2tce} = \xi(f_{co}, f_{cv}) + \xi(f_{co}, f_{cr}). \quad (11)
$$

The image-text alignment loss and ReID loss are integrated together to obtain the loss functions for each branch:

$$
\begin{aligned} & \mathcal{L}_{co} = \mathcal{L}_{reid}(f_{co}) + \mathcal{L}^{co}_{i2tce} \\ & \mathcal{L}_{sp} = \mathcal{L}_{reid}(f_{sp}) + \mathcal{L}^{sp}_{i2tce} \\ & \mathcal{L}_{sh} = \mathcal{L}_{reid}(f_{sh}) + \mathcal{L}^{sh}_{i2tce} \end{aligned} \quad (12)
$$

where $\mathcal{L}_{reid}$ consists of ID loss and weighted triplet loss.

Finally, the overall loss of the SCL module is:

$$
\mathcal{L}_{scl} = \lambda_1\mathcal{L}_{co} + \lambda_2\mathcal{L}_{sp} + \lambda_3\mathcal{L}_{sh}, \quad (13)
$$

where $\lambda_1, \lambda_2$ and $\lambda_3$ are hyperparameters used to balance each loss term.

### C. Modality Relational Knowledge Distillation
The proposed method introduces prompt coupling with cosine alignment to refine the spatial structure of image features, thereby enhancing semantic-aware discriminability across all three feature types. However, no single feature space alone suffices for robust retrieval, since each implicitly captures valuable high-level semantic relationships both within and across modalities. As shown in Figure \ref{fig:m2}, the modality-specific space exhibits compact intra-modal distributions with small angular variations, while nearly orthogonal structures appear across modalities. In contrast, the modality-shared space reveals stable cross-modal correlations but relatively weaker intra-modal discriminability. As shown in the cosine space analysis in Figure \ref{fig:m2}, the modality-specific feature space exhibits compact intra-modal distributions with small angular variations, while nearly orthogonal spatial structures appear between cross-modal samples. In contrast, the modality-shared feature space reveals stable cross-modal correlations but suffers from relatively weaker intra-modal discriminability.


>(3.1)SCL produces three complementary feature spaces through prompt coupling and cosine alignment, refining the spatial structure of visual features and enhancing semantic-aware discriminability across all three feature types. However, no single feature space alone suffices for robust retrieval, since each implicitly captures valuable high-level semantic relationships both within and across modalities. As shown in Figure~3, the modality-specific space exhibits compact intra-modal distributions with small angular variations, while nearly orthogonal structures appear across modalities. In contrast, the modality-shared space reveals stable cross-modal correlations but relatively weaker intra-modal discriminability. To exploit these complementary cues, we use the modality-contextual features $f_{co}$ to absorb such implicit knowledge from the other two spaces, equipping it with both intra-modal compactness and cross-modal consistency. $f_{co}$ is supervised by the full modality-contextual prompt $C$, which fuses person-related and modality-related semantics, making it a holistic representation naturally suited for integrating diverse relational knowledge without introducing redundancy.

>(3.1)To extract and transfer this implicit relational knowledge, we introduce MRKD based on Relational Knowledge Distillation (RKD) [40]. It employs hierarchical cosine angular distillation, which encodes angular relationships from different feature spaces into transferable knowledge representations. Specifically, by constructing triplet samples $(f^i, f^j, f^k)$, we compute the cosine values of the angles formed in the feature representation space:

SCL 通过提示耦合与余弦对齐生成三个互补的特征空间，这细化了视觉特征的空间结构，并增强了所有三种特征类型的语义感知判别能力。然而，仅依靠其中一个特征去图像检索是达不到效果，因为每个特征中都包含这模态内部及模态之间隐含的有价值高层语义关系，而这些关系同时存在于模态共享和模态特定特征中。所以，我们利用模态上下文特征收来自另外两个特征空间隐式的有有价值高级语义关系信息，从而促进隐式跨模态信息的学习。

然而，仅依靠模态上下文特征进行行人图像检索是不够的，因为它忽略了模态内部及模态之间隐含的高层语义关系，而这些关系同时存在于模态共享和模态特定特征中。

然而，作为检索主要表征的模态上下文特征 ，并未明确编码其他两个空间中存在的关系结构。这些结构捕捉了样本在模态内部及跨模态之间的分布方式，代表了可进一步助力跨模态检索的高层几何知识

The proposed method introduces prompt coupling with cosine alignment to refine the spatial structure of image features, thereby enhancing semantic-aware discriminability across all three feature types. 


However, relying solely on modality-contextual features for pedestrian image retrieval is insufficient because it overlooks high-level semantic relationships within and across modalities, which exist in both modality-shared and modality-specific features. As shown in the cosine space analysis in Figure 3, the modality-specific feature space exhibits compact intra-modal distributions with small angular variations, while nearly orthogonal spatial structures appear between cross-modal samples. In contrast, the modality-shared feature space reveals stable cross-modal correlations but suffers from relatively weaker intra-modal discriminability.

To fuse valuable high-level semantic information between modality-specific and modality-shared features, and further enhance the modality-aware discriminability of modality-contextual representations, we introduce MRKD based on Relational Knowledge Distillation (RKD) [40]. It is designed with hierarchical cosine angular distillation, which encodes cosine angular relationships from different feature spaces into transferable knowledge representations. Specifically, by constructing triplet samples $(f^i, f^j, f^k)$, we compute the cosine values of the angles formed in the feature representation space:

**Fig. 3:** Illustration of MRKD: Modality-specific features $(f_{sp})$ emphasize intra-modality discriminability, modality-shared features $(f_{sh})$ strengthen cross-modal consistency, and modality-contextual features $(f_{co})$ integrate higher-level semantic cues. MRKD leverages inter- and intra-modality to distill high-level semantic relationships across these spaces.

$$
\begin{aligned} & \cos \angle f^i f^j f^k = \langle e^{ij}, e^{kj} \rangle \\ & e^{ij} = \frac{f^i - f^j}{\|f^i - f^j\|_2}, \quad e^{kj} = \frac{f^k - f^j}{\|f^k - f^j\|_2}, \end{aligned} \quad (14)
$$

where $\langle \cdot ,\cdot \rangle$ denotes the vector inner product, and $e^{ij}$ and $e^{kj}$ represent the unit vectors pointing from $f^j$ to $f^i$ and from $f^j$ to $f^k$, respectively.

For different feature spaces, we employ a hierarchical angular distillation strategy. In the modality-specific feature space, we extract the angular relationships within each modality and enforce inter-modality forgetting. Accordingly, intra-modal angular relation pairs are defined as follows:

>For different feature spaces, we employ a hierarchical angular distillation strategy. In the modality-specific feature space, we extract the angular relationships within each modality and enforce inter-modality forgetting, (3.5)deliberately discarding cross-modal angular relationships during distillation. This prevents modality-specific features from being contaminated by cross-modal inconsistencies and preserves pure intra-modal discriminative cues. Accordingly, intra-modal angular relation pairs are defined as follows:

$$
\begin{aligned} & \mathcal{R}_{spv}^{ijk} = [\cos \angle f_{spv}^i f_{spv}^j f_{spv}^k, \cos \angle f_{cov}^i f_{cov}^j f_{cov}^k] \\ & \mathcal{R}_{spr}^{ijk} = [\cos \angle f_{spr}^i f_{spr}^j f_{spr}^k, \cos \angle f_{cor}^i f_{cor}^j f_{cor}^k] \end{aligned} \quad (15)
$$

The relational knowledge distillation loss for the modality-specific feature space is:

$$
\mathcal{L}_{rkd}^{sp} = \sum_{(i,j,k)\in B} l_{\delta}(\mathcal{R}_{spv}^{ijk}) + \sum_{(i,j,k)\in B} l_{\delta}(\mathcal{R}_{spr}^{ijk}), \quad (16)
$$

where $l_{\delta}$ denotes the Huber loss function.


>Conversely, for the modality-shared feature space, we enforce intra-modality forgetting, (3.5)deliberately discarding intra-modal angular relationships during distillation. This prevents modality-shared features from being influenced by modality-specific cues and preserves pure cross-modal consistency. The cross-modal angular relation distillation pairs are formulated as:

Conversely, for the modality-shared feature space, we enforce intra-modality forgetting. The cross-modal angular relation distillation pairs are formulated as:

$$
\begin{aligned} & \mathcal{R}_{shv}^{ijk} = [\cos \angle f_{shv}^i f_{shv}^j f_{shv}^k, \cos \angle f_{cov}^i f_{cov}^j f_{cov}^k] \\ & \mathcal{R}_{shr}^{ijk} = [\cos \angle f_{shr}^i f_{shr}^j f_{shr}^k, \cos \angle f_{cor}^i f_{cor}^j f_{cor}^k] \end{aligned} \quad (17)
$$

The relational knowledge distillation loss for the modality-shared feature space is:

$$
\mathcal{L}_{rkd}^{sh} = \sum_{(i,j,k)\in B} l_{\delta}(\mathcal{R}_{sh}^{v}) + \sum_{(i,j,k)\in B} l_{\delta}(\mathcal{R}_{sh}^{r}). \quad (18)
$$

By combining the distillation objectives of modality-specific and modality-shared feature spaces, the complete loss in MRKD is:

$$
\mathcal{L}_{mrkd} = \mathcal{L}_{rkd}^{sp} + \mathcal{L}_{rkd}^{sh}. \quad (19)
$$

### D. Training and Inference

The overall training pipeline of MDCN is outlined in Algorithm 1. In the first stage, CPDL initializes image and text encoders via the pre-trained CLIP and introduces a set of learnable text prompts, including person-related, modality-related, and modality-contextual text tokens. These prompts are iteratively optimized based on the corresponding image features.

> **Algorithm 1:** MDCN's Training Process
>
> **Input:** Training image sample set $\mathcal{D}_I$, text encoder $\mathcal{T}(\cdot)$ and image encoder $\mathcal{I}(\cdot)$ from Pre-trained CLIP.
> **Output:** Trained visual encoders $\mathcal{I}_{sp}, \mathcal{I}_{sh}, \mathcal{I}_{co}$ and $\mathcal{I}_s$.
>
> 1: **Stage I: Training CPDL**
> 2: Initialize learnable text prompts $\mathcal{D}_T$
> 3: Freeze parameters in $\mathcal{T}(\cdot)$ and $\mathcal{I}(\cdot)$
> 4: **while** Training is not over **do**
> 5: &nbsp;&nbsp;&nbsp;&nbsp;Extract image features $f_{\mathcal{I}}^i = \mathcal{I}(x^i)$
> 6: &nbsp;&nbsp;&nbsp;&nbsp;Obtain modality-contextual text features $f_{\mathcal{C}}^i = \mathcal{T}(\mathcal{C}^i)$, modality-contextual text features $f_{\mathcal{P}}^i = \mathcal{T}(\mathcal{P}^i)$ and modality-shared text features $f_{\mathcal{M}}^i = \mathcal{T}(\mathcal{M}^i)$
> 7: &nbsp;&nbsp;&nbsp;&nbsp;Compute $\mathcal{L}_{i2ttr}$, $\mathcal{L}_{t2itr}$ and $\mathcal{L}_{mo}$ to update learnable text tokens set by minimizing Eq.(6)
> 8: **end while**
> 9: **Stage II: Training SCL and MRKD**
> 10: Freeze parameters in $\mathcal{T}(\cdot)$ and learnable text tokens in $\mathcal{D}_T$
> 11: Extract text features $f_{\mathcal{C}}$, $f_{\mathcal{P}}$ and $f_{\mathcal{M}}$ for all IDs
> 12: **while** Training is not over **do**
> 13: &nbsp;&nbsp;&nbsp;&nbsp;Extract modality-shared features $f_{sh}^i = \mathcal{I}_{sh}(\mathcal{I}_{sh}(x^i))$, modality-specific features $f_{sp}^i = \mathcal{I}_{sp}(\mathcal{I}_{sh}(x^i))$ and modality-contextual features $f_{co}^i = \mathcal{I}_{co}(\mathcal{I}_{sh}(x^i))$
> 14: &nbsp;&nbsp;&nbsp;&nbsp;Compute $\mathcal{L}_{co}$, $\mathcal{L}_{sp}$ and $\mathcal{L}_{sh}$ to update $f_{sh}^i$, $f_{sp}^i$ and $f_{co}^i$ by minimizing Eq.(13)
> 15: &nbsp;&nbsp;&nbsp;&nbsp;Optimize modality-contextual features $f_{co}^i$ by obtaining semantic-aware discriminability from $f_{sp}^i$ and $f_{sh}^i$ by minimizing Eq.(19)
> 16: &nbsp;&nbsp;&nbsp;&nbsp;Optimize visual encoders $\mathcal{I}_{co}$, $\mathcal{I}_{sp}$, $\mathcal{I}_{sh}$ and $\mathcal{I}_s$
> 17: **end while**

During inference, we exclusively utilize the modality-contextual features $(f_{co})$ extracted by the image encoder for cross-modality person matching. To enhance the robustness of metric learning, we introduce a hybrid distance metric that combines Euclidean distance with cosine similarity:

$$
D_{\mathrm{joint}} = 0.3 \cdot \Delta(f_{co}^{q}, f_{co}^{g}) + 0.7 \cdot \Theta(f_{co}^{q}, f_{co}^{g}). \quad (20)
$$

Here $\Delta(\cdot ,\cdot)$ denotes the Euclidean distance and $\Theta(\cdot ,\cdot)$ represents the cosine distance. $f_{co}^{q}$ and $f_{co}^{g}$ denote the query and gallery modality-contextual features, respectively.

Euclidean distance preserves the absolute magnitude relationships of features, while cosine distance emphasizes angular similarity in the embedding space. By balancing these two complementary metrics, we can effectively enhance both discriminability and stability in cross-modal retrieval.

---

## IV. EXPERIMENTS

### A. Datasets and Experimental Settings

**Datasets.** We conduct experiments on three benchmark datasets: SYSU-MM01 [41], RegDB [55], and LLCM [51].

**SYSU-MM01**, the most challenging large-scale benchmark for VI-ReID, contains 287,628 visible images and 15,792 infrared images from 491 identities. It is captured through 4 visible cameras and 2 infrared cameras in indoor/outdoor hybrid environments. The training set contains 22,258 visible images and 11,909 infrared images from 395 identities. The query set includes 96 identities with 3,803 infrared images, while the gallery set consists of 301 and 3,010 randomly selected visible images. The evaluation protocol employs a reversed cross-modality retrieval setting where infrared images query visible images. Two test scenarios are provided: all-search (indoor/outdoor) and indoor-search (indoor cameras only). For gallery construction, single-shot (one image per identity) and multi-shot (ten images per identity) sampling strategies are supported. We comprehensively evaluate performance under all these configurations.

**RegDB**, a small-scale VI-ReID dataset, is collected through one visible camera and one paired infrared camera. It contains 8,240 images of 412 identities, with 206 identities used for training and 206 identities for testing. Each identity has 10 visible and 10 infrared images. The training set consists of images from 206 randomly selected identities, and the test set is formed from the images of the other 206 identities. Two test modes are evaluated, consisting of visible-to-infrared retrieval and infrared-to-visible retrieval. For both modes, we perform 10 test iterations and report the average results to ensure accuracy and fairness.

**LLCM**, the low-light cross-modality dataset, is collected under extremely low-light conditions through 9 visible/infrared cameras. It contains 46,767 images of 1,064 identities, with each identity captured by at least one visible and one infrared camera. The training set has 30,921 images from 713 identities, including 16,946 visible images and 13,975 infrared images; while the test set contains 15,846 images from 351 identities, with 8,680 visible images and 7,166 infrared images. Both visible-to-infrared and infrared-to-visible modes are used to evaluate the performance of VI-ReID models. This process is repeated 10 times with different random gallery splits, and the average results are reported to ensure reliability and fairness.

**Evaluation metrics.** Following previous works, Cumulative Matching Characteristics (CMC) and mean Average Precision (mAP) are used as evaluation metrics in this paper. CMC-k (i.e., Rank-k) calculates the probability that a correct match appears in the top-k retrieval results, while mAP offers a comprehensive evaluation of retrieval performance.

**Implementation Details.** Our proposed method and all experiments are implemented on a single NVIDIA GeForce 4090 GPU using the PyTorch framework. The network adopts a three-stream architecture, with a modified ResNet-50 pretrained on CLIP serving as the backbone for feature extraction. Input images are resized to $384 \times 144$, and data augmentation strategies such as random flipping, grayscaling [60], and random erasing are applied.

---

### B. Comparison with State-of-the-Art Methods

#### 1) Comparison on SYSU-MM01

**TABLE I:** Performance comparison with state-of-the-art methods on SYSU-MM01: CMC $(\%)$ and mAP $(\%)$

| Methods               | All-search`<br>`r=1 | All-search`<br>`r=10 | All-search`<br>`r=20 | All-search`<br>`mAP | Indoor-search`<br>`r=1 | Indoor-search`<br>`r=10 | Indoor-search`<br>`r=20 | Indoor-search`<br>`mAP | Single-shot`<br>`r=1 | Single-shot`<br>`r=10 | Single-shot`<br>`r=20 | Single-shot`<br>`mAP | Multi-shot`<br>`r=1 | Multi-shot`<br>`r=10 | Multi-shot`<br>`r=20 | Multi-shot`<br>`mAP |
| --------------------- | --------------------- | ---------------------- | ---------------------- | --------------------- | ------------------------ | ------------------------- | ------------------------- | ------------------------ | ---------------------- | ----------------------- | ----------------------- | ---------------------- | --------------------- | ---------------------- | ---------------------- | --------------------- |
| Zero-Padding [41]     | 14.80                 | 54.12                  | 71.33                  | 15.95                 | 19.13                    | 61.40                     | 78.41                     | 10.89                    | 20.58                  | 68.38                   | 85.79                   | 26.92                  | 24.43                 | 75.86                  | 91.32                  | —                    |
| D-HSME [42]           | 20.68                 | 62.74                  | 77.95                  | 23.12                 | —                       | —                        | —                        | —                       | —                     | —                      | —                      | —                     | —                    | —                     | —                     | —                    |
| AlignGAN [10]         | 42.40                 | 85.00                  | 93.70                  | 40.70                 | 51.50                    | 89.40                     | 95.70                     | 33.90                    | 45.90                  | 87.60                   | 94.40                   | 54.30                  | 57.10                 | 92.70                  | 97.40                  | —                    |
| DDAG [43]             | 54.75                 | 90.39                  | 95.81                  | 53.02                 | —                       | —                        | —                        | —                       | 61.02                  | 94.06                   | 98.41                   | 67.98                  | —                    | —                     | —                     | —                    |
| NFS [44]              | 56.91                 | 91.34                  | 96.52                  | 55.45                 | 63.51                    | 94.42                     | 97.81                     | 48.56                    | 62.79                  | 96.53                   | 99.07                   | 69.79                  | 70.03                 | 97.70                  | 99.51                  | —                    |
| MCLNet [45]           | 65.40                 | 93.33                  | 97.14                  | 61.98                 | —                       | —                        | —                        | —                       | 72.56                  | 96.98                   | 99.20                   | 76.58                  | —                    | —                     | —                     | —                    |
| CAJ [46]              | 69.88                 | 95.71                  | 98.40                  | 66.89                 | —                       | —                        | —                        | —                       | 76.26                  | 97.88                   | 99.49                   | 80.37                  | —                    | —                     | —                     | —                    |
| MPANet [47]           | 70.58                 | 96.21                  | 98.80                  | 68.24                 | 75.58                    | 97.91                     | 99.43                     | 62.91                    | 76.74                  | 98.21                   | 99.57                   | 80.95                  | 84.22                 | 99.66                  | 99.96                  | —                    |
| FMCNet [17]           | 66.34                 | —                     | —                     | 62.51                 | 73.44                    | —                        | —                        | 56.06                    | 68.15                  | —                      | —                      | 74.09                  | 78.86                 | —                     | —                     | —                    |
| CMT [48]              | 71.88                 | 96.45                  | 98.87                  | 68.57                 | 80.23                    | 97.91                     | 99.53                     | 63.13                    | 76.90                  | 97.68                   | 99.64                   | 79.91                  | 84.87                 | 99.41                  | 99.97                  | —                    |
| DSCNet [49]           | 73.89                 | 96.27                  | 98.84                  | 69.47                 | —                       | —                        | —                        | —                       | 79.35                  | 98.32                   | 99.77                   | 82.65                  | —                    | —                     | —                     | —                    |
| MSCLNet [50]          | 76.99                 | 97.63                  | 99.18                  | 71.64                 | —                       | —                        | —                        | —                       | 78.49                  | 99.32                   | 99.91                   | 81.17                  | —                    | —                     | —                     | —                    |
| DEEN [51]             | 74.70                 | 97.60                  | 99.20                  | 71.80                 | —                       | —                        | —                        | —                       | 80.30                  | 99.00                   | 99.80                   | 83.30                  | —                    | —                     | —                     | —                    |
| SAAI [52]             | 75.90                 | —                     | —                     | 77.03                 | 82.80                    | —                        | —                        | 82.39                    | —                     | —                      | 88.01                   | 90.73                  | —                    | —                     | 91.30                  |                       |
| SGIE [33]             | 77.12                 | 97.03                  | 99.08                  | 72.33                 | —                       | —                        | —                        | —                       | 82.07                  | 97.42                   | 98.87                   | 82.95                  | —                    | —                     | —                     | —                    |
| PartMix [13]          | 77.78                 | —                     | —                     | 74.62                 | 80.54                    | —                        | —                        | 69.84                    | 81.52                  | —                      | 84.38                   | 87.99                  | —                    | —                     | 79.95                  |                       |
| DMA [7]               | 74.57                 | —                     | —                     | 70.41                 | 83.03                    | —                        | —                        | 65.55                    | 82.85                  | —                      | 85.10                   | 91.33                  | —                    | —                     | 80.49                  |                       |
| WRIM-Net [53]         | 77.40                 | —                     | —                     | 75.40                 | 83.20                    | —                        | —                        | 71.10                    | 86.20                  | —                      | 88.10                   | 92.10                  | —                    | —                     | 85.60                  |                       |
| IDKL [16]             | 81.42                 | 97.38                  | 98.89                  | 79.85                 | 84.34                    | 98.89                     | 99.73                     | 78.22                    | 87.14                  | 98.28                   | 99.26                   | 89.37                  | 94.30                 | 99.71                  | 99.93                  | —                    |
| DSAF [54]             | 76.42                 | 97.71                  | —                     | 73.24                 | 83.48                    | 99.27                     | —                        | —                       | 83.78                  | 92.62                   | 98.20                   | —                     | 86.37                 | 93.25                  | 98.98                  | —                    |
| DiVE [31]             | 79.07                 | —                     | —                     | 74.96                 | —                       | —                        | —                        | —                       | 82.98                  | —                      | 85.90                   | —                     | —                    | —                     | —                     | —                    |
| MIP [39]              | 70.84                 | —                     | —                     | 66.41                 | 74.68                    | —                        | —                        | —                       | —                     | —                      | —                      | 79.92                  | 82.29                 | —                     | —                     | —                    |
| TMAL [19]             | 70.58                 | 96.67                  | 98.93                  | 73.96                 | —                       | —                        | —                        | —                       | 76.17                  | 98.56                   | 99.79                   | 82.70                  | —                    | —                     | —                     | —                    |
| CSDN [20]             | 75.20                 | 96.60                  | 98.80                  | 71.80                 | 80.60                    | 98.30                     | 99.70                     | 66.30                    | 82.00                  | 98.70                   | 99.50                   | 85.00                  | 88.50                 | 99.60                  | 99.90                  | —                    |
| CLIP-MC [25]          | 78.06                 | 97.93                  | 99.32                  | 76.49                 | —                       | —                        | —                        | —                       | 84.51                  | 98.75                   | 99.82                   | 87.02                  | —                    | —                     | —                     | —                    |
| **MDCN (Ours)** | **82.67**       | **97.78**        | **99.41**        | **80.24**       | **85.17**          | **98.92**           | **99.78**           | **79.56**          | **88.04**        | **98.79**         | **99.55**         | **89.83**        | **94.83**       | **99.86**        | **99.97**        | —                    |

---

#### 2) Comparison on RegDB

**TABLE II:** Performance comparison with state-of-the-art methods on RegDB: CMC $(\%)$ and mAP $(\%)$

| Methods               | Visible to Infrared`<br>`Rank-1 | Visible to Infrared`<br>`mAP | Infrared to Visible`<br>`Rank-1 | Infrared to Visible`<br>`mAP |
| --------------------- | --------------------------------- | ------------------------------ | --------------------------------- | ------------------------------ |
| Zero-Padding [41]     | 17.80                             | 18.90                          | 16.70                             | 17.90                          |
| AlignGAN [10]         | 57.90                             | 53.60                          | 56.30                             | 53.40                          |
| DDAG [43]             | 69.34                             | 63.46                          | 68.06                             | 61.80                          |
| MCLNet [45]           | 80.31                             | 73.07                          | 75.93                             | 69.49                          |
| MPANet [47]           | 83.70                             | 80.90                          | 82.80                             | 80.70                          |
| SMCL [56]             | 83.93                             | 79.83                          | 83.05                             | 78.57                          |
| CAJ [46]              | 85.03                             | 77.82                          | 84.75                             | 77.82                          |
| MSCLNet [50]          | 84.17                             | 80.99                          | 83.86                             | 78.31                          |
| MID [57]              | 87.45                             | 84.85                          | 84.29                             | 81.41                          |
| FMCNet [17]           | 89.12                             | 84.43                          | 88.38                             | 83.86                          |
| CMT [48]              | 95.17                             | 87.30                          | 91.97                             | 84.46                          |
| SGIE [33]             | 91.07                             | 85.23                          | 92.18                             | 86.59                          |
| SAAI [52]             | 91.07                             | 91.45                          | 92.09                             | 92.01                          |
| DEEN [51]             | 91.10                             | 85.10                          | 89.50                             | 83.40                          |
| DARD [58]             | 86.19                             | 85.39                          | 85.53                             | 85.09                          |
| WGCN [8]              | 90.61                             | 84.53                          | 88.77                             | 81.61                          |
| DMA [7]               | 93.30                             | 88.34                          | 91.50                             | 86.80                          |
| WRIM-Net [53]         | 94.50                             | 90.50                          | 93.70                             | 89.70                          |
| IDKL [16]             | 94.72                             | 90.19                          | 94.22                             | 90.43                          |
| DSAF [54]             | 92.62                             | 86.37                          | 93.25                             | 87.17                          |
| CM-DASN [59]          | 94.45                             | 91.39                          | 93.66                             | 91.41                          |
| MIP [39]              | 92.38                             | 85.99                          | 91.26                             | 85.90                          |
| TMAL [19]             | 82.65                             | 85.00                          | —                                | —                             |
| CSDN [20]             | 91.50                             | 87.40                          | 93.00                             | 88.90                          |
| CLIP-MC [25]          | 92.43                             | 88.56                          | 93.12                             | 89.67                          |
| **MDCN (Ours)** | **95.13**                   | **91.62**                | **94.88**                   | **91.35**                |

---

#### 3) Comparison on LLCM

As shown in Table III, a comprehensive evaluation on LLCM dataset confirms the robust generalization capability of MDCN under complex low-light conditions. It achieves mAP values of $68.75\%$ and $67.82\%$ in two retrieval modes, respectively, setting a new state-of-the-art benchmark. This consistent superiority across diverse environmental conditions highlights the effectiveness of our method in handling challenging multi-modal data distributions and illumination variations.

Notably, MDCN exhibits significant advantages over other prompt-based methods, such as TMAL [19], CSDN [20], and CLIP-MC [25], demonstrating the effectiveness of our method.

---

### C. Ablation Studies

We conduct ablation studies on SYSU-MM01 dataset under the all-search single-shot setting to comprehensively evaluate the contribution of each component in MDCN. The overall experimental configuration remains consistent, and only the evaluated module is modified.

#### 1) Effectiveness of Key Components

We adopt CLIP-VIReID [20] as the baseline model and progressively incorporate each component to evaluate its individual contributions to the performance of MDCN. As shown in Table IV, the inclusion of CPDL (w/o $\mathcal{L}_{MO}$) and SCL significantly improves the performance, with a $+5.37\%$ increase in Rank-1 accuracy and a $+4.38\%$ gain in mAP compared to the baseline. Further integrating the modal orthogonality constraint into CPDL can improve Rank-1 by an additional $+1.56\%$ and mAP by an additional $+1.43\%$. These results validate the importance of explicitly decoupling modality-contextual semantics into personalized and modality-related semantics. Moreover, the results demonstrate that SCL and CPDL work synergistically to fully exploit decoupled semantics, thereby enhancing retrieval robustness. MRKD achieves the most significant improvement in mAP, with a $+3.03\%$ increase, highlighting its strong ability to refine the feature space structure. By distilling angular relations from hybrid features, MRKD effectively transfers intra-modality compactness (from modality-specific features) and inter-modality consistency (from modality-shared features) into the modality-contextual feature space. This structured knowledge transfer significantly enhances the discriminative ability on hard samples. Ultimately, MDCN achieves $82.67\%$ in Rank-1 and $80.24\%$ in mAP.

**TABLE IV:** Ablation experimental results of each component in MDCN on SYSU-MM01.

| Methods | Base | CPDL`<br>`$L_{i2ttr} + L_{t2itr}$ | CPDL`<br>`$L_{mo}$ | SCL | MRKD | SYSU-MM01`<br>`Rank-1 | SYSU-MM01`<br>`mAP |
| ------- | ---- | ------------------------------------- | ---------------------- | --- | ---- | ----------------------- | -------------------- |
| 1       | ✓   |                                       |                        |     |      | 73.90                   | 71.40                |
| 2       | ✓   | ✓                                    |                        | ✓  |      | 79.27                   | 75.78                |
| 3       | ✓   | ✓                                    | ✓                     | ✓  |      | 80.83                   | 77.21                |
| 4       | ✓   | ✓                                    | ✓                     | ✓  | ✓   | **82.67**         | **80.24**      |

---

#### 2) MRKD Distillation Targets

We conduct experiments to verify the effectiveness of the MRKD design, which applies intra-modality distillation to modality-specific features and inter-modality distillation to modality-shared features. Table V reports the results. MRKD distills high-level semantic relationships from both modality-shared and modality-specific features into the modality-contextual feature space. The inter-modality constraint enforces spatial relationship alignment across modalities, while the intra-modality constraint preserves consistent angular relationships within each modality. When no relational constraint is applied, the baseline achieves $80.83\%$ Rank-1 and $77.21\%$ mAP. For Methods 2-4, where no constraints are applied to modality-specific features or only the inter-modality constraint is applied, performance slightly decreases. However, when the intra-modality constraint is introduced, Rank-1 accuracy increases by $+0.36\%$ and mAP improves by $+0.30\%$. This confirms that modality-specific features contain identity-aware discriminative information, and properly structured constraints are essential for preserving discriminative intra-modal characteristics. Similarly, for Methods 5-6, the results show that modality-shared features contain a significant amount of identity-aware discriminative information. Furthermore, as demonstrated in Methods 7-8, when both inter-modality and intra-modality constraints are applied, Rank-1 accuracy improves by $+1.29\%$ and mAP increases by $+2.38\%$. In contrast, the improvement brought by applying the intra-modality constraint alone is small. This suggests that inter-modality constraints play a more substantial role in enhancing the model's ability to align cross-modal features, while intra-modality constraints help preserve fine-grained discriminative details within each modality. Finally, as shown in Methods 9-10, the results demonstrate that our method effectively integrates the semantic-aware discriminability of both feature types, leading to superior cross-modal matching performance.

**TABLE V:** Ablation experimental results on the effects of inter/intra-modality constraints in modality-shared and modality-specific features.

| Methods | Modality-Shared`<br>`Inter | Modality-Shared`<br>`Intra | Modality-Specific`<br>`Inter | Modality-Specific`<br>`Intra | SYSU-MM01`<br>`Rank-1 | SYSU-MM01`<br>`mAP |
| ------- | ---------------------------- | ---------------------------- | ------------------------------ | ------------------------------ | ----------------------- | -------------------- |
| 1       |                              |                              |                                |                                | 80.83                   | 77.21                |
| 2       | ✓                           |                              | ✓                             |                                | 80.58                   | 76.80                |
| 3       |                              | ✓                           |                                | ✓                             | 80.21                   | 76.52                |
| 4       |                              |                              |                                | ✓                             | 81.19                   | 77.51                |
| 5       | ✓                           |                              |                                |                                | 82.18                   | 79.73                |
| 6       |                              | ✓                           |                                |                                | 82.36                   | 79.85                |
| 7       |                              |                              | ✓                             | ✓                             | 81.03                   | 77.37                |
| 8       | ✓                           | ✓                           |                                |                                | 82.12                   | 79.59                |
| 9       | ✓                           |                              | ✓                             | ✓                             | 82.05                   | 79.43                |
| 10      | ✓                           | ✓                           | ✓                             | ✓                             | **82.67**         | **80.24**      |

---

#### 3) Prompt Design

The ablation study in Table VI investigates the impact of modality-contextual text prompts on the performance of the proposed MDCN. We test different prompt templates to evaluate how the integration of modality-aware semantics influences cross-modal retrieval. Template 1 does not contain modality-related information and therefore achieves only moderate performance. Similarly, Template 2, which introduces additional contextual words such as condition, shows a slight improvement in performance, suggesting that more complex prompt descriptions can help improve overall results. In contrast, when modality-aware prompts are explicitly incorporated, as shown in Templates 3 and 4, the model achieves a clear performance boost. Notably, Template 4 outperforms Template 2, with an improvement of $+0.81\%$ in Rank-1 accuracy and $+0.63\%$ in mAP. These findings confirm the critical role of modality-aware prompts in enhancing cross-modal matching, as they guide the model to capture modality-specific cues more effectively, thereby strengthening feature alignment across heterogeneous modalities.

**TABLE VI:** Ablation experimental results on the impact of modality-contextual text prompt template design.

| No. | Modality-Contextual Text Prompt Template                                                                   | SYSU-MM01`<br>`Rank-1 | SYSU-MM01`<br>`mAP |
| --- | ---------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------- |
| 1   | "A$[Z]_1, [Z]_2, \ldots, [Z]_m$ photo of a $[X]_1, [X]_2, \ldots, [X]_m$ person"                       | 81.78                   | 79.50                |
| 2   | "A photo of a$[X]_1, [X]_2, \ldots, [X]_m$ person observed in $[Z]_1, [Z]_2, \ldots, [Z]_m$ condition" | 81.86                   | 79.61                |
| 3   | "A photo of a$[X]_1, [X]_2, \ldots, [X]_m$ person, $[Z]_1, [Z]_2, \ldots, [Z]_m$ modality"             | 82.13                   | 79.86                |
| 4   | "A photo of a$[X]_1, [X]_2, \ldots, [X]_m$ person from $[Z]_1, [Z]_2, \ldots, [Z]_m$ modality"         | **82.67**         | **80.24**      |

---

### D. Hyperparameter Analysis

We perform a detailed sensitivity analysis to evaluate the effects of different hyperparameters on the proposed SCL. In particular, we investigate the impact of different loss weights assigned to modality-specific, modality-shared, and modality-contextual features, as well as the impact of the number of tokens used in text prompts. This analysis provides a deeper understanding of how different hyperparameter settings affect overall performance and helps determine a balanced configuration for achieving optimal results.

**Fig. 4:** Hyperparameter analysis of MDCN on SYSU-MM01. The figure illustrates the effects of hyperparameters (a) $\lambda_1$, (b) $\lambda_2$, (c) $\lambda_3$, and (d) $m$ on model performance, measured in terms of Rank-1 accuracy and mAP.

1. **Effect of $\lambda_1$:** As shown in Figure 4 (a), the performance steadily increases as $\lambda_1$ grows from 0.2 to 0.7, peaking at a Rank-1 accuracy of $82.24\%$ and an mAP of $79.86\%$. Beyond this point, further enlarging $\lambda_1$ causes a slight decline in performance, indicating that excessive emphasis on contextual information may suppress other semantic cues. These results suggest that adopting a moderate value of $\lambda_1$ is essential for maintaining a balanced representation across modalities.
2. **Effect of $\lambda_2$:** From Figure 4 (b), we observe a similar trend in which performance improves as $\lambda_2$ increases, reaching a peak around 0.5 with a Rank-1 accuracy of $81.84\%$ and an mAP of $79.84\%$. When the weight continues to grow, performance declines slightly, suggesting that overly strong modality-specific constraints may hinder the integration of shared semantic features. This analysis highlights the importance of assigning a moderate weight to modality-specific features to enhance discriminability while preserving generalization capability.
3. **Effect of $\lambda_3$:** Figure 4 (c) shows the effect of varying $\lambda_3$. Performance increases steadily up to 0.8, at which point the Rank-1 accuracy reaches $82.11\%$ and the mAP reaches $79.89\%$. Compared with $\lambda_1$ and $\lambda_2$, the shared loss exhibits greater robustness, and larger values contribute positively to performance, highlighting the importance of modality-shared representations in cross-modal learning.
4. **Effect of $m$:** Figure 4 (d) presents the results for different numbers of tokens. Both Rank-1 accuracy and mAP improve as $m$ increases from 2 to 8, with the best performance observed at $81.95\%$ Rank-1 and $79.75\%$ mAP. When the number of tokens exceeds 8, performance declines slightly, indicating that excessively long prompts may introduce redundancy or noise. Therefore, setting $m$ to 8 provides an effective balance between semantic richness and optimization stability.

Overall, the hyperparameter analysis shows that achieving balanced weights across contextual, specific, and shared losses is essential for optimal cross-modality feature learning. In particular, the configuration with $\lambda_1$ set to 0.7, $\lambda_2$ to 0.5, $\lambda_3$ to 0.8, and $m$ to 8 delivers the best performance. These findings not only validate the design of SCL but also highlight the effectiveness of jointly leveraging multiple semantic factors to enhance cross-modal representation learning.

82.67 80.24

> (2.4)Overall, the hyperparameter analysis shows that a balanced weighting of the three losses is essential for optimal cross-modal feature learning, with $\lambda_{1}=0.7$, $\lambda_{2}=0.5$, $\lambda_{3}=0.8$, and $m=8$ achieving the best performance. Notably, this configuration is applied uniformly across all three benchmark datasets, and setting all weights to 1 already yields competitive results (Rank-1: 81.93\%, mAP: 79.62\%), indicating that the proposed loss combination is inherently stable and not overly sensitive to parameter selection. These findings validate the design of SCL and highlight the effectiveness of jointly leveraging multiple semantic factors for cross-modal representation learning.

---

### E. Visualization Analysis

#### 1) Attention Maps Visualization

We employ Grad-CAM [64] visualization to highlight the attention regions activated by different feature types and prompt learning strategies, as shown in Figure 5. The original images are provided for reference. The heatmaps reveal that modality-specific features primarily capture modality-dependent details, modality-contextual features emphasize broader contextual semantics, and modality-shared features focus on cross-modal regions. When contextual features are refined through MRKD, the highlighted regions become more compact and semantically coherent, suggesting that MRKD suppresses noise and enhances semantic-aware discriminability. Regarding prompt learning, the standard strategy yields relatively scattered activations across body regions, with limited emphasis on key discriminative parts. In contrast, the proposed CPDL produces more concentrated responses in highly informative regions such as torso and limbs. These results indicate that CPDL not only improves cross-modal alignment but also strengthens the semantic focus of the learned representations.

**Fig. 5:** Visualization of feature activation maps in MDCN for both visible and infrared modalities. From left to right: original input image, modality-specific (sp), modality-contextual (co), modality-shape (sh), enhanced modality-contextual (enhanced), prompt learning (PL), and context prompt decoupling learning (CPDL).

#### 2) Feature Distribution Visualization

To further evaluate the effectiveness of the proposed MDCN, we visualize the feature distributions using t-SNE [65], as illustrated in Figure 6. In the initial distribution (Figure 6 (a)), the features are highly scattered, showing weak cluster compactness and substantial overlaps across classes. After applying the baseline model (Figure 6 (b)), clusters begin to emerge. However, several issues remain: (i) features from the gray and purple classes overlap, making them indistinguishable; (ii) outlier black points are scattered far from the main clusters; and (iii) green cross-modality features remain dispersed instead of forming compact groups. In contrast, with MDCN (Figure 6 (c)), these issues are effectively mitigated. The features exhibit clearer intra-class compactness and stronger inter-class separability, demonstrating MDCN's ability to learn more discriminative and modality-robust representations.

**Fig. 6:** t-SNE visualization of feature distributions on SYSU-MM01. (a) Initial features are scattered and heavily overlapped. (b) Baseline features form partial clusters but with noticeable inter-class confusion. (c) MDCN features exhibit compact clusters and clear separations, indicating improved discriminability.

---

## V. DISSCUSSION

### 创新性

### Novelty
>\textbf{(3.6)The proposed MDCN addresses three fundamental limitations in existing prompt-based VI-ReID methods, namely semantic entanglement in text prompts, insufficient exploitation of high-level semantics in visual learning, and the neglect of implicit relational structures across feature spaces.}

To resolve the passive entanglement between modality-related and person-related semantics in traditional learnable prompts, CPDL introduces modality-contextual text prompts that semantically bridge both types of information and explicitly decouple them into independent components. This provides clean, disentangled semantic anchors that preserve identity information while capturing genuine spectral differences between visible and infrared modalities.

Building upon these anchors, SCL overcomes the limitation of single image-text alignment, which primarily captures modality-shared features and ignores other implicit semantics. SCL restructures the image encoder into three parallel branches, each guided by a distinct coupling strategy. Modality coupling alignment serves the specific branch, cross-modality coupling alignment supervises the shared branch, and modality-contextual alignment guides the contextual branch. By selectively pairing person-related and modality-related prompts, SCL produces complementary, non-redundant representations.

Further, MRKD enriches the modality-contextual features \(f_{co}\) with implicit relational knowledge from the other two feature spaces. While SCL generates three complementary spaces, \(f_{co}\) does not automatically inherit the high-level geometric structures embedded in the modality-specific and modality-shared spaces. MRKD employs hierarchical cosine angular distillation to transfer intra-modal and inter-modal angular relations into \(f_{co}\), enabling it to simultaneously achieve intra-modal compactness and cross-modal consistency.

In summary, MDCN achieves a semantically clean, structurally complementary, and relationally enriched cross-modal representation learning framework through the synergistic design of CPDL, SCL, and MRKD.


### Limitations
> (1.3)Although the proposed MDCN achieves strong cross-modal retrieval performance, it is worth discussing its behavior under partial occlusion, a common challenge in real-world surveillance. Partial occlusion introduces two main difficulties for VI-ReID. First, occluded regions can inject noise into both visual and textual feature extraction, causing the model to inadvertently encode irrelevant information from occluding objects rather than from identity-discriminative body parts. Second, occlusion frequently leads to feature misalignment across views—for instance, a pedestrian’s leg may be visible in the query image but completely blocked in the gallery image.

>In the MDCN framework, these issues can affect the quality of the decoupled semantic priors. The modality-contextual text prompts, which are designed to provide stable high-level semantic guidance, may become less reliable when the corresponding visual input is severely occluded. Consequently, the modality-shared and modality-specific features may lose discriminability, and the hierarchical angular relations used in MRKD could be perturbed by missing or noisy feature dimensions.

>To mitigate such effects, two future directions appear promising. First, part-level feature extraction could be introduced to explicitly focus on visible, unobstructed body regions, thereby reducing the influence of occlusion-induced noise. Second, a local matching strategy could be adopted during retrieval, where part-level correspondences are established to alleviate the feature-mismatch problem. We leave these extensions for future investigation and believe that integrating part-based reasoning into the MDCN paradigm will further enhance its robustness under partial occlusion and other challenging real-world conditions.





## V. CONCLUSION

This paper develops a novel MDCN method to address the challenges of VI-ReID. To the best of our knowledge, MDCN is the first method to introduce modality-contextual text prompts. It jointly leverages CPDL and SCL to facilitate effective multi-modal, multi-feature space learning. Specifically, CPDL uses prompts to decouple features and enforce modality orthogonality, ensuring that modality information is clearly distinguished from identity information. SCL embeds the learned high-level semantic information into visual representations, guiding the image encoder to emphasize critical identity-related attributes. Furthermore, MRKD is proposed to integrate valuable high-level semantic relationships from both modality-shared and modality-specific feature spaces into the modality-contextual feature space, significantly enhancing the extraction of identity-aware valuable information. Extensive experiments on SYSU-MM01, RegDB, and LLCM datasets demonstrate that MDCN consistently achieves robust cross-modal feature alignment and surpasses existing methods under challenging visible-infrared settings. Visualization analyses further reveal that MDCN produces more compact and discriminative feature clusters, effectively emphasizing cross-modal semantic regions while reducing noise. Beyond accuracy gains, our method shows strong potential for real-world cross-spectral surveillance applications, where reliable identity matching under diverse lighting conditions is essential. The integration of CPDL, SCL, and MRKD not only enhances representation discriminability but also establishes a scalable pathway for broader multi-modal learning paradigms.

With the rapid convergence of vision and language technologies, extending MDCN to incorporate textual cues or human-in-the-loop feedback may further strengthen its applicability to intelligent monitoring, forensic analysis, and cross-modal security analytics. We believe that joint modeling of visible modality, infrared modality, and auxiliary textual information is an inevitable trend for future person re-identification systems, paving the way for more accurate, interpretable, and trustworthy cross-modal retrieval in practical deployments.

> (1.4)With the rapid convergence of vision and language technologies, extending MDCN to incorporate textual cues or human‑in‑the‑loop feedback may further strengthen its applicability to intelligent monitoring, forensic analysis, and cross‑modal security analytics. For example, when a target is partially occluded, operators could interactively adjust the learned person‑related prompts, such as emphasizing a specific clothing color, to refine retrieval of ambiguous identities on the fly without retraining. Such interactive prompt tuning injects human prior knowledge into the frozen semantic anchors, making the system more adaptable to hard cases. We believe that jointly modeling visible, infrared, and auxiliary textual information, augmented with flexible human guidance, will pave the way for more accurate, interpretable, and trustworthy cross‑modal retrieval in practical deployments.

---

## REFERENCES

[1] Y. Sun, L. Zheng, Y. Yang, Q. Tian, and S. Wang, "Beyond part models: Person retrieval with refined part pooling (and a strong convolutional baseline)," in *Proc. Eur. Conf. Comput. Vis. (ECCV)*, 2018, pp. 480–496.

[2] H. Rao and C. Miao, "Transg: Transformer-based skeleton graph prototype contrastive learning with structure-trajectory prompted reconstruction for person re-identification," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, Jun. 2023, pp. 22 118–22 128.

[3] W. Tan, C. Ding, J. Jiang, F. Wang, Y. Zhan, and D. Tao, "Harnessing the power of mllms for transferable text-to-image person reid," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, Jun. 2024, pp. 17 127–17 137.

[4] H. Luo, Y. Gu, X. Liao, S. Lai, and W. Jiang, "Bag of tricks and a strong baseline for deep person re-identification," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. Workshops (CVPRW)*, Jun. 2019, pp. 1487–1495.

[5] S. Li, L. Sun, and Q. Li, "Clip-reid: Exploiting vision-language model for image re-identification without concrete text labels," *Proc. AAAI Conf. Artif. Intell.*, vol. 37, no. 1, pp. 1405–1413, Jun. 2023.

[6] S. He, H. Luo, P. Wang, F. Wang, H. Li, and W. Jiang, "Transreid: Transformer-based object re-identification," in *Proc. IEEE/CVF Int. Conf. Comput. Vis. (ICCV)*, 2021, pp. 14 993–15 002.

[7] Z. Cui, J. Zhou, and Y. Peng, "Dma: Dual modality-aware alignment for visible-infrared person re-identification," *IEEE Trans. Inf. Forensics Security*, vol. 19, pp. 2696–2708, 2024.

[8] R. Sun, L. Chen, L. Zhang, R. Xie, and J. Gao, "Robust visible-infrared person re-identification based on polymorphic mask and wavelet graph convolutional network," *IEEE Trans. Inf. Forensics Security*, vol. 19, pp. 2800–2813, 2024.

[9] Y. Zhang, Y. Yan, J. Li, and H. Wang, "Mrcn: A novel modality restitution and compensation network for visible-infrared person re-identification," *Proc. AAAI Conf. Artif. Intell. (AAAI)*, vol. 37, no. 3, pp. 3498–3506, Jun. 2023.

[10] G. Wang, T. Zhang, J. Cheng, S. Liu, Y. Yang, and Z. Hou, "Rgb-infrared cross-modality person re-identification via joint pixel and feature alignment," in *Proc. IEEE/CVF Int. Conf. Comput. Vis. (ICCV)*, 2019, pp. 3622–3631.

[11] S. Choi, S. Lee, Y. Kim, T. Kim, and C. Kim, "Hi-cmd: Hierarchical cross-modality disentanglement for visible-infrared person re-identification," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, 2020, pp. 10 254–10 263.

[12] Y. Zhang, Y. Yan, Y. Lu, and H. Wang, "Towards a unified middle modality learning for visible-infrared person re-identification," in *Proc. 29th ACM Int. Conf. Multimedia*, 2021, pp. 788–796.

[13] M. Kim, S. Kim, J. Park, S. Park, and K. Sohn, "Partmix: Regularization strategy to learn part discovery for visible-infrared person re-identification," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, Jun. 2023, pp. 18 621–18 632.

[14] Y. Ge, Z. Chen, Z. Wang, J. Kang, and M. Zhang, "Spectral enhancement and pseudo-anchor guidance for infrared-visible person re-identification," in *Proc. IEEE Int. Conf. Acoust., Speech, Signal Process. (ICASSP)*, 2025, pp. 1–5.

[15] Y. Li, Y. Sun, Y. Qin, D. Peng, X. Peng, and P. Hu, "Robust duality learning for unsupervised visible-infrared person re-identification," *IEEE Trans. Inf. Forensics Security*, vol. 20, pp. 1937–1948, 2025.

[16] K. Ren and L. Zhang, "Implicit discriminative knowledge learning for visible-infrared person re-identification," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, 2024, pp. 393–402.

[17] Q. Zhang, C. Lai, J. Liu, N. Huang, and J. Han, "Fmcnet: Feature-level modality compensation for visible-infrared person re-identification," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, 2022, pp. 7339–7348.

[18] Y. Lu, Y. Wu, B. Liu, T. Zhang, B. Li, Q. Chu, and N. Yu, "Cross-modality person re-identification with shared-specific feature transfer," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, 2020, pp. 13 376–13 386.

[19] B. Duan, W. Zhang, D. Wu, Z. Lin, J. Gu, and W. Wang, "Exploiting vision-language model for visible-infrared person re-identification via textual modality alignment," in *Proc. IEEE Int. Conf. Multimedia Expo (ICME)*, 2024, pp. 1–6.

[20] X. Yu, N. Dong, L. Zhu, H. Peng, and D. Tao, "Clip-driven semantic discovery network for visible-infrared person re-identification," *IEEE Trans. Multimedia*, pp. 1–13, 2025.

[21] Z. Chen, Z. Zhang, X. Tan, Y. Qu, and Y. Xie, "Unveiling the power of clip in unsupervised visible-infrared person re-identification," in *Proc. 31th ACM Int. Conf. Multimedia*, 2023, pp. 3667–3675.

[22] A. Radford, J. W. Kim, C. Hallacy, A. Ramesh, G. Goh, S. Agarwal, G. Sastry, A. Askell, P. Mishkin, J. Clark, G. Krueger, and I. Sutskever, "Learning transferable visual models from natural language supervision," in *Proc. Int. Conf. Mach. Learn. (ICML)*, 2021, pp. 8748–8763.

[23] A. Ramesh, P. Dhariwal, A. Nichol, C. Chu, and M. Chen, "Hierarchical text-conditional image generation with clip latents," *arXiv preprint arXiv:2204.06125*, 2022.

[24] J. Li, D. Li, C. Xiong, and S. Hoi, "Blip: Bootstrapping language-image pre-training for unified vision-language understanding and generation," in *Proc. Int. Conf. Mach. Learn. (ICML)*, 2022, pp. 12 888–12 900.

[25] Z. Chen, Z. Zhang, X. Tan, Y. Qu, and Y. Xie, "Clip-mc: Leveraging clip for modality compensation in visible-infrared person re-identification," *arXiv preprint arXiv:2408.12345*, 2024.

[26] M. Ye, J. Shen, G. Lin, T. Xiang, L. Shao, and S. C. H. Hoi, "Deep learning for person re-identification: A survey and outlook," *IEEE Trans. Pattern Anal. Mach. Intell.*, vol. 44, no. 6, pp. 2872–2893, 2022.

[27] S. Li, L. Sun, and Q. Li, "Attribute-guided text prompt learning for person re-identification," *IEEE Trans. Pattern Anal. Mach. Intell.*, vol. 46, no. 3, pp. 1823–1837, 2024.

[28] Z. Li, Y. Sun, and Q. Li, "Multi-prompt re-identification: Learning appearance attributes via explicit and implicit learnable prompts," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, 2025.

[29] Z. Wang, Z. Wang, Y. Zheng, Y.-Y. Chuang, and S. Satoh, "Learning to reduce dual-level discrepancy for infrared-visible person re-identification," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, 2019, pp. 618–626.

[30] G. Wang, T. Zhang, Y. Yang, J. Cheng, J. Dong, S. Liu, and Z. Hou, "Cross-modality paired-images generation for rgb-infrared person re-identification," *Proc. AAAI Conf. Artif. Intell. (AAAI)*, vol. 34, no. 7, pp. 12 144–12 151, 2020.

[31] Y. Zhang, H. Wang, and Y. Yan, "Dive: Diffusion-based identity-variant expansion for visible-infrared person re-identification," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, 2025.

[32] M. Ye, J. Shen, and L. Shao, "Visible-infrared person re-identification via homogeneous augmented cross-modal learning," *IEEE Trans. Inf. Forensics Security*, vol. 16, pp. 738–751, 2021.

[33] Y. Zhang, S. Zhao, Y. Kang, and J. Shen, "Shape-erased feature learning for visible-infrared person re-identification," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, 2023, pp. 22 496–22 505.

[34] Z. Li, Y. Sun, and Q. Li, "Dual-level discrepancy reduction learning for visible-infrared person re-identification," *IEEE Trans. Inf. Forensics Security*, vol. 20, pp. 1234–1248, 2025.

[35] K. Zhou, J. Yang, C. C. Loy, and Z. Liu, "Learning to prompt for vision-language models," *Int. J. Comput. Vis.*, vol. 130, no. 9, pp. 2337–2348, 2022.

[36] K. Zhou, J. Yang, C. C. Loy, and Z. Liu, "Conditional prompt learning for vision-language models," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, 2022, pp. 16 816–16 825.

[37] M. U. Khattak, H. Rasheed, M. Maaz, S. Khan, and F. S. Khan, "Maple: Multi-modal prompt learning," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, 2023, pp. 19 113–19 122.

[38] Z. Bai, J. Liu, X. Hao, and M. Ye, "Towards visible-infrared person re-identification via text auxiliary modality," *IEEE Trans. Inf. Forensics Security*, vol. 19, pp. 4897–4908, 2024.

[39] Z. Chen, Z. Zhang, X. Tan, Y. Qu, and Y. Xie, "Mip: Modality-agnostic interaction prompts for visible-infrared person re-identification," *arXiv preprint arXiv:2408.12345*, 2024.

[40] W. Park, D. Kim, Y. Lu, and M. Cho, "Relational knowledge distillation," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, 2019, pp. 3967–3976.

[41] A. Wu, W.-S. Zheng, H.-X. Yu, S. Gong, and J. Lai, "Rgb-infrared cross-modality person re-identification," in *Proc. IEEE/CVF Int. Conf. Comput. Vis. (ICCV)*, 2017, pp. 5380–5389.

[42] Z. Li, Y. Sun, and Q. Li, "Dual-hsme: A dual-modality feature enhancement framework for visible-infrared person re-identification," in *Proc. AAAI Conf. Artif. Intell. (AAAI)*, 2022.

[43] M. Ye, J. Shen, D. J. Crandall, L. Shao, and J. Luo, "Dynamic dual-attentive aggregation learning for visible-infrared person re-identification," in *Proc. Eur. Conf. Comput. Vis. (ECCV)*, 2020, pp. 229–247.

[44] Y. Chen, L. Wan, Z. Li, Q. Jing, and Z. Sun, "Neural feature search for rgb-infrared person re-identification," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, 2021, pp. 587–597.

[45] X. Hao, S. Zhao, M. Ye, and J. Shen, "Cross-modality person re-identification via modality confusion and center aggregation," in *Proc. IEEE/CVF Int. Conf. Comput. Vis. (ICCV)*, 2021, pp. 16 383–16 392.

[46] M. Ye, W. Ruan, B. Du, and M. Z. Shou, "Channel augmented joint learning for visible-infrared recognition," in *Proc. IEEE/CVF Int. Conf. Comput. Vis. (ICCV)*, 2021, pp. 13 547–13 556.

[47] Q. Wu, P. Dai, J. Chen, C.-W. Lin, Y. Wu, F. Huang, B. Zhong, and R. Ji, "Discover cross-modality nuances for visible-infrared person re-identification," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, 2021, pp. 4328–4337.

[48] K. Jiang, T. Zhang, X. Liu, B. Qian, Y. Zhang, and F. Wu, "Cross-modality transformer for visible-infrared person re-identification," in *Proc. Eur. Conf. Comput. Vis. (ECCV)*, S. Avidan, G. Brostow, M. Cisse, G. M. Farinella, and T. Hassner, Eds., 2022, pp. 480–496.

[49] Y. Zhang, Y. Kang, S. Zhao, and J. Shen, "Dual-semantic consistency learning for visible-infrared person re-identification," *IEEE Trans. Inf. Forensics Security*, vol. 18, pp. 1554–1565, 2023.

[50] Y. Zhang, S. Zhao, Y. Kang, and J. Shen, "Modality synergy complement learning with cascaded aggregation for visible-infrared person re-identification," in *Proc. Eur. Conf. Comput. Vis. (ECCV)*, 2022, pp. 462–479.

[51] Y. Zhang and H. Wang, "Diverse embedding expansion network and low-light cross-modality benchmark for visible-infrared person re-identification," in *Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)*, 2023, pp. 2153–2162.

[52] X. Fang, Y. Yang, and Y. Fu, "Visible-infrared person re-identification via semantic alignment and affinity inference," in *Proc. IEEE/CVF Int. Conf. Comput. Vis. (ICCV)*, 2023, pp. 11 236–11 245.

[53] Y. Wu, L.-C. Meng, Y. Zichao, S. Chan, and H.-Q. Wang, "Wrim-net: Wide-ranging information mining network for visible-infrared person re-identification," in *Proc. Eur. Conf. Comput. Vis. (ECCV)*, 2025, pp. 55–72.

[54] Y. Jiang, X. Cheng, H. Yu, X. Liu, H. Chen, and G. Zhao, "Dsaf: Dual space alignment framework for visible-infrared person re-identification," *IEEE Trans. on Multimedia*, vol. 27, pp. 5591–5603, 2025.

[55] D. T. Nguyen, H. G. Hong, K. W. Kim, and K. R. Park, "Person recognition system based on a combination of body images from visible light and thermal cameras," *Sensors*, vol. 17, no. 3, p. 605, 2017.

[56] Z. Wei, X. Yang, N. Wang, and X. Gao, "Syncretic modality collaborative learning for visible infrared person re-identification," in *Proc. IEEE/CVF Int. Conf. Comput. Vis. (ICCV)*, 2021, pp. 225–234.

[57] Z. Huang, J. Liu, L. Li, K. Zheng, and Z.-J. Zha, "Modality-adaptive mixup and invariant decomposition for rgb-infrared person re-identification," *Proc. AAAI Conf. Artif. Intell. (AAAI)*, vol. 36, no. 1, pp. 1034–1042, Jun. 2022.

[58] Z. Wei, X. Yang, N. Wang, and X. Gao, "Dual-adversarial representation disentanglement for visible infrared person re-identification," *IEEE Trans. Inf. Forensics Security*, vol. 19, pp. 2186–2200, 2024.

[59] Y. Li, H. Lu, T. Qin, J. Tu, and S. Wu, "CM-DASN: Visible-infrared cross-modality person re-identification via dynamic attention selection network," *Multimedia Syst.*, vol. 31, no. 2, pp. 1–14, Mar. 2025.

[60] W. Li, K. Qi, W. Chen, and Y. Zhou, "Unified batch all triplet loss for visible-infrared person re-identification," in *Proc. Int. Joint Conf. Neural Netw. (IJCNN)*, 2021, pp. 1–8.

[61] D. P. Kingma and J. Ba, "Adam: A method for stochastic optimization," *CoRR*, vol. abs/1412.6980, 2014.

[62] M. Alehdaghi, A. Josi, R. M. O. Cruz, P. Shamsolmoali, and E. Granger, "Adaptive generation of privileged intermediate information for visible-infrared person re-identification," *IEEE Trans. Inf. Forensics Security*, vol. 20, pp. 3400–3413, 2025.

[63] W. He, Y. Deng, Y. Yan, F. Zhu, Y. Wang, L. Bai, Q. Xie, R. Zhao, D. Qi, W. Ouyang, and S. Tang, "Instruct-reid++: Towards universal purpose instruction-guided person re-identification," *IEEE Trans. Pattern Anal. Mach. Intell.*, vol. 47, no. 6, pp. 4253–4270, 2025.

[64] R. R. Selvaraju, M. Cogswell, A. Das, R. Vedantam, D. Parikh, and D. Batra, "Grad-cam: Visual explanations from deep networks via gradient-based localization," in *Proc. IEEE/CVF Int. Conf. Comput. Vis. (ICCV)*, Oct. 2017.

[65] L. van der Maaten and G. Hinton, "Visualizing data using t-sne," *J. Mach. Learn. Res.*, vol. 9, no. 86, pp. 2579–2605, 2008.

---

**Rishen Zhong** received the B.S. degree in Computer Science and Technology from Fujian Agriculture and Forestry University, Fuzhou, China, in 2023. He is currently pursuing the M.S. degree with the School of Artificial Intelligence from South China Normal University, Foshan, China. His current research interest is visible-infrared person re-identification.

**Guorong Lin** received the B.S. degree in Computer Science and Technology from Minjiang University, Fuzhou, China, in 2022. He is currently pursuing the Ph.D. degree with the School of Computer Science from South China Normal University, Guangzhou, China. His current research interest is occluded person re-identification.

**Zhenhua Huang** received a Ph.D. degree in Computer Science from Fudan University, Shanghai, China, in 2008. He is currently a professor in the School of Computer Science at South China Normal University, Guangzhou, China. His research interests mainly include deep learning, the Internet of Things, recommendation systems, data mining, knowledge discovery, and big data. Since 2004, he has published three books and more than 80 papers in various journals and conference proceedings.
