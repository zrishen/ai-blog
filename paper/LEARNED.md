CPDL
\textbf{Motivation.} Traditional learnable text prompts are designed either for modality differences or for identity descriptions, yet they inevitably entangle the two during optimization. A modality-related prompt absorbs identity cues from paired visual features, while a person-related prompt is forced to accommodate the visual discrepancy across modalities. Consequently, the resulting supervision is contaminated, introducing noise into image-text alignment and failing to separate what makes a person unique from what makes an image infrared or visible.

为后续视觉特征学习提供干净的语义监督信号

\textbf{Approach.} To address these issues, CPDL introduces modality-contextual text prompts that semantically bridge person-related and modality-related cues, and then explicitly decouple them. 

\textbf{Why it works.}This design prevents the passive entanglement described above, allowing the model to capture spectral distribution differences between visible and infrared modalities while better preserving identity information.


SCL:
\textbf{Motivation.} In VI-ReID, effectively embedding high-level semantic information into visual representations remains a challenge. Although CPDL provides clean, decoupled semantic anchors, single image-text alignment primarily captures modality-shared features and ignores many other implicit informations.

\textbf{Approach.} To overcome this limitation, SCL leverages the decoupled semantic anchors from CPDL and introduces modality coupling alignment together with modality-contextual alignment. The image encoder is restructured into three parallel branches, each guided by different prompt combinations to emphasize critical attributes based on high-level semantics.

\textbf{Why it works.} By selectively pairing person-related and modality-related prompts, SCL directs each branch to a distinct aspect of the input. The modality-specific branch focuses on identity cues within each modality, the modality-shared branch learns cross-modal invariance, and the modality-contextual branch integrates both. The three branches thus produce complementary, non-redundant representations.

Here, "coupling" refers to deliberately pairing person-related and modality-related prompts in the alignment objective, not to merging them back into an entangled representation.

MRKD:
\textbf{Motivation.} SCL produces three complementary feature spaces, yet the modality-contextual features $f_{co}$, which serve as the primary representation for retrieval, do not automatically inherit the implicit relational structures embedded in the other two spaces. These structures constitute a form of high-level semantic knowledge that remains underexploited. As shown in Figure~3, the modality-specific space exhibits compact intra-modal distributions with small angular variations, while the modality-shared space reveals stable cross-modal correlations but relatively weaker intra-modal discriminability. Learning these implicit relational patterns is essential for equipping $f_{co}$ with both intra-modal compactness and cross-modal consistency.

\textbf{Approach.} To extract and transfer this implicit relational knowledge, we introduce MRKD based on Relational Knowledge Distillation (RKD). It employs hierarchical cosine angular distillation, which encodes angular relationships from different feature spaces into transferable knowledge representations. Specifically, intra-modal angular relations are distilled from modality-specific features, and inter-modal angular relations are distilled from modality-shared features, both being transferred into the modality-contextual space.

\textbf{Why it works.} Modality-specific features naturally encode intra-modal compactness, with small angular variations among samples of the same modality. Modality-shared features provide stable cross-modal angular consistency. By distilling both into the modality-contextual space, MRKD equips $f_{co}$ with stronger modality-aware discriminability and cross-modal alignment. The final representation thus inherits the complementary strengths of both source spaces without inheriting their weaknesses.

## IEEE Transactions on Information Forensics and Security

**Manuscript Number:** T-IFS-24200-2025
**Manuscript Title:** Modality Decoupling and Coupling Network for Visible-Infrared Person Re-Identification

---

### Associate Editor

**Comment from the Editors:** Based on the enclosed set of reviews, your manuscript requires a MAJOR REVISION (RQ). The AE recommends a Major Revision. While the paper achieves impressive SOTA results, it lacks the theoretical analysis to prove that the improvement comes from the proposed components, which is a major concern emphasized by Reviewers 2 and 3. In this revision, the authors must demonstrate whether and how the prompts help the feature extraction rather than being noise. The three branches (especially contextual) in the architecture requires an expanded analysis to evaluate their specific roles. Finally, despite Reviewer 1's positive rating, several weaknesses must be addressed in the revised version.

---

