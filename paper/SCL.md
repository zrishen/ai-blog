\hl{Effectively embedding high-level semantics into visual representations is challenging in VI-ReID. It is important to emphasize that the integration between textual prompts and visual features in our MDCN is not a trivial feature concatenation, but a two-stage collaborative evolution process with deep geometric mechanisms and practical implications. Specifically, in Stage I (CPDL), the visual features act as a semantic guide to implicitly optimize the continuous text tokens, successfully decoupling entangled identity and modality cues into distinct textual anchors. Building upon these clean anchors, Stage II (SCL) utilizes them as semantically rich, high-level class prototypes. Driven by the prototype-based cross-entropy loss, visual features from both modalities are geometrically constrained to converge toward these frozen textual prototypes. This text-guided integration establishes a domain-invariant coordinate system in the multimodal latent space, strictly regularizing the scattered visual distributions into well-structured semantic clusters rather than passively matching local visual patterns. }


In the VI-ReID task, effectively embedding high-level semantic information into visual representations has always been a challenge. ingle text-image alignment allows the model to learn modality-shared features, but this approach ignores many other implicit informations. 

In the VI-ReID task, effectively embedding high-level semantic information into visual representations remains challenging. A simple text-image alignment strategy can introduce modality-shared semantics, but it is insufficient to fully exploit the decoupled person-related and modality-related semantics. Moreover, it may overlook modality uniqueness and high-level contextual relationships, limiting the learning of discriminative modality-specific and modality-shared representations. To address this issue, SCL utilizes the decoupled semantic prompts as high-level priors and introduces modality coupling alignment and modality-contextual alignment to guide visual feature learning.

In the VI-ReID task, effectively embedding high-level semantic information into visual representations remains challenging. 


In the VI-ReID task, effectively leverage high-level semantic priors to guide visual feature learning remains challenging. Although simple text-image alignment can introduce modality-shared semantics, it fails to fully exploit decoupled person-related and modality-related semantics, and may overlook modality uniqueness and high-level contextual relationships.

modality uniqueness and differences

In the VI-ReID task, effectively leveraging high-level semantic priors to guide visual feature learning remains challenging. Although single text-image alignment can introduce modality-shared semantics, it fails to fully exploit decoupled person-related and modality-related semantics and may overlook modality uniqueness and high-level semantic context for both person identity and modality.

>In the VI-ReID task, effectively leveraging high-level semantic priors to guide visual feature learning remains challenging. Although single text-image alignment can introduce modality-shared semantics, it fails to fully exploit the decoupled person-related and modality-related semantics. It may also overlook modality uniqueness and the high-level semantic context of both person identity and modality. To address this, SCL leverages the decoupled semantic prompts as high-level priors and employs modality coupling alignment and modality-contextual alignment to guide visual feature learning. This enables the model to preserve high-level semantic context while learning more stable modality-specific and modality-shared representations.

模态上下文特征 $f_{co}$ 则整合二者，从而吸收来自其他两个特征空间的互补关系知识，并促进隐式跨模态信息的学习

SCL enables the model to jointly learn modality-specific, modality-shared, and modality-contextual features,
>among which the modality-contextual features preserve the high-level semantic context of both person identity and modality.
During learning, the parameters of the learnable prompt set $\mathcal{D}_T$ and the text encoder $\mathcal{T}(\cdot)$ are frozen, and the optimization focuses only on the image encoder. Via the text encoder, SCL derives three types of semantic text representations as guidance. Correspondingly, the output layer of the image encoder is restructured into three parallel branches to extract visual features from both visible and infrared images. The outputs of these branches are:



% \hl{Moreover, this text-as-prototype integration mechanism yields significant practical robustness for VI-ReID under real-world surveillance scenarios. Visible and infrared images are highly susceptible to background clutter, severe illumination variations, and sensory noise. Because textual prototypes represent absolute, high-level abstract concepts that are inherently immune to pixel-level distortions, forcing visual features to align with them effectively regularizes the visual encoder to discard irrelevant visual variations. Consequently, even under severe low-light conditions and complex illumination variations, these stable textual prototypes serve as reliable semantic anchors, providing continuous regularization constraints to ensure consistent cross-modal alignment and robust pedestrian retrieval. Guided by this mechanism, SCL restructures the image encoder into three parallel branches, each steered by different prompt pairings to focus on key semantic attributes. By selectively pairing person-related and modality-related prompts, SCL directs each branch to a distinct aspect of the input. The modality-specific features $f_{sp}$ focus on identity cues within each modality, the modality-shared features $f_{sh}$ learn cross-modal invariance, and the modality-contextual features $f_{co}$ integrate both, thereby absorbing complementary relational knowledge from the other two feature spaces and facilitating the learning of implicit cross-modal information. The three branches thus produce complementary, non-redundant representations. During stage II learning, the parameters of the learnable prompt set $\mathcal{D}_T$ and the text encoder $T(\cdot)$ are frozen, and the optimization focuses only on the image encoder. Via the text encoder, SCL derives three types of semantic text representations as guidance. Correspondingly, the output layer of the image encoder is restructured into three parallel branches to extract visual features from both visible and infrared images. The outputs of these branches are:}




SCL jointly learns modality-specific, modality-shared, and modality-contextual features, among which the modality-contextual features preserve the high-level semantic context of both person identity and modality.

Accordingly, SCL enables the model to jointly learn modality-specific, modality-shared, and modality-contextual features, where the modality-contextual features preserve the high-level semantic context of both person identity and modality. During learning, the parameters of the learnable prompt set $\mathcal{D}_T$ and the text encoder $\mathcal{T}(\cdot)$ are frozen, and the optimization focuses only on the image encoder. Via the text encoder, SCL derives three types of semantic text representations as guidance. Correspondingly, the output layer of the image encoder is restructured into three parallel branches to extract visual features from both visible and infrared images.


\hl{Moreover, this text-as-prototype integration mechanism yields significant practical robustness for VI-ReID under real-world surveillance scenarios. Visible and infrared images are highly susceptible to background clutter, severe illumination variations, and sensory noise. Because textual prototypes represent absolute, high-level abstract concepts that are inherently immune to pixel-level distortions, forcing visual features to align with them effectively regularizes the visual encoder to discard irrelevant visual variations. Consequently, even under severe low-light conditions and complex illumination variations, these stable textual prototypes serve as reliable semantic anchors, providing continuous regularization constraints to ensure consistent cross-modal alignment and robust pedestrian retrieval. Guided by this mechanism, SCL restructures the image encoder into three parallel branches, each steered by different prompt pairings to focus on key semantic attributes. By selectively pairing person-related and modality-related prompts, SCL directs each branch to a distinct aspect of the input. The modality-specific features $f_{sp}$ focus on identity cues within each modality, the modality-shared features $f_{sh}$ learn cross-modal invariance, and the modality-contextual features $f_{co}$ integrate both, thereby absorbing complementary relational knowledge from the other two feature spaces and facilitating the learning of implicit cross-modal information. The three branches thus produce complementary, non-redundant representations. 


During stage II learning, the parameters of the learnable prompt set $\mathcal{D}_T$ and the text encoder $T(\cdot)$ are frozen, and the optimization focuses only on the image encoder. Via the text encoder, SCL derives three types of semantic text representations as guidance. Correspondingly, the output layer of the image encoder is restructured into three parallel branches to extract visual features from both visible and infrared images. The outputs of these branches are:}




To address this, SCL leverages the decoupled semantic prompts as high-level priors and employs modality coupling alignment and modality-contextual alignment to guide visual feature learning, thereby retaining contextual information while learning more stable modality-specific and modality-shared representations.

In the VI-ReID task, effectively leveraging high-level semantic priors to guide visual feature learning remains challenging. Although a simple text-image alignment strategy can introduce modality-shared semantics, it fails to fully exploit the decoupled person-related and modality-related semantics. It also tends to overlook modality uniqueness and the high-level semantic context of both person identity and modality.

To address this, SCL leverages the decoupled semantic prompts as high-level priors and employs modality coupling alignment and modality-contextual alignment to guide visual feature learning. This enables the model to preserve high-level semantic context while learning more stable modality-specific and modality-shared representations.


preserving modality high-level semantic context while learning more stable modality-specific and modality-shared representations.

