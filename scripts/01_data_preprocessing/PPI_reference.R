############################################################
# Build unified PPI reference database
#
# Description:
#   Integrate experimentally supported PPI resources:
#
#   1. BioGRID v4.4.246
#      - Physical interactions only
#
#   2. STRING v12.0
#      - Physical interaction network
#      - combined_score > 400
#
#   3. HitPredict v4 release 18Jul2023
#      - High-confidence interactions
#
# Species:
#   Homo sapiens
#   Mus musculus
#
# Workflow:
#   1. Process individual PPI databases
#   2. Convert identifiers to UniProt
#   3. Merge human and mouse interactions
#   4. Convert mouse interactions to human orthologs
#   5. Generate unified human-centric PPI reference
#
# Output:
#   PPI_reference.csv
#
############################################################


# ==========================================================
# 0. Load packages
# ==========================================================

library(dplyr)
library(tidyr)
library(stringr)
library(biomaRt)
library(readr)


# ==========================================================
# 1. Input files
# ==========================================================

# -----------------------------
# BioGRID v4.4.246
# -----------------------------

BIOGRID_HUMAN_FILE <-
  "BIOGRID-ORGANISM-Homo_sapiens-4.4.246.tab3.txt"

BIOGRID_MOUSE_FILE <-
  "BIOGRID-ORGANISM-Mus_musculus-4.4.246.tab3.txt"


# -----------------------------
# STRING v12.0
# Physical interaction network
# -----------------------------

STRING_HUMAN_FILE <-
  "9606.protein.physical.links.detailed.v12.0.txt"

STRING_MOUSE_FILE <-
  "10090.protein.physical.links.detailed.v12.0.txt"


# -----------------------------
# HitPredict v4 release 18Jul2023
# -----------------------------

HITPREDICT_HUMAN_FILE <-
  "H_sapiens_interactions.txt"

HITPREDICT_MOUSE_FILE <-
  "M_musculus_interactions.txt"


# -----------------------------
# Mouse-human orthology
# -----------------------------

ORTHOLOGY_FILE <-
  "annotation_homology.csv"


# ==========================================================
# 2. Utility functions
# ==========================================================
# Generate unordered protein pair

make_pair <- function(df){
  
  df %>%
    mutate(
      pair = paste(
        pmin(protein.id.A, protein.id.B),
        pmax(protein.id.A, protein.id.B),
        sep="-"
      )
    ) %>%
    distinct(pair, .keep_all=TRUE)
}


# ==========================================================
# 3. Ensembl initialization
# ==========================================================
ensembl <- useEnsembl(
  biomart="ensembl",
  host="www.ensembl.org"
)

human_mart <- useDataset(
  "hsapiens_gene_ensembl",
  ensembl
)

mouse_mart <- useDataset(
  "mmusculus_gene_ensembl",
  ensembl
)



# ==========================================================
# 4. ID conversion functions
# ==========================================================

# ----------------------------------------------------------
# Entrez Gene ID -> UniProt
#
# Used for BioGRID
#
# Priority:
#   SwissProt
#   TrEMBL
# ----------------------------------------------------------

convert_entrez_uniprot <- function(ids, mart){
  swiss <- getBM(
    attributes=c(
      "entrezgene_id",
      "uniprotswissprot"
    ),
    filters="entrezgene_id",
    values=ids,
    mart=mart
  ) %>%
    filter(
      uniprotswissprot != ""
    ) %>%
    rename(
      Entrez.id=entrezgene_id,
      protein.id=uniprotswissprot
    )
  
  remain <- setdiff(
    ids,
    swiss$Entrez.id
  )
  
  if(length(remain)>0){
    
    trembl <- getBM(
      attributes=c(
        "entrezgene_id",
        "uniprotsptrembl"
      ),
      filters="entrezgene_id",
      values=remain,
      mart=mart
    ) %>%
      filter(
        uniprotsptrembl != ""
      ) %>%
      rename(
        Entrez.id=entrezgene_id,
        protein.id=uniprotsptrembl
      ) %>%
      group_by(Entrez.id) %>%
      slice(1) %>%
      ungroup()
    
    swiss <- bind_rows(
      swiss,
      trembl
    )
  }
  
  return(swiss)
}



# ----------------------------------------------------------
# Ensembl peptide ID -> UniProt
#
# Used for STRING
#
# ----------------------------------------------------------