**Authors' Response:** We sincerely thank the Associate Editor and all the reviewers for their constructive and valuable comments. We have carefully revised the manuscript to enhance its clarity, theoretical depth, and completeness. Specifically, we have added new visualization and theoretical analyses to demonstrate that our decoupled prompts learn genuine semantic distributions rather than noise. We have significantly expanded the discussion on the operational mechanisms of our three branches (especially the modality-contextual branch) and have addressed all concerns regarding computational efficiency, transition flow, and limitations.

Our point-by-point responses to the reviewers' comments are presented below. We hope that these revisions satisfactorily address the concerns of the editorial team.

---

### Reviewer 1

**Comment 1:** The narrative transition between the two training stages could be smoother. While the individual mechanisms of CPDL and SCL are well-explained, the manuscript would benefit from a slightly more cohesive discussion on how the **semantic priors learned** in the first stage effectively guide or initialize the feature learning in the second stage, ensuring a more unified framework presentation.

**Authors' Response:** We sincerely thank the reviewer for this constructive suggestion. We agree that the connection between Stage I and Stage II needed clearer articulation. In Stage I (CPDL), the model optimizes the learnable text prompts to capture stable semantic representations that successfully decouple modality from identity. In Stage II, these optimized textual features are frozen and act as stable semantic anchors. Through Semantic Coupling Learning (SCL), these textual anchors guide the visual encoder via image-text alignment, forcing the visual features to cluster around these semantically rich, decoupled priors.

**Revision made:** We have added a transitional paragraph at the beginning of Section III.B (Semantic Coupling Learning) to explicitly bridge the two stages, explaining how the frozen outputs of CPDL serve as the supervisory signals for the visual encoder in SCL.

> 在Section III.B(Semantic Coupling Learning)开头加一段过渡描述。明确写出：Stage I 优化好的文本特征在Stage II会被冻结，作为稳定的语义锚点（semantic anchors）；然后通过图文对齐损失，引导视觉特征向这些解耦好的先验聚拢。

> **林国荣批注：** 审稿人1应该是给小修，问题不大，给的意见都相对温和，也给出了回复方案，按着给的回复方案去解决就行。

---

**Comment 2:** The manuscript demonstrates impressive accuracy improvements, but practical deployment considerations are also important. It would be valuable to include a brief discussion or comparison regarding the **computational efficiency** (e.g., model complexity or parameter count) of the proposed method relative to the baseline to provide a more holistic evaluation.

**Authors' Response:** We fully agree that computational efficiency is crucial for the practical deployment of VI-ReID models, especially on edge devices. We would like to clarify that our framework introduces no additional computational burden during the inference phase. While the text encoder and the three-branch architecture are utilized during training to refine the feature space, during inference, we *exclusively* utilize the modality-contextual features ($f_{co}$) extracted by the visual encoder.

We have added a table detailing the FLOPs, parameter count, and inference time to demonstrate that MDCN maintains the same inference efficiency as standard ResNet-50 baselines.

**Revision made:** We have added a new subsection "Computational Complexity Analysis" in Section IV, including a table comparing MDCN's parameters and inference speed against existing SOTA methods.

> 在Section IV 增加一个小节 "Computational Complexity Analysis"。加上一个对比表格，列出Baseline 和咱们MDCN的FLOPs、parameter count 和 inference time。

| method   | parameter count | inference time |
| -------- | --------------- | -------------- |
| Baseline |       40.6M     |      32s        |
| CSDN     |     45.6 M      |      33s        |
| MDCN     |      61.4 M     |      33s        |


我们将 MDCN 与基线方法及 CSDN 在模型复杂度和推理效率方面进行了对比。如表 X 所示，由于 SCL 中采用了三分支架构，MDCN 引入了额外的参数量，但其推理速度仍然具有竞争力。MDCN 包含 61.4M 的参数量，高于基线方法（40.6M）和 CSDN（45.6M）。这一增加是预料之中的，因为 SCL 将图像编码器的最后阶段重构为三个并行分支，分别用于提取特定、共享和上下文特征。每个分支都引入了独立的池化层和全连接层，从而贡献了额外的参数量。尽管如此，MDCN 实现了每张图像 33ms 的推理时间，与 CSDN 持平，仅比单分支基线方法略慢。这是因为我们仅仅使用模态上下文分支进行推理
，从而保持了前向传播的轻量化。值得注意的是，MDCN 在与 CSDN 相同的推理速度下，获得了显著更高的检索精度；而相比于基线方法增加的 21M 参数量，在所有基准测试中都转化为了持续的性能提升。对于实际部署而言，这种权衡是可以接受的，因为检索精度的提升比模型尺寸的适度增加更为重要。

