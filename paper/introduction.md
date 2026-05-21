\section{Introduction}
\IEEEPARstart{P}{erson} re-identification (ReID) aims to match pedestrian images of the same individual across non-overlapping camera views. This enhances the operational efficacy of urban surveillance and public safety in applications such as locating missing persons and tracking criminals. Current research efforts \cite{BPM_2018}, \cite{TranSG_2023}, \cite{MLLMs_2024}, \cite{reid1_2019}, \cite{CLIP-ReID_2023}, \cite{TransReID_2021} have achieved significant progress in the visible spectrum modality. Notably, modern public safety systems extensively use adaptive spectral perception cameras that automatically switch to infrared modality in low-light conditions, effectively preserving pedestrian features at night. However, the significant domain differences between visible and infrared modality images lead to substantial performance degradation when applying conventional ReID frameworks. Therefore, visible-infrared person re-identification (VI-ReID) has emerged as a critical research area to overcome this technical challenge.


\begin{figure}
  \centering
  \begin{subfigure}[b]{0.49\textwidth}
    \centering
    \captionsetup{font=footnotesize}
    \includegraphics[width=1\linewidth]{images/1.pdf} 
    \vspace*{-6mm}
    % \caption{Previous}
    % \label{fig:1subfig_a}
  \end{subfigure}
  
  \caption{Illustration of the differences between our method and existing VI-REID methods. Green represents the visible modality, while red represents the infrared modality. (a) Existing methods primarily rely on modality-related text prompts to compensate for modality-specific features and additional fusion to extract complete image features. (b) Our method employs modality-contextual text prompts to semantically decouple person-related and modality-related prompts and use both to guide the extraction of modality-shared and modality-specific features. In addition, Hierarchical Cosine Angular Distillation is introduced to integrate the effective high-level semantic information from both features.}
  \label{fig:1}
\end{figure}

The VI-ReID task aims to effectively alleviate inter-modal representation discrepancies while preserving identity-aware valuable information across modalities \cite{DMA-TIFS_2024}, \cite{WGCN_TIFS_2024}. Due to distinct spectral response mechanisms, significant differences exist across modalities in visual features such as color distributions, texture details, etc. The mainstream technologies for solving this problem are divided into Image-level and Feature-level methods \cite{MRCN_2023}. Image-level methods aim to achieve pixel-level cross-modality translation or generate intermediate modalities \cite{AlignGAN_2019}, \cite{Hi-CMD_2020}, \cite{MMN_2021}. Although these methods can effectively alleviate modal discrepancies, their training process is unstable and relies on large-scale cross-modality image pairs. Feature-level methods implement modality-shared representations in deep feature spaces through heterogeneous feature extraction networks and cross-modality metric learning algorithms \cite{PartMix_2023}, \cite{ReID-SEPG_2025}, \cite{RoDE_TIFS_2025}. However, relying solely on modality-shared features for retrieval ignores identity-aware discriminative information hidden within modality-specific features. This limitation restricts their ability to capture complex identity cues. As a result, researchers have started exploring implicit information within modality-specific features and combining it with modality-shared features to create more comprehensive representations \cite{IDKL_2024}, \cite{FMCNet_2022}, \cite{cm-SSFT_2020}. These methods are referred as modality-compensated methods.