To address this, SCL employs modality coupling and modality-contextual alignments to guide the image encoder to emphasize critical attributes based on high-level semantics.




To address this issue, SCL utilizes the decoupled semantic prompts as high-level priors and introduces modality coupling alignment and modality-contextual alignment to guide visual feature learning.

In the VI-ReID task, effectively embedding high-level semantic information into visual representations remains challenging. A simple text-image alignment strategy can introduce modality-shared semantics, but it is insufficient to fully exploit the decoupled person-related and modality-related semantics. Moreover, it may overlook modality uniqueness and high-level contextual relationships, limiting the learning of discriminative modality-specific and modality-shared representations. To address this issue, SCL utilizes the decoupled semantic prompts as high-level priors and introduces modality coupling alignment and modality-contextual alignment to guide visual feature learning.

Although single text-image alignment can introduce modality-shared semantics, it fails to fully exploit the decoupled person-related and modality-related semantics. It may also overlook modality uniqueness and high-level semantic context.

Although simple text-image alignment can introduce modality-shared semantics, it fails to fully exploit decoupled person-related and modality-related semantics, and may overlook modality uniqueness and high-level contextual relationships. Therefore, SCL utilizes the decoupled semantic prompts as high-level priors and employs modality coupling alignment and modality-contextual alignment to guide the learning of more stable modality-specific and modality-shared representations.


In the VI-ReID task, effectively embedding high-level semantic information into visual representations has always been a challenge. Single text-image alignment allows the model to learn modality-shared features, but this approach ignores many other implicit informations. To address this, SCL employs modality coupling and modality-contextual alignments to guide the image encoder to emphasize critical attributes based on high-level semantics.





In the prompt-based VI-ReID task, effectively embedding high-level semantic information into visual representations has always been a challenge. Single text-image alignment allows the model to learn modality-shared features, but this approach ignores many other implicit informations. To address this, SCL employs modality coupling and modality-contextual alignments to guide the image encoder to emphasize critical attributes based on high-level semantics.

SCL enables the model to jointly learn modality-specific, modality-shared, and modality-contextual features. During learning, the parameters of the learnable prompt set $\mathcal{D}_T$ and the text encoder $\mathcal{T}(\cdot)$ are frozen, and the optimization focuses only on the image encoder. Via the text encoder, SCL derives three types of semantic text representations as guidance. Correspondingly, the output layer of the image encoder is restructured into three parallel branches to extract visual features from both visible and infrared images. The outputs of these branches are:



> However, as illustrated in Figure \xbox{\ref{fig:1}} (a), existing methods employ text prompts that primarily focus on modality differences, entangling identity-related and modality information. The direct use of these prompts to guide the model results in modality-shared and modality-specific features losing crucial identity information and introducing noise, ultimately limiting discriminative capability. Additionally, integrating modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships within and across modalities, leading to distortion of cross-modal high-level semantics during information integration, which further weakens the effectiveness of identity retrieval.

>SCL utilizes decoupled semantic prompts as high-level priors while employing modality coupling and modality-contextual alignment to guide visual features. Specifically, Modality coupling alignment is designed to encourage the model to emphasize modality uniqueness and differences across semantic levels. Furthermore, Modality-contextual alignment is designed to preserve high-level semantic context for both person identity and modality, enabling the model to retain contextual information while learning more stable modality-specific and modality-shared representations.




Discussion. The integration between textual prompt features and visual features in SCL is not a simple auxiliary constraint, but serves as a semantic guidance mechanism for organizing the visual feature space. The decoupled text prompts provide explicit high-level priors about person identity and modality characteristics, while the visual branches learn to project image features into corresponding semantic spaces. In this way, modality-specific features are encouraged to preserve modality-dependent details, modality-shared features are guided to capture identity-related information that is consistent across visible and infrared images, and modality-contextual features retain a more complete semantic description of both identity and modality. From a practical perspective, this design enables the image encoder to focus on meaningful pedestrian attributes rather than being dominated by low-level spectral differences, such as color distortion or texture changes. Therefore, the text-visual integration in SCL improves not only cross-modal alignment, but also the discriminability and stability of the learned representations for visible-infrared person retrieval.