---

**Comment 3:** To provide a more balanced perspective on the proposed method, it would be beneficial to briefly discuss the **potential limitations or failure cases**. For instance, commenting on how the model might handle extreme scenarios, such as severe occlusion or extreme misalignment between modalities, would strengthen the rigor of the study.

**Authors' Response:** We appreciate the reviewer's insightful suggestion. Discussing failure cases provides a more transparent and comprehensive view of our method's boundaries. MDCN relies heavily on aligning visual features with semantic textual priors.

假设以下情况发生，
In cases of extreme occlusion where critical identity-related visual attributes (e.g., clothing, body shape) are completely obscured, the visual encoder struggles to extract meaningful features to align with the person-related textual prompts, leading to matching failures.

**Revision made:** We have added a "Limitations and Failure Cases" paragraph in the Conclusion section (Section V), providing visual examples of failure cases involving severe occlusion and extreme low-light degradation.

> 在Conclusion (Section V)加一段"Limitations and Failure Cases"。我准备去数据集里捞几个极度遮挡或者极暗环境导致匹配失败的bad case放到附图里分析。


DISSCUSION
1. 方法创新
2. 局限性


> **林国荣批注：**
> 如果行人完全被遮挡也没有检索的意义，所以一般讨论的是行人被部分遮挡。
>
> **解决思路：（参考遮挡行人重识别领域的表述）**
>
> 讨论遮挡会导致的主要挑战：局部遮挡噪声干扰影响特征提取和特征不匹配（比如图片a腿包含腿部特征，图片b腿部特征被完全遮挡）。
>
> 对于我们方法的影响：视觉特征和文本特征容易受到遮挡的干扰导致学习噪声信息，使得判别性变差。特征不匹配问题导致检索性能减弱（注意表达，不要说失败，这种太严重的表述）。
>
> **解决方法：**
>
> 1. 提取行人局部特征，来引导模型提取非遮挡行人表征，减少遮挡的干扰。
> 2. 引入基于局部匹配的特征检索策略，缓解特征不匹配的问题。

---

**Comment 4:** The future work section mentions "**human-in-the-loop feedback**," which is an interesting direction. Expanding this point with a broader perspective on how such mechanisms might be integrated into the current multi-modal framework would make the conclusion more inspiring and forward-looking.

**Authors' Response:** We thank the reviewer for encouraging us to expand on this concept. The "human-in-the-loop" concept can be integrated by allowing human operators to manually adjust or weight the textual prompts (e.g., emphasizing a specific clothing color or accessory) during real-time retrieval. Because our framework explicitly decouples person and modality prompts, an operator could inject highly specific identity cues into the person-related prompt without disrupting the modality alignment, thereby dynamically improving accuracy for difficult queries.

**Revision made:** We have expanded the final paragraph of the Conclusion (Section V) to detail how interactive prompt tuning could be practically deployed in forensic and security analytics.

> 顺着审稿人的意思，在Conclusion最后一段把这个概念写实。比如描述在实际安防检索中，人工可以微调person-related prompt（比如强调特定颜色的衣服）来提升困难样本的准确率。

> **林国荣批注：**
> 根据意见3还得出上述结论的问题。要注意控制篇幅，如何精炼的表达这两个研究方向。
> **设置格式：突出显示**

---

### Reviewer 2

**Comment 1:** Since the tokens are learnable continuous vectors, we cannot know for sure whether $[Z]$ (modal Prompt) has truly learned only "modal information" or merely learned some kind of noise distribution that satisfies orthogonal constraints. The paper **lacks in-depth visualization or semantic interpretation of the learned Text Prompt Embedding**, relying solely on the final retrieval performance to infer the effectiveness of decoupling.

