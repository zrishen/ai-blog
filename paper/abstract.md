# Modality Decoupling and Coupling Network for Visible-Infrared Person Re-Identification

**Rishen Zhong, Guorong Lin, and Zhenhua Huang**

---

**Abstract—** 

Visible-Infrared person re-identification (VI-ReID) is a critical cross-modal retrieval task with substantial applications in urban surveillance and public safety. 

Existing methods primarily introduce text prompts that entangle modality and identity information, failing to clearly separate person uniqueness from modality differences. Additionally, the integration of modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships, leading to the distortion of implicit cross-modal information and weakening identity retrieval.

To address these issues, we develop a Modality Decoupling and Coupling Network (MDCN) that aims to fully extract both modality-shared and modality-specific features, while effectively integrating valuable high-level semantic relationships from both.Specifically, it consists of three core components: Context Prompt Decoupling Learning (CPDL), Semantic Coupling Learning (SCL), and Modality Relational Knowledge Distillation (MRKD). 

CPDL designs modality-contextual text prompts to explicitly introduce modality-aware capabilities and semantically decouples them into person-related and modality-related prompts, thereby effectively distinguishing between modality and identity information.

SCL utilizes decoupled semantic prompts as high-level priors while employing modality coupling and modality-contextual alignment to guide visual features. This encourages the model to emphasize modality uniqueness and differences across semantic levels while preserving high-level semantic context, enabling it to learn more stable modality-specific and shared representations.

MRKD employs hierarchical cosine angular distillation to project inter-modality and intra-modality relationships into a modality-contextual space, explicitly reducing cross-modal and intra-modal interference while preserving discriminative representations.


> MRKD adopts a semantic-guided hierarchical cosine angular distillation method to integrate intra-modality relationships from the modality-specific space and inter-modality relationships from the modality-shared space into the modality-contextual space, thereby alleviating cross-modal discrepancies and intra-modal interference while enhancing representation discriminability.


Extensive experiments on SYSU-MM01, RegDB, and LLCM benchmarks demonstrate that MDCN achieves state-of-the-art performance, validating its effectiveness in addressing the VI-ReID task.





SCL implements modality coupling alignment and modality-contextual alignment to guide the image encoder to emphasize key attributes based on high-level semantics, thus effectively extracting modality-shared and modality-specific features. 