convert_ensp_uniprot <- function(ids, mart){
  swiss <- getBM(
    attributes=c(
      "ensembl_peptide_id",
      "uniprotswissprot"
    ),
    filters="ensembl_peptide_id",
    values=ids,
    mart=mart
  ) %>%
    filter(
      uniprotswissprot != ""
    ) %>%
    rename(
      Ensp=ensembl_peptide_id,
      protein.id=uniprotswissprot
    )
  
  remain <- setdiff(
    ids,
    swiss$Ensp
  )
  
  if(length(remain)>0){
    
    trembl <- getBM(
      attributes=c(
        "ensembl_peptide_id",
        "uniprotsptrembl"
      ),
      filters="ensembl_peptide_id",
      values=remain,
      mart=mart
    ) %>%
      filter(
        uniprotsptrembl != ""
      ) %>%
      rename(
        Ensp=ensembl_peptide_id,
        protein.id=uniprotsptrembl
      ) %>%
      group_by(Ensp) %>%
      slice(1) %>%
      ungroup()
    
    swiss <- bind_rows(
      swiss,
      trembl
    )
  }
  
  return(swiss)
}


# ==========================================================
# 5. Prepare BioGRID
# ==========================================================
prepare_BioGRID <- function(
    file,
    species,
    mart
){
  
  message(
    "Processing BioGRID: ",
    species
  )
  
  bio <- read.delim2(
    file,
    stringsAsFactors=FALSE
  )
  
  bio <- bio[,c(
    "Entrez.Gene.Interactor.A",
    "Entrez.Gene.Interactor.B",
    "Experimental.System.Type",
    "Organism.Name.Interactor.A",
    "Organism.Name.Interactor.B"
  )]
  
  # physical interaction only
  bio <- bio %>%
    filter(
      Experimental.System.Type=="physical",
      Organism.Name.Interactor.A==species,
      Organism.Name.Interactor.B==species
    )
  
  ids <- unique(
    c(
      bio$Entrez.Gene.Interactor.A,
      bio$Entrez.Gene.Interactor.B
    )
  )
  
  mapping <- convert_entrez_uniprot(
    ids,
    mart
  )
  
  bio <- bio %>%
    left_join(
      mapping,
      by=c(
        "Entrez.Gene.Interactor.A"="Entrez.id"
      )
    ) %>%
    rename(
      protein.id.A=protein.id
    ) %>%
    left_join(
      mapping,
      by=c(
        "Entrez.Gene.Interactor.B"="Entrez.id"
      )
    ) %>%
    rename(
      protein.id.B=protein.id
    )
  
  bio %>%
    filter(
      !is.na(protein.id.A),
      !is.na(protein.id.B)
    ) %>%
    mutate(
      source="BioGRID"
    ) %>%
    make_pair()
}


BioGRID_Human <- prepare_BioGRID(
  BIOGRID_HUMAN_FILE,
  "Homo sapiens",
  human_mart
)

BioGRID_Mouse <- prepare_BioGRID(
  BIOGRID_MOUSE_FILE,
  "Mus musculus",
  mouse_mart
)

# ==========================================================
# 6. Prepare STRING physical interaction
# ==========================================================
prepare_STRING <- function(
    file,
    mart,
    taxid
){
  
  message(
    "Processing STRING: ",
    taxid
  )
  
  str <- read.table(
    file,
    header=TRUE,
    stringsAsFactors=FALSE
  )
  
  str <- str %>%
    filter(
      combined_score >= 400
    )
  
  # remove taxonomy prefix
  str$protein1 <- sub(
    paste0("^",taxid,"\\."),
    "",
    str$protein1
  )
  
  str$protein2 <- sub(
    paste0("^",taxid,"\\."),
    "",
    str$protein2
  )
  
  ids <- unique(
    c(
      str$protein1,
      str$protein2
    )
  )
  
  mapping <- convert_ensp_uniprot(
    ids,
    mart
  )
  
  str <- str %>%
    left_join(
      mapping,
      by=c(
        "protein1"="Ensp"
      )
    ) %>%
    rename(
      protein.id.A=protein.id
    ) %>%
    left_join(
      mapping,
      by=c(
        "protein2"="Ensp"
      )
    ) %>%
    rename(
      protein.id.B=protein.id
    )
  
  str %>%
    filter(
      !is.na(protein.id.A),
      !is.na(protein.id.B)
    ) %>%
    mutate(
      source="STRING"
    ) %>%
    make_pair()
}

STRING_Human <- prepare_STRING(
  STRING_HUMAN_FILE,
  human_mart,
  "9606"
)

STRING_Mouse <- prepare_STRING(
  STRING_MOUSE_FILE,
  mouse_mart,
  "10090"
)


# ==========================================================
# 7. Prepare HitPredict
# ==========================================================
prepare_HitPredict <- function(file){
  hit <- read.delim(
    file,
    stringsAsFactors=FALSE
  )
  
  hit <- hit %>%
    filter(
      confidence=="high"
    )
  
  hit %>%
    transmute(
      protein.id.A=Uniprot1,
      protein.id.B=Uniprot2,
      source="HitPredict"
    ) %>%
    make_pair()
}