> **林国荣批注：** 审稿人的核心质疑点是文本特征是否有学到所谓的模态信息？**可视化实验和理论分析都要！不能光给实验。**
>
> 审稿人的核心质疑点是文本特征是否有学到所谓的模态信息？

可视化实验和理论分析都要！ 不能光给实验。 

实验方案： 
1、将文本特征和对应视觉特征放在一起做t-sne可视化。如果文本特征能够和对应语义的视觉特征聚类在一起，就说明学到了模态信息。
2、可以做热力图可视化，对比使用文本监督前后的激活情况，看看能不能看出什么规律？ 

![alt text](49652d92720ca6dd70414f214aae89a6.png)


**Authors' Response:** This is a highly critical and insightful point raised by the reviewer. We completely agree that the modality orthogonality loss alone ($L_{mo}$) does not mathematically guarantee the absence of noise. To prove that $[Z]$ has learned genuine modality distributions rather than orthogonal noise, we conducted further feature visualization on the prompt embeddings.

如果实验顺利，应该会进行以下回复
By computing the similarity between the learned modality prompt embeddings and fixed, hand-crafted modality descriptions (e.g., "thermal heat signature", "RGB color spectrum"), we found strong semantic correlations. Furthermore, cross-attention maps reveal that the modality prompts selectively activate on spectral-specific artifacts (like thermal brightness in IR images or color contrast in RGB images), confirming their semantic validity.

**Revision made:** We have added a new visualization section detailing the t-SNE distribution of the prompt embeddings themselves, alongside similarity heatmaps demonstrating their semantic alignment with physical spectral properties.

> **论文修改方案（重点突破）：**这个意见比较尖锐。光靠正交损失$L_{mo}$确实不能证明没学到噪声。我打算补充两组可视化：
>
> 1. 提取学到的prompt embeddings，用t-SNE画出来，并计算它和手动设置的物理模态词（如 "thermal heat", "RGB color"）的语义相似度。
> 2. 做一个 Cross-attention 激活图，看看模态提示词是不是准确激活在了红外发热或RGB色彩明显的区域。（没想好怎么进行实验）

---

**Comment 2:** In the SCL module, the text mentions that the output layer of the image encoder is reconstructed into three parallel branches. However, at which layer of the network do these **three branches begin to diverge**? Is it only the final fully connected layer (FC layer) that is different, or is it the final Transformer Block that is different?

**Authors' Response:** We apologize for the lack of architectural specificity. In our implementation, we use a modified ResNet-50 pre-trained on CLIP as the backbone. The shared layers $I_s$ comprise the first three stages of the ResNet-50 architecture. The network diverges into the three parallel branches ($I_{sp}, I_{sh}, I_{co}$) starting from the final stage (Stage 4), followed by distinct pooling and fully connected layers. Diverging at Stage 4 allows the network to learn complex, high-level semantic variations for the specific, shared, and contextual features.

**Revision made:** We have updated the text below Equation 7 in Section III.B to explicitly define the divergence point within the ResNet-50 backbone.

> 在Section III.B公式7下方补充网络细节。明确写出：ResNet-50 的前三个Stage共享，从最后一个 Stage (Stage 4) 开始分化成三个分支。

---

**Comment 3:** The article lacks a comparative analysis of **training time and memory cost**. Considering that VI-ReID is often used on edge devices, the lightweight design of the model or its computational efficiency is a point of concern.

**Authors' Response:** Please refer to our response to Reviewer 1, Comment 2. We have clarified that during inference, we *exclusively* use the modality-contextual features $f_{co}$. The text encoder and auxiliary visual branches are completely discarded, resulting in an inference cost identical to a standard ResNet-50 model. We have added a quantitative table to the manuscript to explicitly show parameters and inference times.

> （与Reviewer 1的Comment 2的问题几乎一致）

---
**Comment 4:** The paper involves balancing multiple hyperparameters ($\lambda_1, \lambda_2, \lambda_3$, and temperature parameters within CLIP, etc.). Despite sensitivity analysis (Fig. 4), such a complex combination of losses may lead to training difficulties or excessive sensitivity to parameters in practical implementations. Reviewers may question the **stability of the method under non-parameter-specific conditions**.

