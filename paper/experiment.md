\subsection{Computational Efficiency Analysis}

\hl{We compare MDCN with the baseline and CSDN in terms of model complexity and inference efficiency. As shown in Table \mbox{\ref{tab:complexity}}, MDCN introduces additional parameters due to the three-branch architecture in SCL, yet its inference speed remains competitive. MDCN contains 61.4M parameters, which is higher than the baseline (40.6M) and CSDN (45.6M). This increase is expected, since SCL restructures the final stage of the image encoder into three parallel branches for extracting specific, shared, and contextual features, each introducing independent pooling and fully connected layers that contribute to the additional parameter count. Despite this, MDCN achieves an inference time of 33s per image, matching CSDN and only marginally slower than the single-branch baseline. This efficiency is because only the modality-contextual branch is used during inference, keeping the forward pass lightweight. Notably, MDCN obtains substantially higher retrieval accuracy at the same inference speed as CSDN, and the 21M parameter increase over the baseline translates into consistent performance gains across all benchmarks. For real-world deployment, this trade-off is acceptable, as the improvement in retrieval accuracy outweighs a moderate increase in model size.}


\begin{table}[htbp]
\centering
\caption{\hl{Comparison of model complexity and inference efficiency.}}
\begin{tabular}{l||ccc}
\hline
Method & FLOPs & Parameter Count & Inference Time \\
\hline
CLIP - & 40.6M & 32s \\
MDCN - & 61.4M & 33s \\
\hline
\end{tabular}
\label{tab:complexity}
\end{table}

training time 

memory cost