HitPredict_Human <- prepare_HitPredict(
  HITPREDICT_HUMAN_FILE
)

HitPredict_Mouse <- prepare_HitPredict(
  HITPREDICT_MOUSE_FILE
)

# ==========================================================
# 8. Merge PPI resources within each species
# ==========================================================

# ----------------------------------------------------------
# Human PPI union
#
# Combine:
#   BioGRID
#   STRING
#   HitPredict
#
# ----------------------------------------------------------

human_PPI <- bind_rows(
  BioGRID_Human,
  STRING_Human,
  HitPredict_Human
) %>%
  group_by(pair) %>%
  summarise(
    protein.id.A = first(protein.id.A),
    protein.id.B = first(protein.id.B),
    source = paste(
      unique(source),
      collapse="/"
    ),
    .groups="drop"
  ) %>%
  
  mutate(
    Human=TRUE
  )

# ----------------------------------------------------------
# Mouse PPI union
#
# Combine:
#   BioGRID
#   STRING
#   HitPredict
#
# ----------------------------------------------------------

mouse_PPI <- bind_rows(
  BioGRID_Mouse,
  STRING_Mouse,
  HitPredict_Mouse
) %>%
  group_by(pair) %>%
  summarise(
    protein.id.A = first(protein.id.A),
    protein.id.B = first(protein.id.B),

    source = paste(
      unique(source),
      collapse="/"
    ),
    .groups="drop"
  ) %>%
  
  mutate(
    Mouse=TRUE
  )


# ==========================================================
# 9. Convert mouse PPI to human ortholog pairs
# ==========================================================
annotation <- read.csv(
  ORTHOLOGY_FILE,
  stringsAsFactors=FALSE
)


# Expand one mouse protein with multiple human homologs

annotation_long <- annotation %>%
  mutate(
    hsapiens_homolog_protein =
      str_split(
        hsapiens_homolog_protein,
        ";"
      )
  ) %>%
  
  unnest(
    hsapiens_homolog_protein
  ) %>%
  
  mutate(
    Entry =
      str_trim(Entry),
    
    hsapiens_homolog_protein =
      str_trim(hsapiens_homolog_protein)
  ) %>%
  
  filter(
    Reviewed=="reviewed"
  ) %>%
  
  distinct(
    Entry,
    hsapiens_homolog_protein
  )


# Mouse UniProt pair -> human UniProt pair
mouse_human <- mouse_PPI %>%
  left_join(
    annotation_long %>%
      select(
        Entry,
        human.id.A=
          hsapiens_homolog_protein
      ),
    
    by=c(
      "protein.id.A"="Entry"
    )
  ) %>%
  
  left_join(
    annotation_long %>%
      select(
        Entry,
        human.id.B=
          hsapiens_homolog_protein
      ),
    by=c(
      "protein.id.B"="Entry"
    )
  ) %>%
  
  filter(
    !is.na(human.id.A),
    !is.na(human.id.B)
  ) %>%
  
  mutate(
    protein.id.A =
      pmin(
        human.id.A,
        human.id.B
      ),
    
    protein.id.B =
      pmax(
        human.id.A,
        human.id.B
      ),
    
    pair =
      paste(
        protein.id.A,
        protein.id.B,
        sep="-"
      )
  ) %>%
  
  select(
    protein.id.A,
    protein.id.B,
    pair,
    source
  ) %>%
  
  distinct(pair,.keep_all=TRUE) %>%
  
  mutate(
    Mouse=TRUE
  )


# ==========================================================
# 10. Generate final human-centric PPI reference
# ==========================================================

# Add human and mouse evidence
final_reference <- full_join(
  human_PPI,
  mouse_human,
  
  by=c(
    "protein.id.A",
    "protein.id.B",
    "pair"
  ),
  
  suffix=c(
    ".human",
    ".mouse"
  )
)

# Combine database sources

final_reference <- final_reference %>%
  mutate(
    source =
      sapply(
        seq_len(n()),
        function(i){
          
          paste(
            unique(
              na.omit(
                c(
                  source.human[i],
                  source.mouse[i]
                )
              )
            ),
            collapse="/"
          )
          
        }
      ),
    
    Human =
      ifelse(
        is.na(source.human),
        FALSE,
        TRUE
      ),
    
    Mouse =
      ifelse(
        is.na(source.mouse),
        FALSE,
        TRUE
      )
  ) %>%
  
  select(
    protein.id.A,
    protein.id.B,
    source,
    Human,
    Mouse
  ) %>%
  
  distinct()


# ==========================================================
# 11. Save output
# ==========================================================
write.csv(
  final_reference,
  "PPI_reference.csv",
  row.names=FALSE
)