**Authors' Response:** We understand the reviewer's concern regarding hyperparameter sensitivity. However, we would like to highlight that the optimal configuration $\lambda_1=0.7, \lambda_2=0.5, \lambda_3=0.8$ was kept completely consistent across all three diverse datasets (SYSU-MM01, RegDB, and LLCM). The fact that our model achieves state-of-the-art performance on varying scales and environments without requiring dataset-specific hyperparameter tuning demonstrates the inherent stability and robustness of the proposed loss combination.

**Revision made:** We have added a sentence in the Hyperparameter Analysis (Section IV.D) emphasizing that the reported parameters are universally applied across all benchmark evaluations to demonstrate framework stability.

> 在Section IV.D(Hyperparameter Analysis) 补一句话，强调我们这组最优超参$\lambda_1=0.7, \lambda_2=0.5, \lambda_3=0.8$是在所有三个规模、场景完全不同的数据集上通用的。
---

### Reviewer 3

**Comment 1:** Although the paper repeatedly highlights the method and its distinctions from existing approaches at a keyword level, the **detailed operational mechanisms and explanations are insufficient or missing**, making it difficult to fully understand the proposed approach.

**Authors' Response:** We sincerely apologize for the lack of operational clarity. We have thoroughly revised Section III (Method) to focus on the step-by-step information flow. Specifically, we have expanded the explanation of how Semantic Coupling Learning (SCL) utilizes the decoupled prompts to align the three visual feature spaces, and we have mathematically clarified the construction of the triplet angles in MRKD.

> 重写梳理Section III的行文逻辑。特别是补充SCL是如何利用解耦prompts来对齐三个视觉特征空间的，以及明确MRKD里三元组角度的数学推导步骤。

林国容：光改方法不够，引言也要对应做修改。 加强对运作机制的解释，也就是：这么设计的出发点是什么？解决了什么问题？为什么这么设计能解决。
---

**Comment 2:** The proposed method employs a three-branch network (specific, contextual, and shared). However, as shown in Fig. 2, the **contextual features**—claimed as a key contribution—are not clearly defined, and there is a lack of explanation regarding how they are obtained and what specific role they play, including illustrative examples.

**Authors' Response:** We thank the reviewer for pointing out this critical omission. Modality-contextual features $f_{co}$ are designed to be the most comprehensive representation, encapsulating both identity and modality context. While modality-shared features $f_{sh}$ focus purely on cross-modal consistency and modality-specific features $f_{sp}$ focus on intra-modal distinctiveness, the contextual feature is supervised by the *complete* modality-contextual prompt (person + modality tokens). Its role is to serve as the primary representation for inference, having aggregated the high-level semantic relationships distilled from both the shared and specific branches via MRKD.

**Revision made:** We have expanded the description in Section III.B to explicitly define the composition and purpose of $f_{co}$, and updated Figure 2 to better illustrate its central role during both training and testing.

> 在Section III.B明确给出 $f_{co}$ 的定义，并修改图2（Fig. 2）突出它的核心地位。写明：$f_{co}$融合了身份和模态，而且它是推理阶段用于检索的唯一特征。

林国荣
解决方案：
1、修改图2，突出contextual features的作用。
2、补充关于这些特征如何获取及其具体作用的说明（包括示例说明）。这部分的阐述可以参考coop、clip-reid 的表述。 




SCL使模型能够联合学习模态特定fsp、模态共享fsh和模态上下文特征fco。fco在语义上关联了人物相关和模态相关语义，赋予其能够吸收来自另外两个特征空间的互补关系知识的能力，为隐式信息的学习奠定基础。在训练过程中,所有文本端参数被冻结,仅对图像编码器进行优化。源自解耦提示的三种文本表征充当监督信号,相应地,图像编码器被拆分为三个分支。

受到完整的模态上下文提示C的监督,该提示融合了人物相关与模态相关的语义。这种设计赋予fco吸收来自另外两个特征空间的互补关系知识的能力,包括来自模态特定特征的模态内紧凑性和来自模态共享特征的跨模态一致性,从而形成一种用于跨模态检索的统一且具有判别力的表征。在训练过程中,所有文本端参数被冻结,仅对图像编码器进行优化。源自解耦提示的三种文本表征充当监督信号,相应地,图像编码器被拆分为三个分支。