With the advancement of Vision-Language Pre-training (VLP) models, researchers have begun incorporating vision-language learning into feature-level methods to compensate for insufficient high-level semantics \cite{TMAL_2024}, \cite{CSDN_2025}, \cite{CCLNet_2023}. In particular, recent studies have shown that Contrastive Language-Image Pre-training (CLIP) models can bridge visual content with linguistic descriptions to enhance the perception of high-level semantics in pedestrians \cite{CLIP_2021}, \cite{IMLP_TIFS_2025}, \cite{LoRA_2025}. In this context, modality-compensated methods have been proposed. They introduce high-level semantic information to enhance modality perception, thereby further extracting modality-specific and modality-shared features to obtain more comprehensive pedestrian representations \cite{CLIP-MC_2025}. \hl{However, as illustrated in Figure \xbox{\ref{fig:1}} (a), existing methods introduce text prompts that focus primarily on modality differences while neglecting to explicitly decouple identity-related semantics from modality cues. This entanglement prevents the model from clearly separating person uniqueness from modality differences, and the mere reliance on modality-related text features for compensation fails to fully exploit CLIP's potential, leaving two key limitations unresolved. Because the text prompts entangle modality and identity information, the extraction of modality-shared and modality-specific features loses crucial identity cues and introduces noise, ultimately limiting discriminative capability. Additionally, the integration of modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships within and across modalities, leading to confusion and distortion of cross-modal high-level semantics during information integration, which further weakens the effectiveness of identity retrieval.}

To address the above deficiencies, as illustrated in Figure \ref{fig:1} (b), we propose a design idea of modality-contextual text prompts that explicitly introduce modality-aware capabilities. We find that although this enhances the flexibility of multimodal attribute localization, it also introduces new complexities in maintaining cross-modal representation consistency. To alleviate this dilemma, we develop a Modality Decoupling and Coupling Network (MDCN), which integrates Context Prompt Decoupling Learning (CPDL), Semantic Coupling Learning (SCL), and Modality Relational Knowledge Distillation (MRKD). Specifically, CPDL introduces modality-contextual text prompts to explicitly infuse modality-aware features and semantically decouples them into person-related and modality-related prompts. This effective decoupling ensures that modality information is clearly distinguished from identity information. \hl{Building upon these disentangled semantic anchors, SCL facilitates visual feature learning to prevent the distortion of modality-specific cues. By employing a strategic combination of semantic coupling alignment and modality-contextual alignment, SCL directs the multi-branch image encoder to emphasize fine-grained pedestrian attributes under the rigorous regularized constraint of high-level textual semantics. This approach establishes intra-modality structural consistency while expanding inter-modality distinguishability, thereby guaranteeing the robust extraction of both unpolluted modality-shared and modality-specific features.} \hl{MRKD integrates high-level semantic relationships into a unified modality-contextual space.} It employs hierarchical cosine angular distillation to distill inter-modality cosine relationships from modality-shared features and intra-modality cosine relationships from modality-specific features into the modality-contextual space. \hl{Consequently, MDCN effectively suppresses cross-modal interference, improves the modality-aware distinguishability of visual descriptors, and facilitates a highly refined, information-rich representation for optimal identity retrieval.}

The main contributions of this paper are as follows:

\begin{enumerate}
    \setlength{\leftskip}{4pt}
    \item 
\hl{We develop a novel MDCN for VI-ReID. Within it, we propose CPDL to semantically decouple modality-contextual text prompts, providing clean textual anchors that effectively eliminate the entanglement between modality and identity information.}
    \item 
\hl{We introduce SCL to exploit these decoupled anchors. By executing semantic coupling alignment on them, SCL transforms these anchors into high-level guidance to geometrically constrain visual features, robustly extracting modality-shared and modality-specific representations against real-world visual degradations.
}
    \item 
\hl{We design MRKD to integrate multi-space relationships into a unified contextual space via hierarchical cosine angular distillation. Enforcing explicit cross- and intra-modal forgetting allows MRKD to capture implicit semantic cues and preserve pure discriminative representations.}
    \item 

\hl{We validate MDCN on three benchmark datasets (SYSU-MM01, RegDB, and LLCM), where extensive experiments demonstrate its state-of-the-art performance and establish a highly robust technical pathway for the challenging VI-ReID task.}
\end{enumerate}



\hl{However, as illustrated in Figure \xbox{\ref{fig:1}} (a), existing methods introduce text prompts that focus primarily on modality differences while neglecting to explicitly decouple identity-related semantics from modality cues. This entanglement prevents the model from clearly separating person uniqueness from modality differences, and the mere reliance on modality-related text features for compensation fails to fully exploit CLIP's potential, leaving two key limitations unresolved. Because the text prompts entangle modality and identity information, the extraction of modality-shared and modality-specific features loses crucial identity cues and introduces noise, ultimately limiting discriminative capability. Additionally, the integration of modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships within and across modalities, leading to confusion and distortion of cross-modal high-level semantics during information integration, which further weakens the effectiveness of identity retrieval.}

> However, as illustrated in Figure \xbox{\ref{fig:1}} (a), existing methods employ text prompts that primarily focus on modality differences, entangling identity-related and modality information. The direct use of these prompts to guide the model results in modality-shared and modality-specific features losing crucial identity information and introducing noise, ultimately limiting discriminative capability. Additionally, integrating modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships within and across modalities, leading to distortion of cross-modal high-level semantics during information integration, which further weakens the effectiveness of identity retrieval.


leading to the distortion of implicit cross-modal information and weakening identity retrieval.


Additionally, directly integrating modality-shared and modality-specific features overlooks the fusion of high-level semantic relationships within and across modalities, leading to distortion of implicit cross-modal information and weakening the effectiveness of identity retrieval.




Additionally, the integration of modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships, leading to the distortion of implicit cross-modal information and weakening identity retrieval.

However, as illustrated in Figure \xbox{\ref{fig:1}} (a), existing methods introduce text prompts that focus primarily on modality differences, which entangle identity-related and modality information. This entanglement prevents the model from clearly separating person uniqueness from modality differences and limits the full exploitation of CLIP's potential, leaving two key limitations unresolved.

Because the text prompts entangle modality and identity information, the extraction of modality-shared and modality-specific features loses crucial identity cues and introduces noise, ultimately limiting discriminative capability. 

Additionally, the integration of modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships within and across modalities, leading to confusion and distortion of cross-modal high-level semantics during information integration, which further weakens the effectiveness of identity retrieval.


However, as illustrated in Figure \xbox{\ref{fig:1}} (a), existing methods introduce text prompts that focus primarily on modality differences, entangling identity-related and modality information. This prevents the model from clearly separating person uniqueness from modality differences, causing modality-shared and modality-specific features to lose crucial identity information and introduce noise, ultimately limiting discriminative capability.

Additionally, integrating modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships within and across modalities, leading to confusion and distortion of cross-modal high-level semantics during information integration, which further weakens the effectiveness of identity retrieval.

However, as illustrated in Figure \xbox{\ref{fig:1}} (a), existing methods employ text prompts that primarily focus on modality differences, entangling identity-related and modality information. The direct use of these prompts to guide the model results in modality-shared and modality-specific features losing crucial identity information and introducing noise, ultimately limiting discriminative capability. Additionally, integrating modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships within and across modalities, leading to confusion and distortion of cross-modal high-level semantics during information integration, which further weakens the effectiveness of identity retrieval.

Existing methods primarily introduce text prompts that entangle modality and identity information, failing to clearly separate person uniqueness from modality differences. Additionally, the integration of modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships, leading to the distortion of implicit cross-modal information and weakening identity retrieval.






CPDL designs modality-contextual text prompts to explicitly introduce modality-aware capabilities and semantically decouples them into person-related and modality-related prompts, thereby effectively distinguishing between modality and identity information.

SCL utilizes decoupled semantic prompts as high-level priors while employing modality coupling and modality-contextual alignment to guide visual features. This encourages the model to emphasize modality uniqueness and differences across semantic levels while preserving high-level semantic context, enabling it to learn more stable modality-specific and shared representations.

MRKD employs hierarchical cosine angular distillation to project inter-modality and intra-modality relationships into a modality-contextual space, explicitly reducing cross-modal and intra-modal interference while preserving discriminative representations.

















To address the above deficiencies, as illustrated in Figure \ref{fig:1} (b), we propose a design idea of modality-contextual text prompts that explicitly introduce modality-aware capabilities. 

We find that although this enhances the flexibility of multimodal attribute localization, it also introduces new complexities in maintaining cross-modal representation consistency. 

To alleviate this dilemma, we develop a Modality Decoupling and Coupling Network (MDCN), which integrates Context Prompt Decoupling Learning (CPDL), Semantic Coupling Learning (SCL), and Modality Relational Knowledge Distillation (MRKD).

Specifically, CPDL introduces modality-contextual text prompts to explicitly infuse modality-aware capabilities and semantically decouples them into person-related and modality-related prompts. This effective decoupling ensures that modality information is clearly distinguished from identity information. 

> Specifically, CPDL introduces modality-contextual text prompts to embed modality-aware capabilities and semantically decouples them into person-related and modality-related prompts. 

>This decoupling ensures that modality information is effectively distinguished from identity information. 

This effective decoupling ensures that modality information is clearly distinguished from identity information. 

\hl{Building upon these disentangled semantic anchors, SCL facilitates visual feature learning to prevent the distortion of modality-specific cues. By employing a strategic combination of semantic coupling alignment and modality-contextual alignment, SCL directs the multi-branch image encoder to emphasize fine-grained pedestrian attributes under the rigorous regularized constraint of high-level textual semantics. This approach establishes intra-modality structural consistency while expanding inter-modality distinguishability, thereby guaranteeing the robust extraction of both unpolluted modality-shared and modality-specific features.} 



SCL employs decoupled semantic prompts as high-level semantic priors, providing guidance for visual feature learning. 

>SCL utilizes decoupled semantic prompts as high-level priors while employing modality coupling and modality-contextual alignment to guide visual features. Specifically, Modality coupling alignment is designed to encourage the model to emphasize modality uniqueness and differences across semantic levels. Furthermore, Modality-contextual alignment is designed to preserve high-level semantic context for both person identity and modality, enabling the model to retain contextual information while learning more stable modality-specific and modality-shared representations.

Modality-contextual alignment is designed to preserve high-level semantic context for both person identity and modality. Consequently, the model retains contextual information while learning more stable modality-specific and modality-shared representations.



The model retains contextual information while learning more stable modality-specific and modality-shared representations.

SCL employs decoupled semantic prompts as high-level semantic priors to guide visual feature learning. Modality coupling alignment encourages the model to emphasize modality uniqueness and differences at the semantic level, while modality-contextual alignment preserves high-level semantic context. In this way, the model retains contextual information while learning more stable modality-specific and modality-shared representations.

While retaining contextual information, this enables the model to learn more stable modality-specific and modality-shared representations.

SCL employs decoupled semantic prompts serve as high-level semantic priors, providing guidance for visual feature learning. Modality coupling alignment is designed to encourage the model to emphasize modality uniqueness and differences across semantic levels. Modality-contextual alignment is designed to preserving high-level semantic context. 这保留上下文信息的同时enabling it to learn more stable modality-specific and shared representations.



SCL utilizes decoupled semantic prompts as high-level priors while employing modality coupling and modality-contextual alignment to guide visual features. This encourages the model to emphasize modality uniqueness and differences across semantic levels while preserving high-level semantic context, enabling it to learn more stable modality-specific and shared representations.


SCL utilizes decoupled semantic prompts as high-level priors while employing modality coupling and modality-contextual alignment to guide visual features. This encourages the model to emphasize modality uniqueness and differences across semantic levels while preserving high-level semantic context, enabling it to learn more stable modality-specific and shared representations.

SCL employs decoupled semantic prompts as high-level semantic priors and applies modality coupling alignment and modality-contextual alignment to semantically guide visual features. Modality coupling alignment encourages the model to emphasize modality uniqueness while mitigating cross-modal semantic gaps, and modality-contextual alignment preserves cross-modal high-level semantic context, enabling the model to retain essential information while learning stable modality-specific and shared representations.



SCL employs decoupled semantic prompts serve as high-level semantic priors, providing guidance for visual feature learning. Modality coupling alignment is designed to encourage the model to emphasize modality uniqueness and differences across semantic levels. Modality-contextual alignment is designed to preserving high-level semantic context.



, on the other hand, focuses on preserving high-level semantic context across modalities. By aligning visual features with decoupled semantic prompts in a modality-contextual space, this mechanism maintains cross-modal semantic consistency, ensuring that shared high-level information is not lost during feature extraction. Together, these two alignments enable SCL to retain essential information while learning more stable modality-specific and shared representations, improving robustness in cross-modal tasks.









\hl{MRKD integrates high-level semantic relationships into a unified modality-contextual space.} It employs hierarchical cosine angular distillation to distill inter-modality cosine relationships from modality-shared features and intra-modality cosine relationships from modality-specific features into the modality-contextual space. \hl{Consequently, MDCN effectively suppresses cross-modal interference, improves the modality-aware distinguishability of visual descriptors, and facilitates a highly refined, information-rich representation for optimal identity retrieval.}

MRKD leverages modality-contextual features with high-level semantic context and employs hierarchical cosine angular distillation to integrate intra- and inter-modality semantic relationships from both modality-specific and modality-shared feature spaces into the modality-contextual space, explicitly reducing cross-modal and intra-modal interference while preserving discriminative representations.

>MRKD adopts a semantic-guided hierarchical cosine angular distillation method, which integrates intra-modality semantic relationships from the modality-specific feature space and inter-modality semantic relationships from the modality-shared feature space into the modality-contextual space. In this way, MRKD explicitly alleviates cross-modal discrepancies and intra-modal interference while preserving discriminative representations.


MRKD leverages modality-contextual features, which carry high-level semantic context. It employs hierarchical cosine angular distillation to integrate intra-modality and inter-modality semantic relationships from both modality-specific and modality-shared feature spaces into the modality-contextual space. explicitly reducing cross-modal and intra-modal interference while preserving discriminative representations.


MRKD leverages modality-contextual features with high-level semantic context.

 to integrate intra-modality and inter-modality semantic relationships from both modality-specific and modality-shared feature spaces into the modality-contextual space.

It employs hierarchical cosine angular distillation, explicitly reducing cross-modal and intra-modal interference while preserving discriminative representations.

MRKD employs hierarchical cosine angular distillation to project inter-modality and intra-modality relationships into a modality-contextual space, explicitly reducing cross-modal and intra-modal interference while preserving discriminative representations.

MRKD leverages modality-contextual features with high-level semantic context and employs hierarchical cosine angular distillation to integrate intra- and inter-modality semantic relationships from both modality-specific and modality-shared feature spaces into the modality-contextual space. This explicitly reduces cross-modal and intra-modal interference while preserving discriminative representations.



MRKD leverages modality-contextual features with high-level semantic context to integrate intra-modality and inter-modality semantic relationships from both modality-specific and modality-shared feature spaces. 

It employs hierarchical cosine angular distillation to project these relationships into the modality-contextual space,

 explicitly reducing cross-modal and intra-modal interference while preserving discriminative representations.


high-level semantic relationships

MRKD leverages modality-contextual features, which encode high-level semantic context, to 被project     intra-modality and inter-modality and semantic relationships from both modality-specific and modality-shared feature spaces. It employs hierarchical cosine angular distillation to project inter-modality and intra-modality relationships into the modality-contextual space. This explicitly reduces cross-modal and intra-modal interference while preserving discriminative representations.


ensuring that both shared and specific features contribute effectively to robust cross-modal feature learning.

MRKD employs hierarchical cosine angular distillation to project inter-modality and intra-modality relationships into a modality-contextual space, explicitly reducing cross-modal and intra-modal interference while preserving discriminative representations.





In MRKD, the modality-contextual features’ high-level semantic context is leveraged to integrate semantic relationships from both modality-specific and modality-shared feature spaces. The method employs hierarchical cosine angular distillation to project inter-modality and intra-modality relationships into the modality-contextual space. This approach explicitly reduces cross-modal and intra-modal interference while preserving discriminative representations, ensuring that both shared and specific features contribute effectively to robust cross-modal feature learning.


MRKD integrates high-level semantic relationships from multi-feature spaces into the modality-contextual feature space. It employs hierarchical cosine angular distillation to distill inter-modality cosine relationships from modality-shared features and intra-modality cosine relationships from modality-specific features into the modality-contextual space. This enhances the modality-aware distinguishability in modality-contextual representation and ensures a more refined representation of cross-modal information.

MRKD 利用了modality-contextual feature的high-level semantic context特性，integrates high-level semantic relationships from modality-specific and modality-shared 特征空间。It employs hierarchical cosine angular distillation to project inter-modality and intra-modality relationships into a modality-contextual space, explicitly reducing cross-modal and intra-modal interference while preserving discriminative representations.


integrates high-level semantic relationships from multi-feature spaces into the modality-contextual feature space. 

MRKD leverages modality-contextual features, which contain high-level semantic context, to integrate semantic relationships from both modality-specific and modality-shared feature spaces. It applies hierarchical cosine angular distillation to project inter-modality and intra-modality relationships into the modality-contextual space. This process explicitly reduces cross-modal and intra-modal interference while preserving discriminative representations.


enabling both shared and specific features to contribute effectively to robust cross-modal feature learning.

MRKD employs hierarchical cosine angular distillation to project inter-modality and intra-modality relationships into a modality-contextual space, explicitly reducing cross-modal and intra-modal interference while preserving discriminative representations.

This enhances the modality-aware distinguishability in modality-contextual representation and ensures a more refined representation of cross-modal information.

{Consequently, MDCN effectively suppresses cross-modal interference, improves the modality-aware distinguishability of visual descriptors, and facilitates a highly refined, information-rich representation for optimal identity retrieval.}

Consequently, MDCN reduces cross-modal interference, makes visual descriptors easier to distinguish across modalities, and produces rich, detailed representations that improve identity retrieval.

Consequently, MDCN reduces cross-modal and intra-modal interference, enhances the discriminability of modality-contextual features, and produces rich representations that improve identity retrieval.


> Overall, through the synergy of the three components, namely CPDL, SCL, and MRKD, MDCN can alleviate cross-modal discrepancies and intra-modal interference while further enhancing the discriminability of modality-contextual features. As a result, it learns richer and more robust identity representations to improve identity retrieval performance.

We develop a novel MDCN method that introduces modality-contextual text prompts for VI-ReID and introduce CPDL to semantically decouple these prompts, effectively distinguishing between modality and identity information.







The main contributions of this paper are as follows:

\begin{enumerate}
    \setlength{\leftskip}{4pt}
    \item 
\hl{We develop a novel MDCN for VI-ReID. Within it, we propose CPDL to semantically decouple modality-contextual text prompts, providing clean textual anchors that effectively eliminate the entanglement between modality and identity information.}

>We develop a novel MDCN method that introduces modality-contextual text prompts for VI-ReID and introduce CPDL to semantically decouple these prompts, effectively distinguishing between modality and identity information.


    \item 
\hl{We introduce SCL to exploit these decoupled anchors. By executing semantic coupling alignment on them, SCL transforms these anchors into high-level guidance to geometrically constrain visual features, robustly extracting modality-shared and modality-specific representations against real-world visual degradations.
}

>We explore CLIP's potential for modeling modality information in VI-ReID and introduce SCL, which leverages decoupled semantic prompts and employs modality coupling alignment and modality-contextual alignment to construct multiple feature spaces. This emphasizes modality uniqueness and differences while preserving high-level semantic context, resulting in more stable modality-specific and modality-shared representations.

We explore CLIP's potential for modeling modality information in VI-ReID and introduce SCL, which leverages decoupled semantic prompts and employs modality coupling alignment and modality-contextual alignment to construct multiple feature spaces. This emphasize modality uniqueness 和差异 ,while preserving high-level semantic context, resulting in more stable modality-specific and modality-shared representations.

We explore CLIP's potential for modeling modality information in VI-ReID and introduce SCL with decoupled semantic prompts, employing modality coupling alignment and modality-contextual alignment to construct multiple feature spaces.

We explore CLIP's potential for modeling modality information in VI-ReID and introduce SCL with modality coupling alignment and modality-contextual alignment to construct multiple feature spaces.这段话可以加入利用解耦后提示词



SCL introduces decoupled semantic prompts as high-level semantic priors and employs modality coupling and modality-contextual alignment to guide visual feature learning. This design allows the model to emphasize modality uniqueness while preserving high-level semantic context, resulting in more stable modality-specific and modality-shared representations.

We explore CLIP's potential for modeling modality information in VI-ReID and introduce Semantic Coupling Learning (SCL) with modality coupling alignment and modality-contextual alignment to construct multiple feature spaces. This design enhances the image encoder’s capability to emphasize modality-specific characteristics and key visual attributes based on high-level semantic context, facilitating more discriminative and robust representations for cross-modal identity retrieval.

We explore CLIP's potential for processing modality information in VI-ReID and introduce SCL with modality coupling alignment and modality-contextual alignment to construct multiple feature spaces. This significantly enhances the image encoder's ability to highlight key attributes based on high-level semantics.


    \item 
\hl{We design MRKD to integrate multi-space relationships into a unified contextual space via hierarchical cosine angular distillation. Enforcing explicit cross- and intra-modal forgetting allows MRKD to capture implicit semantic cues and preserve pure discriminative representations.}
    \item 

>We design MRKD, which uses hierarchical cosine angular distillation to integrate intra-modality and inter-modality semantic relationships from both modality-specific and modality-shared features into a modality-contextual space, explicitly enhancing modality-contextual features while preserving discriminative representations.

We design MRKD, which uses hierarchical cosine angular distillation to integrate intra-modality and inter-modality semantic relationships from both modality-specific and modality-shared features into a modality-contextual space. This enhances the representation by reducing cross-modal and intra-modal interference, preserving discriminative features, and strengthening both shared and specific features for robust cross-modal identity retrieval.

We design MRKD, which uses hierarchical cosine angular distillation to integrate inter-modality and intra-modality semantic relationships from modality-share and modality-specific into a modality-contextual space. 

This enhances the representation by explicitly reducing cross-modal and intra-modal interference, preserving discriminative information, and enabling both shared and specific features to contribute effectively to robust cross-modal identity retrieval.




This enhances 

the ability to extract modality-aware distinguishability while reducing interference caused by modality inconsistencies.

\hl{We validate MDCN on three benchmark datasets (SYSU-MM01, RegDB, and LLCM), where extensive experiments demonstrate its state-of-the-art performance and establish a highly robust technical pathway for the challenging VI-ReID task.}
\end{enumerate}

>We validate the performance of MDCN on three benchmark datasets, highlighting the superiority of our method and establishing a new technical pathway for the VI-ReID task.























> However, as illustrated in Figure \xbox{\ref{fig:1}} (a), existing methods employ text prompts that primarily focus on modality differences, entangling identity-related and modality information. The direct use of these prompts to guide the model results in modality-shared and modality-specific features losing crucial identity information and introducing noise, ultimately limiting discriminative capability. Additionally, integrating modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships within and across modalities, leading to distortion of cross-modal high-level semantics during information integration, which further weakens the effectiveness of identity retrieval.


To address the above deficiencies, as illustrated in Figure \ref{fig:1} (b), we propose a design idea of modality-contextual text prompts that explicitly introduce modality-aware capabilities. 

We find that although this enhances the flexibility of multimodal attribute localization, it also introduces new complexities in maintaining cross-modal representation consistency. 

To alleviate this dilemma, we develop a Modality Decoupling and Coupling Network (MDCN), which integrates Context Prompt Decoupling Learning (CPDL), Semantic Coupling Learning (SCL), and Modality Relational Knowledge Distillation (MRKD).


Specifically, CPDL introduces modality-contextual text prompts to embed modality-aware capabilities and semantically decouples them into person-related and modality-related prompts. This decoupling ensures that modality information is effectively distinguished from identity information. SCL employs decoupled semantic prompts as high-level semantic priors, providing guidance for visual feature learning. Modality coupling alignment is designed to encourage the model to emphasize modality uniqueness and differences across semantic levels. Modality-contextual alignment is designed to preserve high-level semantic context. Consequently, the model retains contextual information while learning more stable modality-specific and modality-shared representations. MRKD leverages modality-contextual features with high-level semantic context and employs hierarchical cosine angular distillation to integrate intra- and inter-modality semantic relationships from both modality-specific and modality-shared feature spaces into the modality-contextual space, explicitly reducing cross-modal and intra-modal interference while preserving discriminative representations.






1 MDCN整体框架 
2 CPDL和SPL 
3 MRKD
4 实验

按以上这个格式对主要贡献进行重写，给出给个方案给我


\begin{enumerate}
    \setlength{\leftskip}{4pt}
    \item 
We develop a novel MDCN method that introduces modality-contextual text prompts for VI-ReID and introduce CPDL to semantically decouple these prompts, effectively distinguishing between modality and identity information.
    \item 
\hl{We explore CLIP's potential for modeling modality information in VI-ReID and introduce SCL, which leverages decoupled semantic prompts and employs modality coupling alignment and modality-contextual alignment to construct multiple feature spaces. This emphasizes modality uniqueness and differences while preserving high-level semantic context, resulting in more stable modality-specific and modality-shared representations.
}
    \item 
\hl{We design MRKD, which uses hierarchical cosine angular distillation to integrate intra-modality and inter-modality semantic relationships from both modality-specific and modality-shared features into a modality-contextual space, explicitly enhancing modality-contextual features while preserving discriminative representations.}
    \item 

We validate the performance of MDCN on three benchmark datasets, highlighting the superiority of our method and establishing a new technical pathway for the VI-ReID task.
\end{enumerate}


The main contributions of this paper are as follows:
\begin{enumerate}
    \setlength{\leftskip}{4pt}
    \item 
    We propose a novel Modality Decoupling and Coupling Network (MDCN) for VI-ReID, which introduces modality-contextual text prompts to guide feature learning and effectively separates modality information from identity information.
    
    \item 
    We introduce Context Prompt Decoupling Learning (CPDL) and Semantic Coupling Learning (SCL), which leverage decoupled semantic prompts and employ modality coupling alignment and modality-contextual alignment to construct multiple feature spaces. This design emphasizes modality uniqueness and differences while preserving high-level semantic context, resulting in more stable modality-specific and modality-shared representations.
    
    \item 
    We design Modality Relational Knowledge Distillation (MRKD), which uses hierarchical cosine angular distillation to integrate intra-modality and inter-modality semantic relationships from both modality-specific and modality-shared features into a modality-contextual space, explicitly enhancing modality-contextual features while preserving discriminative representations.
    
    \item 
    We conduct extensive experiments on three benchmark datasets, demonstrating the superiority of MDCN and establishing a new technical pathway for the VI-ReID task.
\end{enumerate}


The main contributions of this paper are as follows:
\begin{enumerate}
    \setlength{\leftskip}{4pt}
    \item 
    We propose a novel Modality Decoupling and Coupling Network (MDCN) for VI-ReID, which introduces modality-contextual text prompts to guide visual feature learning and effectively disentangles modality information from person identity.
    
    \item 
We introduce CPDL and SCL, leveraging decoupled semantic prompts and employing modality coupling alignment and modality-contextual alignment to construct multiple feature spaces. This design emphasizes modality uniqueness and differences while preserving high-level semantic context, resulting in more stable modality-specific and modality-shared representations.


We design CPDL and SCL to achieve semantic decoupling and coupling alignment of visual features. Specifically, CPDL introduces modality-contextual text prompts and semantically decouples them into person-related and modality-related prompts. SCL then leverages these decoupled prompts with modality coupling alignment and modality-contextual alignment to construct multiple feature spaces. Together, this design emphasizes modality uniqueness and differences while preserving high-level semantic context, resulting in more stable modality-specific and modality-shared representations.



Specifically, CPDL introduces modality-contextual text prompts and semantically decouples them into person-related and modality-related components. SCL then leverages these decoupled prompts with modality coupling alignment and modality-contextual alignment to construct multiple feature spaces. Together, this design emphasizes modality uniqueness and differences while preserving high-level semantic context, resulting in more stable modality-specific and modality-shared representations.

我们设计CPDL和SCL进行语义解耦和耦合指导图像特征的连通。具体而言，CPDL 引入modality-contextual text prompts and semantically decouples them into person-related and modality-related prompts. SCL leverages these decoupled prompts with modality coupling alignment and modality-contextual alignment to construct multiple feature spaces. These design emphasizes modality uniqueness and differences while preserving high-level semantic context, resulting in more stable modality-specific and modality-shared representations.

semantically separate person-related and modality-related information from decoupled semantic prompts. 

SCL, which leverages these decoupled prompts with modality coupling alignment and modality-contextual alignment to construct multiple feature spaces. These design emphasizes modality uniqueness and differences while preserving high-level semantic context, resulting in more stable modality-specific and modality-shared representations.


Specifically, CPDL introduces modality-contextual text prompts to embed modality-aware capabilities and semantically decouples them into person-related and modality-related prompts. 

This decoupling ensures that modality information is effectively distinguished from identity information. 

We introduce CPDL to semantically separate person-related and modality-related information from decoupled semantic prompts, 

and 

>We propose a MDCN method, which integrates the CPDL, SCL, and MRKD modules in a unified framework. By decoupling and leveraging modality-contextual text prompts, MDCN effectively mitigates cross-modal and intra-modal interference, enhances feature discriminability, and learns more stable and informative cross-modal identity representations.


>We design CPDL and SCL to decouple semantic information and guide visual features. CPDL introduces modality-contextual prompts and decouple them into person-related and modality-related prompts, while SCL leverages these prompts with modality coupling and modality-contextual alignment to build multiple feature spaces. This framework emphasizes modality uniqueness and differences while preserving high-level semantic context, yielding more stable modality-specific and modality-shared representations.
    
    \item 
> We design MRKD, which applies hierarchical cosine angular distillation to integrate intra-modality and inter-modality semantic relationships from both modality-specific and modality-shared features into a modality-contextual space, explicitly enhancing modality-contextual features while preserving discriminative representations.

    
    \item 
> We validate the effectiveness of MDCN on three benchmark datasets, demonstrating its superiority over existing methods and establishing a new technical pathway for the VI-ReID task.
\end{enumerate}


We propose a novel Modality Decoupling and Coupling Network (MDCN) for VI-ReID, which introduces modality-contextual text prompts to guide feature learning and effectively separates modality information from identity information.