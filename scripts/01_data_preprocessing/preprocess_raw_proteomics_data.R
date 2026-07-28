############################################################
# Protein abundance preprocessing
#
# Input:
#   Original protein intensity matrix
#
# Dataset:
#   22 tissues
#   3-4 biological replicates per tissue
#
# Output:
#   1. Raw abundance matrix
#   2. ImpSeq abundance matrix
#
############################################################


# ==========================================================
# 1. Input original intensity matrix
# ==========================================================
protein_matrix <- original_intensity_matrix

# Column format:
#
# Tissue1.rep1
# Tissue1.rep2
# Tissue1.rep3
# Tissue2.rep1
# ...

# ==========================================================
# 2. Define tissue groups
# ==========================================================
sample_info <- data.frame(
  sample = colnames(protein_matrix),

  tissue = str_split(
    colnames(protein_matrix),
    "\\.",
    simplify=TRUE
  )[,1]
)

tissues <- unique(
  sample_info$tissue
)


# ==========================================================
# 3. Replicate detection filtering
#
# Count detected replicates
# for each protein in each tissue
#
# ==========================================================
detect_matrix <- matrix(
  NA,
  nrow=nrow(protein_matrix),
  ncol=length(tissues)
)


rownames(detect_matrix) <- rownames(protein_matrix)
colnames(detect_matrix) <- tissues

for(tissue in tissues){
  reps <- sample_info$sample[
    sample_info$tissue==tissue
  ]
  
  detect_matrix[,tissue] <-
    rowSums(
      !is.na(
        protein_matrix[,reps]
      )
    )
  
}


# ==========================================================
# 4. Generate raw matrix
#
# Rule:
#
# detected in >=2 replicates:
#       keep values
#
# detected in only 1 replicate:
#       assign NA
#
# ==========================================================

raw_matrix <- protein_matrix

for(tissue in tissues){  
  reps <- sample_info$sample[
    sample_info$tissue==tissue
  ]
  
  unreliable <-
    detect_matrix[,tissue] == 1
  
  raw_matrix[
    unreliable,
    reps
  ] <- NA
}



# ==========================================================
# 5. Average replicates for raw abundance
#
# ==========================================================
raw_abundance <- matrix(
  NA,
  nrow=nrow(raw_matrix),
  ncol=length(tissues)
)

rownames(raw_abundance) <- rownames(raw_matrix)
colnames(raw_abundance) <- tissues

for(tissue in tissues){
  
  reps <- sample_info$sample[
    sample_info$tissue==tissue
  ]
  
  raw_abundance[,tissue] <-
    rowMeans(
      raw_matrix[,reps],
      na.rm=TRUE
    )
}


# ==========================================================
# 6. Prepare matrix for impSeq
#
# Using the same filtered matrix
# generated above
#
# ==========================================================

imp_input <- raw_matrix

# ----------------------------------------------------------
# Completely missing proteins
#
# assign half of global minimum intensity
#
# ----------------------------------------------------------
global_min <- min(
  imp_input,
  na.rm=TRUE
)

half_min <- global_min / 2

complete_missing <- apply(
  imp_input,
  1,
  function(x){
    all(is.na(x))
  }
)

imp_input[
  complete_missing,
] <- half_min


# ==========================================================
# 7. impSeq imputation
#
# Partial missing values:
#       imputed by impSeq
#
# ==========================================================

log_matrix <- log2(
  imp_input
)

impseq_matrix <- impSeq(
  log_matrix
)

impseq_matrix <- 2^impseq_matrix


# Restore proteins with no measured intensity
impseq_matrix[
  complete_missing,
] <- half_min


# ==========================================================
# 8. Average replicates for impSeq abundance
#
# ==========================================================

impseq_abundance <- matrix(
  NA,
  nrow=nrow(impseq_matrix),
  ncol=length(tissues)
)

rownames(impseq_abundance) <- rownames(impseq_matrix)
colnames(impseq_abundance) <- tissues

for(tissue in tissues){
  reps <- sample_info$sample[
    sample_info$tissue==tissue
  ]
  
  impseq_abundance[,tissue] <-
    rowMeans(
      impseq_matrix[,reps],
      na.rm=TRUE
    )
}


# ==========================================================
# 9. Save two abundance matrices
# ==========================================================
write.csv(
  raw_abundance,
  "Protein_abundance_raw.csv"
)

write.csv(
  impseq_abundance,
  "Protein_abundance_impSeq.csv"
)