---

**Comment 3:** The integration between textual prompt features and visual features is also a critical component; however, it is only described at a keyword level or expressed in equations, with **insufficient explanation of its underlying meaning and practical implications.**

**Authors' Response:** We agree that the physical meaning of this integration was underexplored. The integration happens through the image-text alignment cross-entropy loss ($L_{i2tce}$) in SCL. Practically, this means the textual embeddings act as fixed, semantically rich class centers (or prototypes) during Stage II. By forcing the visual features to align with these textual prototypes, the visual encoder is constrained to emphasize the key attributes described by the text (e.g., "person", "visible modality"), reducing the visual encoder's tendency to overfit to background noise or irrelevant visual variations.

**Revision made:** We have added a descriptive paragraph in Section III.B detailing this "text-as-prototype" integration mechanism.

> 在Section III.B加一段：说明在Stage II，文本embeddings在图像-文本交叉熵损失（$L_{i2tce}$）的作用下，本质上充当了固定的、语义丰富的类中心，迫使视觉特征向文本描述的关键属性靠拢。

---

**Comment 4:** During training, the person-related prompt is further divided into visible ($P^i_v$) and infrared ($P^i_r$) components. However, since **person-related information** is intended to be **modality-independent**, it is unclear how modality-specific characteristics (V and I) can be meaningfully separated again from an already disentangled person-related representation.

**Authors' Response:** This is an excellent observation. While the *semantic concept* of the identity is indeed modality-independent, the text encoder must learn to map this abstract concept to the distinct visual distributions of the two modalities during contrastive learning. By maintaining separate prompts ($P^i_v$ and $P^i_r$), we allow the text tokens to learn slightly different semantic sub-spaces that optimally bridge the gap to their respective visual domains *before* they are coupled across modalities in SCL.

**Revision made:** We have clarified this design choice in Section III.A, explaining that $P^i_v$ and $P^i_r$ serve as modality-anchored semantic bridges for the same underlying identity.

> 在Section III.A补充解释设计意图。说明虽然"人的身份"在语义上是无关模态的，但由于两种模态在像素级分布差异极大，保留独立的 $P^i_v$ 和 $P^i_r$能作为特定模态的"语义桥梁（semantic bridges）"。

---

**Comment 5:** The **"Forgetting"** component in the distillation process illustrated in Fig. 3 is not explained.

**Authors' Response:** We apologize for the confusing terminology. In the context of our Modality Relational Knowledge Distillation (MRKD):

- Inter-modality forgetting: Applies to modality-specific features. Because these features are meant to focus strictly on intra-modal characteristics, we *intentionally ignore* (forget) cross-modal angular relationships when distilling knowledge from this branch to the contextual branch.
- Intra-modality forgetting: Applies to modality-shared features. Because these features are meant to capture cross-modal consistency, we *intentionally ignore* (forget) within-modality relationships during distillation.

**Revision made:** We have replaced the vague term "forgetting" with "selective exclusion" in the text and expanded the explanation in Section III.C to clearly define what relationships are excluded and why.

> 把原来词不达意的 "Forgetting" 换成更严谨的 "Selective Exclusion"（选择性排除）。在 Section III.C具体写明：
>
> - 模态特有特征（specific）专注模态内，所以**排除跨模态角度关系**。
> - 模态共享特征（shared）专注跨模态，所以**排除模态内关系**。

---

**Comment 6:** The proposed methods appear to be incremental **extensions** of existing approaches, resulting in limited novelty.

**Authors' Response:** We respectfully disagree with the assessment that our method is merely incremental. While previous methods have utilized CLIP for VI-ReID (e.g., TMAL, CSDN, CLIP-MC), they generally rely on prompts solely to bridge the modality gap, mixing identity and modality information. Our novelty is threefold:

1. CPDL: We are the first to propose a prompt learning strategy that explicitly decouples modality and identity semantics through orthogonal constraints.
2. SCL: We introduce a unique modality coupling alignment that utilizes these decoupled semantics to generate three distinct feature spaces.
3. MRKD: We design a novel hierarchical cosine angular distillation method that explicitly fuses relational knowledge from both shared and specific spaces into a contextual space.

---

**Other 1:** The claim that **"Traditional learnable text prompts focus solely on modality differences and lack identity-related semantics"** appears to be overstated, as CLIP inherently encodes general identity-related semantics through its pre-training.

However, as illustrated in Figure 1 (a), existing methods introduce text prompts that focus primarily on modality differences, neglecting to explicitly decouple identity-related semantics (which CLIP already encodes) from modality cues. This entanglement prevents the model from clearly separating person uniqueness from modality differences, and the mere reliance on modality-related text features for compensation fails to fully exploit CLIP's potential.

However, as illustrated in Figure 1 (a), existing methods introduce text prompts that focus solely on modality differences and lack identity-related semantics. They merely rely on modality-related text features to guide the model in compensating for modality-specific features, without fully exploiting the potential of CLIP. This leaves two key limitations unresolved. Because the text prompts entangle modality and identity information, the model cannot clearly separate what makes a person unique from what makes an image infrared or visible. Such entanglement causes the extraction of modality-shared and modality-specific features to lose crucial identity cues and to introduce noise, ultimately limiting discriminative capability. Additionally, the integration of modality-shared features with modality-specific features ignores the fusion of high-level semantic relationships within and across modalities. This leads to the confusion of cross-modal high-level semantics during information integration, thereby distorting both modality-specific cues and underlying implicit cues, which ultimately weakens the effectiveness of identity retrieval.




**Authors' Response:** We acknowledge that our wording was imprecise. CLIP's pre-trained space does indeed contain general identity semantics. Our intention was to state that existing prompt-learning *methods designed for VI-ReID* (such as TMAL or CSDN) focus their learnable prompt tokens primarily on minimizing modality discrepancies, rather than explicitly designing prompts to isolate and preserve fine-grained identity cues.

**Revision made:** We have revised the text in the Abstract and Introduction to state: "Existing methods *applying prompt learning to VI-ReID* primarily focus on mitigating modality differences, without explicitly designing mechanisms to isolate and preserve fine-grained identity semantics."

全面排查并修改了Abstract、Introduction以及Method (Section III.A) 中关于"现有提示缺乏身份语义"的绝对化表述。增加定语限制和让步状语，使表达更加严谨：

1. **Abstract 修改：** 将原先的 "...emphasize solely modality differences and lack identity-related semantics" 修改为带有任务限定的表述："Existing methods **applying prompt learning to VI-ReID** primarily introduce text prompts that emphasize mitigating modality differences, **often lacking sufficient focus on fine-grained identity-related semantics.**"
2. **Introduction 修改：**将 "...focus solely on modality differences..." 改为 "...primarily focus on modality differences, which may result in insufficient exploitation of fine-grained identity-related semantics."
3. **Section III.A 修改：**增加对CLIP本身能力的承认作为铺垫："**While CLIP inherently captures general human attributes**, traditional learnable text prompts designed for VI-ReID often focus primarily on modality differences..."

---

**Other 2:** The description of the three feature spaces in Section 3-C is difficult to follow. In particular, **concepts such as angle, distribution, and discriminability require more concrete explanation**, ideally by explicitly defining positive and negative relationships.

**Authors' Response:** We have heavily revised Section III.C to explicitly define how the unit vectors ($e^{ij}$, $e^{kj}$) are formed and how the angles represent semantic distances. A smaller angle between samples indicates higher similarity (compactness), while an orthogonal angle indicates inter-class separation (discriminability).

---

**Other 3:** The **selection mechanism** of the three samples $f^i, f^j, f^k$ used in **MRKD** should be explicitly defined.

**Authors' Response:** We have added clarification regarding triplet formation. For a given mini-batch, $f^j$ acts as an anchor image, $f^i$ is a positive sample (an image of the same identity), and $f^k$ is a negative sample (an image of a different identity). The distillation forces the modality-contextual space to mimic the relative angular relationships between these triplets found in the specific and shared spaces.

> 在Section III.C 补全公式说明。明确角度小代表相似（compactness），正交代表类间分离（discriminability）。同时定义mini-batch内：$f^j$ 是 anchor，$f^i$ 是正样本（同ID），$f^k$ 是负样本（不同ID）。
>
